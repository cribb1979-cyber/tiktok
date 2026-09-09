// Steg 6: startar en rendering hos Shotstack — bränner in korta textöverlägg (nyckelfraser,
// inte hela meningar — enligt spec: "textöverlägg vid nyckelord"), en zoom-effekt per segment
// med tydliga övergångar mellan klippen, och hook-texten i början.
// SHOTSTACK_API_KEY exponeras aldrig i klienten.

// "stage" = Shotstack sandbox (gratis, vattenstämplat) — säkert default tills du har en
// produktionsnyckel. Sätt SHOTSTACK_ENV=v1 i Netlify när du vill rendera skarpt.
const SHOTSTACK_HOST =
  Deno.env.get('SHOTSTACK_ENV') === 'v1' ? 'https://api.shotstack.io/v1' : 'https://api.shotstack.io/stage'

const OUTPUT_SIZE = { width: 1080, height: 1920 } // 9:16, TikTok-format

// Shotstacks title-klipp radbryter inte text automatiskt, och "minimal"/"blockbuster" har
// bred bokstavsspaltning — långa rader (även efter radbrytning på ordantal) gick fortfarande
// utanför bildkanten. Håll överlägg korta (nyckelfraser, inte hela meningar) och räkna
// konservativt med få tecken per rad.
const CAPTION_MAX_CHARS = 34
const CAPTION_CHARS_PER_LINE = 15
const HOOK_MAX_CHARS = 26
const HOOK_CHARS_PER_LINE = 11

// Alternerande effekter ger mer synlig rörelse/klippkänsla än samma svaga zoom hela tiden.
const SEGMENT_EFFECTS = ['zoomInFast', 'zoomOutFast']

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
  const suggestedSubtitles = Array.isArray(body.suggestedSubtitles)
    ? (body.suggestedSubtitles as string[]).filter((s) => typeof s === 'string' && s.trim())
    : []

  if (!videoUrl || typeof videoUrl !== 'string') {
    return jsonResponse({ error: 'videoUrl krävs (publik URL till källvideon).' }, 400)
  }
  if (segmentsPlan.length === 0) {
    return jsonResponse({ error: 'segmentsPlan (icke-tom lista) krävs.' }, 400)
  }

  const videoClips = []
  const captionClips = []
  let timelineCursor = 0

  segmentsPlan.forEach((seg, index) => {
    const trimStart = parseTimecode(seg.start)
    const trimEnd = parseTimecode(seg.end)
    const length = Math.max(trimEnd - trimStart, 0.5)

    videoClips.push({
      asset: { type: 'video', src: videoUrl, trim: trimStart, volume: 1 },
      start: timelineCursor,
      length,
      fit: 'crop',
      effect: SEGMENT_EFFECTS[index % SEGMENT_EFFECTS.length],
      transition: { in: index === 0 ? 'fade' : 'wipeLeft', out: 'fade' },
    })

    // Nyckelfras framför allt — matchar spec ("textöverlägg vid nyckelord") och är
    // strukturellt kort nog att aldrig gå utanför bildkanten. Faller tillbaka till
    // transkript/segmentbeskrivning (hårt förkortat) om inga nyckelfraser finns.
    const rawCaption =
      suggestedSubtitles.length > 0
        ? suggestedSubtitles[index % suggestedSubtitles.length]
        : transcript
            .filter((t) => t.start >= trimStart && t.start < trimEnd)
            .map((t) => t.text)
            .join(' ')
            .trim() || seg.description || ''

    if (rawCaption) {
      captionClips.push({
        asset: {
          type: 'title',
          text: wrapText(truncateForOverlay(rawCaption, CAPTION_MAX_CHARS), CAPTION_CHARS_PER_LINE),
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
  })

  const hookClip = hookText
    ? [
        {
          asset: {
            type: 'title',
            text: wrapText(truncateForOverlay(hookText, HOOK_MAX_CHARS), HOOK_CHARS_PER_LINE),
            style: 'blockbuster',
            color: '#ffffff',
            size: 'medium',
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

// Korta ner text innan radbrytning — håller textöverlägg vid nyckelfraser istället för
// hela meningar, oavsett källa (nyckelfras, transkript eller segmentbeskrivning).
function truncateForOverlay(text: string, maxChars: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= maxChars) return trimmed
  return trimmed.slice(0, maxChars - 1).trimEnd() + '…'
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
