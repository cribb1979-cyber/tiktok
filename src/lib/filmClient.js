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
  return data // { title, characters: [{tag, description}], shots: [{image_prompt, motion_prompt, duration_seconds, character_tags}] }
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

export async function generateCharacterImage(description, onStatus) {
  const response = await fetch('/api/generate-character-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta karaktärsbild-generering.'))
  }
  return pollUntilDone(data.taskId, {
    intervalMs: IMAGE_POLL_INTERVAL_MS,
    maxAttempts: IMAGE_MAX_POLL_ATTEMPTS,
    onStatus,
    failMessage: 'Karaktärsbilden kunde inte genereras hos Replicate.',
  })
}

// characterRefs: [{ tag, imageUrl }] — bara de karaktärer som faktiskt syns i DEN HÄR scenen.
export async function generateShotImage({ imagePrompt, characterRefs }, onStatus) {
  const response = await fetch('/api/generate-shot-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagePrompt, characterRefs }),
  })
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta scenbild-generering.'))
  }
  return pollUntilDone(data.taskId, {
    intervalMs: IMAGE_POLL_INTERVAL_MS,
    maxAttempts: IMAGE_MAX_POLL_ATTEMPTS,
    onStatus,
    failMessage: 'Scenbilden kunde inte genereras hos Replicate.',
  })
}

export async function generateShotVideo({ imageUrl, motionPrompt, durationSeconds }, onStatus) {
  const response = await fetch('/api/generate-shot-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl, motionPrompt, durationSeconds }),
  })
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta scenvideo-generering.'))
  }
  return pollUntilDone(data.taskId, {
    intervalMs: VIDEO_POLL_INTERVAL_MS,
    maxAttempts: VIDEO_MAX_POLL_ATTEMPTS,
    onStatus,
    failMessage: 'Scenvideon kunde inte genereras hos Replicate.',
  })
}
