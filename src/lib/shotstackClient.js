import { errorMessage, parseJsonResponse } from './apiError.js'

// Anropar Netlify Edge Functions /api/render-clip och /api/render-status — aldrig
// Shotstack API direkt från klienten.
//
// clips: [{ id, url, transcript, words }] — ett eller flera uppladdade råklipp. Varje
// segment i segmentsPlan har ett clip_id som pekar ut vilket av dem det klipps från (satt
// av generate-plan.ts/revise-plan.ts). Ett enda klipp fungerar som tidigare, bara som en
// lista med ett element.

async function submitRender({
  clips,
  segmentsPlan,
  hookText,
  suggestedSubtitles,
  brollVideoUrl,
  segmentEffects,
  segmentFilters,
  segmentStarts,
  segmentEnds,
  segmentSpeeds,
  effectVideoUrl,
  effectType,
  effectStartOffsetSeconds,
  backgroundImageUrl,
  backgroundMattedVideoUrl,
  thoughtBubbles,
  thoughtBubblesEnabled,
  thoughtBubbleXPercent,
  thoughtBubbleYPercent,
  glowEffect,
  preview,
}) {
  const response = await fetch('/api/render-clip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clips,
      segmentsPlan,
      hookText,
      suggestedSubtitles,
      brollVideoUrl,
      segmentEffects,
      segmentFilters,
      segmentStarts,
      segmentEnds,
      segmentSpeeds,
      effectVideoUrl,
      effectType,
      effectStartOffsetSeconds,
      backgroundImageUrl,
      backgroundMattedVideoUrl,
      thoughtBubbles,
      thoughtBubblesEnabled,
      thoughtBubbleXPercent,
      thoughtBubbleYPercent,
      glowEffect,
      preview,
    }),
  })

  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta rendering.'))
  }
  return data.id
}

async function getRenderStatus(id, preview) {
  const response = await fetch(
    `/api/render-status?id=${encodeURIComponent(id)}${preview ? '&preview=true' : ''}`
  )
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte hämta renderingsstatus.'))
  }
  return data
}

const POLL_INTERVAL_MS = 3000
const MAX_POLL_ATTEMPTS = 60 // ~3 minuter

// Startar en rendering och pollar tills den är klar. onStatus(status) anropas vid varje
// pollning så anroparen kan visa förlopp.
//
// preview: true (valfritt) — gratis, vattenstämplad sandbox-rendering (se render-clip.ts)
// istället för den skarpa/betalda, med samma edit-JSON så resultatet stämmer med den
// riktiga renderingen. Måste skickas med till BÅDE submit och varje statuspollning, annars
// letar pollningen i fel Shotstack-miljö efter jobbet.
export async function renderClip({
  clips,
  segmentsPlan,
  hookText,
  suggestedSubtitles,
  brollVideoUrl,
  segmentEffects,
  segmentFilters,
  segmentStarts,
  segmentEnds,
  segmentSpeeds,
  effectVideoUrl,
  effectType,
  effectStartOffsetSeconds,
  backgroundImageUrl,
  backgroundMattedVideoUrl,
  thoughtBubbles,
  thoughtBubblesEnabled,
  thoughtBubbleXPercent,
  thoughtBubbleYPercent,
  glowEffect,
  preview,
  onStatus,
}) {
  const id = await submitRender({
    clips,
    segmentsPlan,
    hookText,
    suggestedSubtitles,
    brollVideoUrl,
    segmentEffects,
    segmentFilters,
    segmentStarts,
    segmentEnds,
    segmentSpeeds,
    effectVideoUrl,
    effectType,
    effectStartOffsetSeconds,
    backgroundImageUrl,
    backgroundMattedVideoUrl,
    thoughtBubbles,
    thoughtBubblesEnabled,
    thoughtBubbleXPercent,
    thoughtBubbleYPercent,
    glowEffect,
    preview,
  })

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    const result = await getRenderStatus(id, preview)
    onStatus?.(result.status)

    if (result.status === 'done') return result.url
    if (result.status === 'failed') {
      throw new Error(result.error ?? 'Renderingen misslyckades hos Shotstack.')
    }
  }

  throw new Error('Renderingen tog för lång tid. Kontrollera Shotstack-dashboarden och försök igen.')
}
