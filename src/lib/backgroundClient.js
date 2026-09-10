import { errorMessage, parseJsonResponse } from './apiError.js'

// Anropar Netlify Edge Functions /api/generate-background(-status) och
// /api/matte-video(-status) — aldrig Claude/Replicate direkt från klienten. Se render-clip.ts
// (backgroundSwapEnabled) för hur bakgrundsbilden och den bakgrundsborttagna videon
// kompositeras ihop.

async function submitBackgroundImage(customPrompt) {
  const response = await fetch('/api/generate-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customPrompt }),
  })

  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta bakgrundsbildsgenerering.'))
  }
  return data // { taskId, prompt }
}

async function getBackgroundImageStatus(taskId) {
  const response = await fetch(`/api/generate-background-status?id=${encodeURIComponent(taskId)}`)
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte hämta status för bakgrundsbildsgenerering.'))
  }
  return data
}

const IMAGE_POLL_INTERVAL_MS = 3000
const IMAGE_MAX_POLL_ATTEMPTS = 40 // ~2 minuter — tolererar en "cold start" av FLUX Schnell

// Genererar en bakgrundsbild (Claude skriver prompten, FLUX Schnell via Replicate genererar
// bilden) och pollar tills den är klar. Submit+poll istället för en blockerande "Prefer: wait"
// — en modell som skalats ner (cold start) kan ta betydligt längre än en enda HTTP-förfrågan
// tolererar, se generate-background.ts.
export async function generateBackgroundImage({ customPrompt, onStatus }) {
  const { taskId, prompt } = await submitBackgroundImage(customPrompt)

  for (let attempt = 0; attempt < IMAGE_MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, IMAGE_POLL_INTERVAL_MS))
    const result = await getBackgroundImageStatus(taskId)
    onStatus?.(result.status)

    if (result.status === 'SUCCEEDED') return { imageUrl: result.imageUrl, prompt }
    if (result.status === 'FAILED') {
      throw new Error(result.error ?? 'Bakgrundsbildsgenereringen misslyckades hos Replicate.')
    }
  }

  throw new Error('Bakgrundsbildsgenereringen tog för lång tid. Försök igen senare.')
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
