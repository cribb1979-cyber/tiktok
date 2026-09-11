import { errorMessage, parseJsonResponse } from './apiError.js'

// Anropar Netlify Edge Functions /api/generate-avatar-video och /api/avatar-video-status —
// aldrig HeyGen direkt från klienten. Manus-läge (se Klippstudio.jsx): den sammanslagna
// talbara dialogen (byggd av parse-script.ts's beats, regianvisningar redan bortrensade)
// skickas hit, en talande AI-avatar-video kommer tillbaka.

async function submitAvatarVideo(inputText) {
  const response = await fetch('/api/generate-avatar-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputText }),
  })

  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta AI-avatar-generering.'))
  }
  return data.id
}

async function getAvatarVideoStatus(id) {
  const response = await fetch(`/api/avatar-video-status?id=${encodeURIComponent(id)}`)
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte hämta status för AI-avatar-video.'))
  }
  return data
}

const POLL_INTERVAL_MS = 5000
const MAX_POLL_ATTEMPTS = 90 // ~7,5 minuter — avatarvideo kan ta tid, särskilt längre manus

// Startar AI-avatar-generering och pollar tills den är klar. Samma
// PENDING/RUNNING/SUCCEEDED/FAILED-kontrakt som replicateClient.js/backgroundClient.js.
export async function generateAvatarVideo({ inputText, onStatus }) {
  const id = await submitAvatarVideo(inputText)

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    const result = await getAvatarVideoStatus(id)
    onStatus?.(result.status)

    if (result.status === 'SUCCEEDED') return result.url
    if (result.status === 'FAILED') {
      throw new Error(result.error ?? 'AI-avatar-genereringen misslyckades hos HeyGen.')
    }
  }

  throw new Error('AI-avatar-genereringen tog för lång tid. Försök igen senare.')
}
