import { errorMessage, parseJsonResponse } from './apiError.js'

// Anropar Netlify Edge Function /api/render-slideshow — aldrig Shotstack direkt från
// klienten. Pollas via BEFINTLIGA /api/render-status (samma Shotstack render-id-kontrakt
// oavsett vilken edge function som submittade jobbet, se render-status.ts) — samma
// done/failed-status som renderClip i shotstackClient.js.
//
// images: [{ url, caption }] — url krävs, caption valfri text-overlay för just den bilden.

async function submitSlideshow({ images, durationPerImageSeconds, musicAudioUrl, musicVolume, preview }) {
  const response = await fetch('/api/render-slideshow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, durationPerImageSeconds, musicAudioUrl, musicVolume, preview }),
  })

  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta bildspel-renderingen.'))
  }
  return data.id
}

async function getSlideshowStatus(id, preview) {
  const response = await fetch(`/api/render-status?id=${encodeURIComponent(id)}${preview ? '&preview=true' : ''}`)
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte hämta renderingsstatus.'))
  }
  return data
}

const POLL_INTERVAL_MS = 3000
const MAX_POLL_ATTEMPTS = 60 // ~3 minuter — samma tålamodsgräns som renderClip

export async function renderSlideshow({
  images,
  durationPerImageSeconds,
  musicAudioUrl,
  musicVolume,
  preview,
  onStatus,
}) {
  const id = await submitSlideshow({ images, durationPerImageSeconds, musicAudioUrl, musicVolume, preview })

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    const result = await getSlideshowStatus(id, preview)
    onStatus?.(result.status)

    if (result.status === 'done') return result.url
    if (result.status === 'failed') {
      throw new Error(result.error ?? 'Renderingen misslyckades hos Shotstack.')
    }
  }

  throw new Error('Renderingen tog för lång tid. Kontrollera Shotstack-dashboarden och försök igen.')
}
