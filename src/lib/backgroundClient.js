import { errorMessage, parseJsonResponse } from './apiError.js'

// Anropar Netlify Edge Functions /api/generate-background och /api/matte-video(-status) —
// aldrig Claude/Replicate direkt från klienten. Se render-clip.ts (backgroundSwapEnabled)
// för hur bakgrundsbilden och den bakgrundsborttagna videon kompositeras ihop.

// Ett enda anrop (Replicate "Prefer: wait" i generate-background.ts) — FLUX Schnell är
// snabb nog att ingen pollning behövs för själva bilden.
export async function generateBackgroundImage({ customPrompt }) {
  const response = await fetch('/api/generate-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customPrompt }),
  })

  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte generera bakgrundsbild.'))
  }
  return data // { imageUrl, prompt }
}

async function submitMatte(videoUrl) {
  const response = await fetch('/api/matte-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoUrl }),
  })

  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta bakgrundsborttagning.'))
  }
  return data.taskId
}

async function getMatteStatus(taskId) {
  const response = await fetch(`/api/matte-video-status?id=${encodeURIComponent(taskId)}`)
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte hämta status för bakgrundsborttagning.'))
  }
  return data
}

const POLL_INTERVAL_MS = 5000
const MAX_POLL_ATTEMPTS = 60 // ~5 minuter — videobearbetning kan ta tid

// Tar bort bakgrunden ur användarens egen video (ersätts med grönt, för Shotstacks
// chromaKey) och pollar tills den är klar.
export async function matteVideo({ videoUrl, onStatus }) {
  const taskId = await submitMatte(videoUrl)

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    const result = await getMatteStatus(taskId)
    onStatus?.(result.status)

    if (result.status === 'SUCCEEDED') return result.url
    if (result.status === 'FAILED') {
      throw new Error(result.error ?? 'Bakgrundsborttagningen misslyckades hos Replicate.')
    }
  }

  throw new Error('Bakgrundsborttagningen tog för lång tid. Försök igen senare.')
}
