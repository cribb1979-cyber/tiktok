// Bildspel (valfritt tillval, opt-in): flera egna bilder + valfri text per bild blir en
// video, med (valfri) AI-genererad musik under — efterfrågat direkt av användaren efter att
// musikgenereringen fanns på plats ("nu kan jag generera musik, så vill jag kunna lägga
// bilder med text... bilderna som blir en video och musiken på de"). Till skillnad från
// AI-kortfilm (som AI-genererar både bilder och rörelse) är det här HELT egna, uppladdade
// stillbilder — ingen AI-bildgenerering inblandad här, bara Shotstack-sammanställning.
//
// Återanvänder BEFINTLIGA, redan verifierade Shotstack-mönster från render-clip.ts (image-
// asset med effect/transition för Ken Burns-liknande rörelse, title-asset för bildtext i
// samma TikTok-captionstil) istället för att gissa nya — men som en helt egen, självständig
// edge function (inte en utökning av render-clip.ts, som är hårt kopplad till
// segments_plan/klipp-modellen och skulle bli svårare att resonera om med en helt annan
// datamodell inbakad). Pollas via BEFINTLIGA /api/render-status — samma Shotstack render-id-
// kontrakt oavsett vilken edge function som submittade jobbet, ingen ny statusendpoint
// behövdes. SHOTSTACK_API_KEY exponeras aldrig i klienten.

const SHOTSTACK_STAGE_HOST = 'https://api.shotstack.io/stage'
const SHOTSTACK_PROD_HOST = 'https://api.shotstack.io/v1'
function resolveShotstackHost(preview: boolean): string {
  if (preview) return SHOTSTACK_STAGE_HOST
  return Deno.env.get('SHOTSTACK_ENV') === 'v1' ? SHOTSTACK_PROD_HOST : SHOTSTACK_STAGE_HOST
}

const OUTPUT_SIZE = { width: 1080, height: 1920 } // 9:16, TikTok-format — samma som render-clip.ts

const DEFAULT_DURATION_PER_IMAGE = 3
const MIN_DURATION_PER_IMAGE = 1
const MAX_DURATION_PER_IMAGE = 15
const MAX_IMAGES = 30

// Samma bildtextstil som render-clip.ts's vanliga (icke-ord-för-ord) captions — vit text,
// halvgenomskinlig svart bakgrundsruta, "minimal"-stil, botten-position.
const TEXT_BACKGROUND = '#CC000000'
const CAPTION_MAX_CHARS = 60
const CAPTION_CHARS_PER_LINE = 20

// Samma effekt-/övergångsrotation som render-clip.ts (SEGMENT_EFFECTS/SEGMENT_TRANSITIONS_IN)
// — ger variation mellan bilderna istället för att varje bild rör sig likadant.
const IMAGE_EFFECTS = ['zoomInFast', 'zoomOutFast', 'slideLeftFast', 'slideRightFast', 'slideUpFast', 'slideDownFast']

type SlideshowImage = { url: string; caption?: string }

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = Deno.env.get('SHOTSTACK_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'SHOTSTACK_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
  }

  const rawImages = Array.isArray(body.images) ? body.images : []
  const images: SlideshowImage[] = rawImages
    .filter((img): img is Record<string, unknown> => img != null && typeof img === 'object')
    .map((img) => ({
      url: typeof img.url === 'string' ? img.url : '',
      caption: typeof img.caption === 'string' ? img.caption.trim() : '',
    }))
    .filter((img) => img.url)

  if (images.length === 0) {
    return jsonResponse({ error: 'images (minst en bild med url) krävs.' }, 400)
  }
  if (images.length > MAX_IMAGES) {
    return jsonResponse({ error: `Max ${MAX_IMAGES} bilder per bildspel.` }, 400)
  }

  const durationPerImage = Math.min(
    Math.max(
      typeof body.durationPerImageSeconds === 'number' && body.durationPerImageSeconds > 0
        ? body.durationPerImageSeconds
        : DEFAULT_DURATION_PER_IMAGE,
      MIN_DURATION_PER_IMAGE
    ),
    MAX_DURATION_PER_IMAGE
  )

  const musicAudioUrl = typeof body.musicAudioUrl === 'string' ? body.musicAudioUrl : null
  // Högre default-volym än render-clip.ts's musicVolume (0.25) — där ligger musiken UNDER
  // tal/berättarröst, här är musiken (om vald) det enda ljudet, ingen konkurrerande dialog.
  const musicVolume =
    typeof body.musicVolume === 'number' && body.musicVolume >= 0 && body.musicVolume <= 1 ? body.musicVolume : 0.7
  const preview = body.preview === true

  const videoClips: Record<string, unknown>[] = []
  const captionClips: Record<string, unknown>[] = []
  let timelineCursor = 0

  images.forEach((img, index) => {
    const transition = { in: index === 0 ? 'fadeFast' : 'fadeFast', out: 'fadeFast' }
    videoClips.push({
      asset: { type: 'image', src: img.url },
      start: timelineCursor,
      length: durationPerImage,
      fit: 'cover',
      effect: IMAGE_EFFECTS[index % IMAGE_EFFECTS.length],
      transition,
    })

    if (img.caption) {
      captionClips.push({
        asset: {
          type: 'title',
          text: wrapText(truncateForOverlay(img.caption, CAPTION_MAX_CHARS), CAPTION_CHARS_PER_LINE),
          style: 'minimal',
          color: '#ffffff',
          background: TEXT_BACKGROUND,
          size: 'small',
          position: 'bottom',
        },
        start: timelineCursor,
        length: durationPerImage,
      })
    }

    timelineCursor += durationPerImage
  })

  const musicClips = musicAudioUrl
    ? [
        {
          asset: { type: 'audio', src: musicAudioUrl, volume: musicVolume },
          start: 0,
          length: timelineCursor,
        },
      ]
    : []

  const tracks = [{ clips: captionClips }, { clips: videoClips }, { clips: musicClips }].filter(
    (track) => track.clips.length > 0
  )

  const editPayload = {
    timeline: {
      background: '#000000',
      tracks,
    },
    output: {
      format: 'mp4',
      size: OUTPUT_SIZE,
    },
  }

  const shotstackHost = resolveShotstackHost(preview)

  let shotstackResponse: Response
  try {
    shotstackResponse = await fetch(`${shotstackHost}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(editPayload),
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå Shotstack API.', detail: String(err) }, 502)
  }

  const rawText = await shotstackResponse.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka Shotstacks svar som JSON.', raw: rawText }, 502)
  }

  const responseData = data?.response as Record<string, unknown> | undefined
  if (!shotstackResponse.ok || !responseData?.id) {
    return jsonResponse({ error: 'Shotstack API-fel', detail: data }, 502)
  }

  return jsonResponse({ id: responseData.id }, 200)
}

function truncateForOverlay(text: string, maxChars: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= maxChars) return trimmed
  const sliced = trimmed.slice(0, maxChars - 1)
  const lastSpace = sliced.lastIndexOf(' ')
  const cut = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced
  return cut.trimEnd() + '…'
}

function wrapText(text: string, maxCharsPerLine: number): string {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.join('\n')
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/render-slideshow',
}
