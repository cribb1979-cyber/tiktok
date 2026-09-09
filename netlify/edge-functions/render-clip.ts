// Steg 6: startar en rendering hos Shotstack — bränner in undertexter (från transkriptet
// eller segmentens beskrivning), en enkel zoom-effekt per segment, och hook-texten som
// textöverlägg i början. SHOTSTACK_API_KEY exponeras aldrig i klienten.

// "stage" = Shotstack sandbox (gratis, vattenstämplat) — säkert default tills du har en
// produktionsnyckel. Sätt SHOTSTACK_ENV=v1 i Netlify när du vill rendera skarpt.
const SHOTSTACK_HOST =
  Deno.env.get('SHOTSTACK_ENV') === 'v1' ? 'https://api.shotstack.io/v1' : 'https://api.shotstack.io/stage'

const OUTPUT_SIZE = { width: 1080, height: 1920 } // 9:16, TikTok-format

type Segment = { start: string; end: string; description?: string; order?: number }
type TranscriptSegment = { start: number; end: number; text: string }

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

  const videoUrl = body.videoUrl
  const segmentsPlan = Array.isArray(body.segmentsPlan) ? (body.segmentsPlan as Segment[]) : []
  const transcript = Array.isArray(body.transcript) ? (body.transcript as TranscriptSegment[]) : []
  const hookText = typeof body.hookText === 'string' ? body.hookText : ''

  if (!videoUrl || typeof videoUrl !== 'string') {
    return jsonResponse({ error: 'videoUrl krävs (publik URL till källvideon).' }, 400)
  }
  if (segmentsPlan.length === 0) {
    return jsonResponse({ error: 'segmentsPlan (icke-tom lista) krävs.' }, 400)
  }

  const videoClips = []
  const captionClips = []
  let timelineCursor = 0

  for (const seg of segmentsPlan) {
    const trimStart = parseTimecode(seg.start)
    const trimEnd = parseTimecode(seg.end)
    const length = Math.max(trimEnd - trimStart, 0.5)

    videoClips.push({
      asset: { type: 'video', src: videoUrl, trim: trimStart, volume: 1 },
      start: timelineCursor,
      length,
      fit: 'crop',
      effect: 'zoomIn',
    })

    const caption =
      transcript
        .filter((t) => t.start >= trimStart && t.start < trimEnd)
        .map((t) => t.text)
        .join(' ')
        .trim() || seg.description || ''

    if (caption) {
      captionClips.push({
        asset: {
          type: 'title',
          text: caption,
          style: 'minimal',
          color: '#ffffff',
          size: 'small',
          position: 'bottom',
        },
        start: timelineCursor,
        length,
      })
    }

    timelineCursor += length
  }

  const hookClip = hookText
    ? [
        {
          asset: {
            type: 'title',
            text: hookText,
            style: 'blockbuster',
            color: '#ffffff',
            size: 'large',
            position: 'center',
          },
          start: 0,
          length: Math.min(2.5, timelineCursor),
        },
      ]
    : []

  const tracks = [{ clips: hookClip }, { clips: captionClips }, { clips: videoClips }].filter(
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

  let shotstackResponse: Response
  try {
    shotstackResponse = await fetch(`${SHOTSTACK_HOST}/render`, {
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

  const data = await shotstackResponse.json()

  if (!shotstackResponse.ok || !data?.response?.id) {
    return jsonResponse({ error: 'Shotstack API-fel', detail: data }, 502)
  }

  return jsonResponse({ id: data.response.id }, 200)
}

function parseTimecode(tc: string): number {
  const parts = String(tc).split(':').map(Number)
  if (parts.length === 2 && parts.every((n) => !Number.isNaN(n))) {
    return parts[0] * 60 + parts[1]
  }
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  return Number(tc) || 0
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/render-clip',
}
