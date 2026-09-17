import { errorMessage, parseJsonResponse } from './apiError.js'

// AI-kortfilm (valfritt tillval, opt-in): en hel liten berättelse med återkommande karaktärer
// över flera AI-genererade scener, byggd av fyra Netlify Edge Functions:
// generate-shotlist.ts (Claude: idé → karaktärer + scenlista), generate-character-image.ts
// (en referensbild per karaktär), generate-shot-image.ts (en konsekvent bildruta per scen,
// med rätt karaktärers referensbilder), generate-shot-video.ts (animerar bildrutan till
// video). Alla tre Replicate-baserade genererings-stegen pollas via SAMMA /api/broll-status
// (Replicates predictions-endpoint är modelloberoende, samma poll-kontrakt som B-roll redan
// använder) — inga nya statusendpoints behövdes.
//
// Se Klippstudio.jsx (handleGenerateFilm) för orkestreringen: karaktärsbilder genereras
// först (en gång per karaktär), sen scen för scen bildruta → video i ordning. Varje färdig
// scens video läggs till i clips-listan precis som ett uppladdat klipp eller en Manus-
// genererad AI-avatar-video — samma nedströms klippningsplan-/renderingsflöde återanvänds.

export async function generateShotlist(idea) {
  const response = await fetch('/api/generate-shotlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idea }),
  })
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte skapa scenlistan.'))
  }
  return data // { title, characters: [{tag, description}], locations: [{tag, description}], shots: [{location_tag, image_prompt, motion_prompt, duration_seconds, character_tags}] }
}

async function getTaskStatus(taskId) {
  const response = await fetch(`/api/broll-status?id=${encodeURIComponent(taskId)}`)
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte hämta genereringsstatus.'))
  }
  return data
}

// Delad pollningsloop för alla tre Replicate-baserade stegen nedan — samma
// PENDING/RUNNING/SUCCEEDED/FAILED-kontrakt som replicateClient.js/backgroundClient.js.
async function pollUntilDone(taskId, { intervalMs, maxAttempts, onStatus, failMessage }) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    const result = await getTaskStatus(taskId)
    onStatus?.(result.status)

    if (result.status === 'SUCCEEDED') return result.url
    if (result.status === 'FAILED') {
      throw new Error(result.error ?? failMessage)
    }
  }
  throw new Error('Genereringen tog för lång tid. Försök igen senare.')
}

const IMAGE_POLL_INTERVAL_MS = 3000
const IMAGE_MAX_POLL_ATTEMPTS = 40 // ~2 minuter
const VIDEO_POLL_INTERVAL_MS = 5000
const VIDEO_MAX_POLL_ATTEMPTS = 60 // ~5 minuter

// Två skilda, båda övergående feltyper från Replicate som är värda att pröva om automatiskt
// istället för att direkt ge upp:
// 1. NSFW-falsklarm: FLUX Schnells säkerhetsklassificerare bedömer den FÄRDIGA bilden, inte
//    bara prompten, och kan flagga helt vardagliga, fullt påklädda beskrivningar (rapporterat
//    direkt av användaren, se generate-character-image.ts). Klassificeringen är stokastisk (ny
//    slumpmässig bild-seed per generering), så samma beskrivning går ofta igenom nästa gång.
// 2. Tillfälliga Replicate-driftfel (t.ex. "Internal server error"/503 — rapporterat direkt av
//    användaren vid ett skarpt test), som normalt löser sig av sig själva vid ett nytt försök.
// Andra fel (valideringsfel, fel API-nyckel, m.m.) ger fortfarande upp direkt utan onödiga
// extra Replicate-anrop.
const RETRY_ATTEMPTS = 2
const RETRY_DELAY_MS = 2000
const RETRYABLE_ERROR_PATTERN = /nsfw|internal server error|\b50[234]\b/i

// Delad submit+poll-med-återförsök för alla tre Replicate-stegen nedan. `submit` startar EN NY
// prediction varje försök (viktigt för NSFW-fallet — en ny prediction ger en ny slumpmässig
// seed, ett omförsök mot SAMMA taskId hade inte hjälpt).
async function submitAndPollWithRetry(submit, pollOptions, onStatus) {
  for (let attempt = 0; ; attempt++) {
    try {
      const taskId = await submit()
      return await pollUntilDone(taskId, { ...pollOptions, onStatus })
    } catch (err) {
      if (!RETRYABLE_ERROR_PATTERN.test(err.message) || attempt >= RETRY_ATTEMPTS) throw err
      onStatus?.('RETRYING', err.message)
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
}

async function submitCharacterImage(description) {
  const response = await fetch('/api/generate-character-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta karaktärsbild-generering.'))
  }
  return data.taskId
}

export function generateCharacterImage(description, onStatus) {
  return submitAndPollWithRetry(
    () => submitCharacterImage(description),
    { intervalMs: IMAGE_POLL_INTERVAL_MS, maxAttempts: IMAGE_MAX_POLL_ATTEMPTS, failMessage: 'Karaktärsbilden kunde inte genereras hos Replicate.' },
    onStatus
  )
}

// characterRefs: [{ tag, imageUrl }] — bara de karaktärer som faktiskt syns i DEN HÄR scenen.
async function submitShotImage({ imagePrompt, characterRefs }) {
  const response = await fetch('/api/generate-shot-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagePrompt, characterRefs }),
  })
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta scenbild-generering.'))
  }
  return data.taskId
}

export function generateShotImage({ imagePrompt, characterRefs }, onStatus) {
  return submitAndPollWithRetry(
    () => submitShotImage({ imagePrompt, characterRefs }),
    { intervalMs: IMAGE_POLL_INTERVAL_MS, maxAttempts: IMAGE_MAX_POLL_ATTEMPTS, failMessage: 'Scenbilden kunde inte genereras hos Replicate.' },
    onStatus
  )
}

async function submitShotVideo({ imageUrl, motionPrompt, durationSeconds }) {
  const response = await fetch('/api/generate-shot-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl, motionPrompt, durationSeconds }),
  })
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta scenvideo-generering.'))
  }
  return data.taskId
}

export function generateShotVideo({ imageUrl, motionPrompt, durationSeconds }, onStatus) {
  return submitAndPollWithRetry(
    () => submitShotVideo({ imageUrl, motionPrompt, durationSeconds }),
    { intervalMs: VIDEO_POLL_INTERVAL_MS, maxAttempts: VIDEO_MAX_POLL_ATTEMPTS, failMessage: 'Scenvideon kunde inte genereras hos Replicate.' },
    onStatus
  )
}
