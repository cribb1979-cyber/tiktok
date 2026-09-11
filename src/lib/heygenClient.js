import { errorMessage, parseJsonResponse } from './apiError.js'

// Anropar Netlify Edge Functions /api/generate-avatar-video och /api/avatar-video-status —
// aldrig HeyGen direkt från klienten. Manus-läge (se Klippstudio.jsx): den sammanslagna
// talbara dialogen (byggd av parse-script.ts's beats, regianvisningar redan bortrensade)
// skickas hit, en talande AI-avatar-video kommer tillbaka.

// Listar kontots avatarer/röster (se list-avatars.ts/list-voices.ts) — för väljarna i
// Klippstudio. Faller tillbaka på HEYGEN_AVATAR_ID/HEYGEN_VOICE_ID server-side om användaren
// inte väljer något (eller om listorna inte kunde hämtas), se generate-avatar-video.ts.
export async function listAvatars() {
  const response = await fetch('/api/list-avatars')
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte hämta avatarlistan.'))
  }
  return data.avatars // [{ id, name, previewImageUrl }]
}

export async function listVoices() {
  const response = await fetch('/api/list-voices')
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte hämta röstlistan.'))
  }
  return data.voices // [{ id, name, language, gender, supportPause }]
}

async function submitAvatarVideo(inputText, avatarId, voiceId) {
  const response = await fetch('/api/generate-avatar-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputText, avatarId, voiceId }),
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
// avatarId/voiceId (valfria): användarens val från väljarna i Klippstudio — annars faller
// generate-avatar-video.ts tillbaka på HEYGEN_AVATAR_ID/HEYGEN_VOICE_ID server-side.
export async function generateAvatarVideo({ inputText, avatarId, voiceId, onStatus }) {
  const id = await submitAvatarVideo(inputText, avatarId, voiceId)

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
