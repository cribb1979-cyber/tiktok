import { errorMessage } from './apiError.js'

// Anropar Netlify Edge Functions /api/render-clip och /api/render-status — aldrig
// Shotstack API direkt från klienten.

async function submitRender({
  videoUrl,
  segmentsPlan,
  transcript,
  hookText,
  suggestedSubtitles,
  brollVideoUrl,
  segmentEffects,
  segmentFilters,
  words,
  effectVideoUrl,
  effectType,
  backgroundImageUrl,
  backgroundMattedVideoUrl,
  thoughtBubbles,
  thoughtBubblesEnabled,
}) {
  const response = await fetch('/api/render-clip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoUrl,
      segmentsPlan,
      transcript,
      hookText,
      suggestedSubtitles,
      brollVideoUrl,
      segmentEffects,
      segmentFilters,
      words,
      effectVideoUrl,
      effectType,
      backgroundImageUrl,
      backgroundMattedVideoUrl,
      thoughtBubbles,
      thoughtBubblesEnabled,
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta rendering.'))
  }
  return data.id
}

async function getRenderStatus(id) {
  const response = await fetch(`/api/render-status?id=${encodeURIComponent(id)}`)
  const data = await response.json()
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte hämta renderingsstatus.'))
  }
  return data
}

const POLL_INTERVAL_MS = 3000
const MAX_POLL_ATTEMPTS = 60 // ~3 minuter

// Startar en rendering och pollar tills den är klar. onStatus(status) anropas vid varje
// pollning så anroparen kan visa förlopp.
export async function renderClip({
  videoUrl,
  segmentsPlan,
  transcript,
  hookText,
  suggestedSubtitles,
  brollVideoUrl,
  segmentEffects,
  segmentFilters,
  words,
  effectVideoUrl,
  effectType,
  backgroundImageUrl,
  backgroundMattedVideoUrl,
  thoughtBubbles,
  thoughtBubblesEnabled,
  onStatus,
}) {
  const id = await submitRender({
    videoUrl,
    segmentsPlan,
    transcript,
    hookText,
    suggestedSubtitles,
    brollVideoUrl,
    segmentEffects,
    segmentFilters,
    words,
    effectVideoUrl,
    effectType,
    backgroundImageUrl,
    backgroundMattedVideoUrl,
    thoughtBubbles,
    thoughtBubblesEnabled,
  })

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    const result = await getRenderStatus(id)
    onStatus?.(result.status)

    if (result.status === 'done') return result.url
    if (result.status === 'failed') {
      throw new Error(result.error ?? 'Renderingen misslyckades hos Shotstack.')
    }
  }

  throw new Error('Renderingen tog för lång tid. Kontrollera Shotstack-dashboarden och försök igen.')
}
