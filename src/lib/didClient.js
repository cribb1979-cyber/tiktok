import { errorMessage, parseJsonResponse } from './apiError.js'

// Anropar Netlify Edge Functions /api/generate-did-video och /api/did-video-status — aldrig
// D-ID direkt från klienten. Alternativ, billigare leverantör till HeyGen (se
// generate-did-video.ts) i Manus-läget (Klippstudio.jsx) — samma sammanslagna talbara dialog
// in, men ett eget foto (sourceImageUrl) istället för en HeyGen-avatar.

async function submitDidVideo(inputText, sourceImageUrl, voiceId) {
  const response = await fetch('/api/generate-did-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputText, sourceImageUrl, voiceId }),
  })

  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta D-ID-generering.'))
  }
  return data.id
}

async function getDidVideoStatus(id) {
  const response = await fetch(`/api/did-video-status?id=${encodeURIComponent(id)}`)
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte hämta status för D-ID-video.'))
  }
  return data
}

const POLL_INTERVAL_MS = 5000
const MAX_POLL_ATTEMPTS = 90 // ~7,5 minuter — samma tålamodsgräns som HeyGen-flödet

// Startar D-ID-videogenerering och pollar tills den är klar. Samma
// PENDING/RUNNING/SUCCEEDED/FAILED-kontrakt som heygenClient.js/replicateClient.js.
export async function generateDidVideo({ inputText, sourceImageUrl, voiceId, onStatus }) {
  const id = await submitDidVideo(inputText, sourceImageUrl, voiceId)

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    const result = await getDidVideoStatus(id)
    onStatus?.(result.status)

    if (result.status === 'SUCCEEDED') return result.url
    if (result.status === 'FAILED') {
      throw new Error(result.error ?? 'D-ID-genereringen misslyckades.')
    }
  }

  throw new Error('D-ID-genereringen tog för lång tid. Försök igen senare.')
}
