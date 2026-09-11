import { errorMessage, parseJsonResponse } from './apiError.js'

// Övre gräns per serveranrop. Netlify Edge Functions måste svara med headers inom 40
// sekunder (plattformsgräns) — den här klient-timeouten ligger strax över det som en
// backstop, så ett anrop som av någon anledning aldrig får svar (trasig uppkoppling,
// plattformen dödar funktionen utan att stänga anslutningen rent) ändå garanterat
// resolvar/rejectar istället för att hänga kvar för evigt (fetch() saknar egen timeout).
const FETCH_TIMEOUT_MS = 60_000

async function fetchWithTimeout(url, options) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Servern svarade inte inom rimlig tid. Försök igen.')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

// Anropar Netlify Edge Function /api/transcribe — aldrig Whisper API direkt från klienten.
export async function transcribeMedia(file) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetchWithTimeout('/api/transcribe', {
    method: 'POST',
    body: formData,
  })

  const data = await parseJsonResponse(response)

  if (!response.ok) {
    throw new Error(errorMessage(data, 'Något gick fel vid transkribering.'))
  }

  return data // { text, segments: [{ start, end, text }], words: [{ word, start, end }] }
}

const CONVERT_POLL_INTERVAL_MS = 3000
const CONVERT_MAX_POLL_ATTEMPTS = 60 // ~3 minuter

// För format Whisper inte accepterar direkt (t.ex. .mov från iPhone/iPad) — servern
// konverterar videon via Shotstack innan transkribering. videoUrl måste vara publikt nåbar.
//
// Görs i tre korta steg (submit → pollning → transkribera) istället för ett enda långt
// serveranrop som gör allt: en Shotstack-konvertering kan ta längre än Netlify Edge
// Functions 40-sekundersgräns för att svara med headers, så ett enda kombinerat anrop
// riskerade att plattformen dödade funktionen mitt i — vilket visade sig som att klippet
// blev stående på "Bearbetar…" för alltid i Klippstudio (varken fel eller resultat kom
// någonsin tillbaka). Pollningen sker här, klientsidigt, i korta väl-under-40s-anrop mot
// /api/render-status (samma endpoint som videorenderingen redan pollar).
//
// onStatus (valfri): anropas med 'converting' resp. 'transcribing' vid respektive steg, så
// anroparen kan visa mer specifik statustext än bara "Bearbetar…".
export async function transcribeFromUrl(videoUrl, onStatus) {
  onStatus?.('converting')
  const convertResponse = await fetchWithTimeout('/api/transcribe-convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoUrl }),
  })
  const convertData = await parseJsonResponse(convertResponse)
  if (!convertResponse.ok) {
    throw new Error(errorMessage(convertData, 'Kunde inte starta videokonvertering.'))
  }
  const renderId = convertData.id

  let mp4Url = null
  for (let attempt = 0; attempt < CONVERT_MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, CONVERT_POLL_INTERVAL_MS))

    const statusResponse = await fetchWithTimeout(`/api/render-status?id=${encodeURIComponent(renderId)}`)
    const statusData = await parseJsonResponse(statusResponse)
    if (!statusResponse.ok) {
      throw new Error(errorMessage(statusData, 'Kunde inte hämta konverteringsstatus.'))
    }

    if (statusData.status === 'done') {
      mp4Url = statusData.url
      break
    }
    if (statusData.status === 'failed') {
      throw new Error(statusData.error ?? 'Videokonverteringen misslyckades hos Shotstack.')
    }
  }
  if (!mp4Url) {
    throw new Error('Videokonverteringen tog för lång tid. Försök igen.')
  }

  onStatus?.('transcribing')
  const response = await fetchWithTimeout('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mp4Url }),
  })

  const data = await parseJsonResponse(response)

  if (!response.ok) {
    throw new Error(errorMessage(data, 'Något gick fel vid transkribering.'))
  }

  return data
}
