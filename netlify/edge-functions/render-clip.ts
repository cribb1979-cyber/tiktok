// Steg 6: startar en rendering hos Shotstack — bränner in korta textöverlägg (nyckelfraser,
// inte hela meningar — enligt spec: "textöverlägg vid nyckelord") med bakgrundsruta för
// läsbarhet, varierande effekter/övergångar mellan segmenten, hook-texten i början, (valfritt)
// ett inklippt AI-genererat B-roll-segment mellan huvudklippen, (valfritt) en AI-genererad
// overlay-effekt (ljusklot/dimma/gnistor/kantglöd/static, se EFFECT_COMPOSITE) ovanpå det
// första segmentet, och (valfritt) ett AI-bakgrundsbyte som ERSÄTTER första segmentets
// bakgrund med en AI-genererad bild (se backgroundSwapActive, generate-background.ts,
// matte-video.ts). SHOTSTACK_API_KEY exponeras aldrig i klienten.

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

// Halvgenomskinlig svart bakgrundsruta bakom text — TikTok-typisk captionstil, och ett extra
// skyddsnät för läsbarhet oavsett underliggande footage. Shotstack anger alpha FÖRST i
// hex-strängen (#AARRGGBB), omvänt mot vanlig CSS — "CC" ≈ 80% opacitet.
const TEXT_BACKGROUND = '#CC000000'

// Fler effekttyper ger mer visuell variation än samma zoom hela tiden.
// Bara "Fast"-varianter — de långsamma presets (zoomIn/zoomOut/slideLeft/slideRight utan
// suffix) var för subtila för att märkas i ett kort TikTok-klipp.
const SEGMENT_EFFECTS = ['zoomInFast', 'zoomOutFast', 'slideLeftFast', 'slideRightFast', 'slideUpFast', 'slideDownFast']
const SEGMENT_TRANSITIONS_IN = ['fadeFast', 'wipeLeft', 'wipeRight', 'slideLeft', 'slideRight']

// B-roll-segmentet klipps in direkt efter det första huvudsegmentet (ett klassiskt
// "cutaway"-snitt: shot → cutaway → tillbaka till shot) istället för att bara vara en
// fristående, oanvänd fil.
const BROLL_DEFAULT_DURATION = 5

// AI-effekt (genererad med ren svart bakgrund — utom "static" — via generate-broll.ts,
// effectMode) läggs som ett eget lager OVANPÅ videon under det första segmentet. De
// kromakey-baserade typerna (orb/mist/sparks/edgeGlow) tar bort den svarta bakgrunden så
// bara motivet syns över footaget; "static" är hela bilden i sig och läggs på med opacity
// istället, som en kort "glitch"-blink.
const EFFECT_CHROMA_KEY = { color: '#000000', threshold: 150, halo: 100 }
const EFFECT_COMPOSITE: Record<
  string,
  { chromaKey: boolean; fit?: string; scale?: number; position: string; opacity?: number; defaultDuration: number }
> = {
  orb: { chromaKey: true, scale: 0.45, position: 'center', defaultDuration: 4 },
  mist: { chromaKey: true, fit: 'crop', position: 'bottom', defaultDuration: 5 },
  sparks: { chromaKey: true, fit: 'crop', position: 'center', defaultDuration: 4 },
  edgeGlow: { chromaKey: true, scale: 0.5, position: 'right', defaultDuration: 4 },
  static: { chromaKey: false, fit: 'crop', position: 'center', opacity: 0.5, defaultDuration: 0.6 },
  eyes: { chromaKey: true, scale: 0.4, position: 'center', defaultDuration: 3 },
}
const DEFAULT_EFFECT_COMPOSITE = EFFECT_COMPOSITE.orb

type Segment = { start: string; end: string; description?: string; order?: number }
type TranscriptSegment = { start: number; end: number; text: string }
type WordTiming = { word: string; start: number; end: number }

// Ord-för-ord-undertexter byggs som korta html-klipp (ett ord i taget, stort och fetstilat) —
// samma mönster som Shotstacks eget "kinetic-text"-exempel, verifierat schema. Undviker den
// nyare "Rich Captions"-asset-typen vars exakta fältnamn inte gick att verifiera mot
// Shotstacks dokumentation från den här miljön (nätverksbegränsningar) — att gissa fel där
// hade riskerat en misslyckad rendering.
const WORD_CAPTION_CSS =
  'p { font-family: Arial, Helvetica, sans-serif; color: #ffffff; font-size: 64px; ' +
  'text-align: center; font-weight: 800; text-transform: uppercase; ' +
  'text-shadow: 0 0 10px rgba(0,0,0,0.85), 0 4px 4px rgba(0,0,0,0.85); margin: 0; }'
const WORD_CAPTION_MIN_LENGTH = 0.12

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

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
  const brollVideoUrl = typeof body.brollVideoUrl === 'string' ? body.brollVideoUrl : null
  // Manuellt val av effekt per segment från Klippstudio (se SEGMENT_EFFECT_OPTIONS i
  // constants.js) — tomt/saknat värde för ett index betyder "automatiskt", dvs. samma
  // cyklande fallback som innan detta fanns.
  const segmentEffects = Array.isArray(body.segmentEffects) ? (body.segmentEffects as unknown[]) : []
  // Manuellt val av färgfilter per segment (se SEGMENT_FILTER_OPTIONS i constants.js) — tomt
  // värde betyder inget filter alls (inte cyklande automatik, till skillnad från effect).
  const segmentFilters = Array.isArray(body.segmentFilters) ? (body.segmentFilters as unknown[]) : []
  // Ord-nivå-tidsstämplar från Whisper (transcribe.ts), för ord-för-ord-animerade
  // undertexter (CapCut/TikTok-stil) istället för statiska frasöverlägg. Tom lista om
  // transkribering hoppades över (fil >25 MB) eller inget råmaterial finns.
  const words = Array.isArray(body.words) ? (body.words as WordTiming[]) : []
  const brollDuration =
    typeof body.brollDurationSeconds === 'number' && body.brollDurationSeconds > 0
      ? body.brollDurationSeconds
      : BROLL_DEFAULT_DURATION
  // AI-effekt (ljusklot/dimma/gnistor/kantglöd/static) — läggs ovanpå videon, se
  // EFFECT_COMPOSITE ovan. effectType måste matcha vad klippet faktiskt genererades som
  // (samma värde som skickades till /api/generate-broll som effectMode).
  const effectVideoUrl = typeof body.effectVideoUrl === 'string' ? body.effectVideoUrl : null
  const effectComposite =
    typeof body.effectType === 'string' && body.effectType in EFFECT_COMPOSITE
      ? EFFECT_COMPOSITE[body.effectType]
      : DEFAULT_EFFECT_COMPOSITE
  const effectDuration =
    typeof body.effectDurationSeconds === 'number' && body.effectDurationSeconds > 0
      ? body.effectDurationSeconds
      : effectComposite.defaultDuration
  // Bakgrundsbyte: en AI-genererad bakgrundsbild (generate-background.ts) + användarens
  // egen video med bakgrunden borttagen mot grönt (matte-video.ts) — ersätter det första
  // segmentets normala klipp med en komposit av de två, istället för att lägga till ett
  // extra lager. Kräver båda URL:erna för att aktiveras.
  const backgroundImageUrl = typeof body.backgroundImageUrl === 'string' ? body.backgroundImageUrl : null
  const backgroundMattedVideoUrl =
    typeof body.backgroundMattedVideoUrl === 'string' ? body.backgroundMattedVideoUrl : null
  const backgroundSwapActive = Boolean(backgroundImageUrl && backgroundMattedVideoUrl)

  if (!videoUrl || typeof videoUrl !== 'string') {
    return jsonResponse({ error: 'videoUrl krävs (publik URL till källvideon).' }, 400)
  }
  if (segmentsPlan.length === 0) {
    return jsonResponse({ error: 'segmentsPlan (icke-tom lista) krävs.' }, 400)
  }

  const videoClips = []
  const captionClips = []
  const effectClips = []
  // Eget spår för bakgrundsbilden vid bakgrundsbyte — måste ligga på ett ANNAT spår än
  // videoClips, inte samma, eftersom klipp inom ett och samma Shotstack-spår läggs i
  // sekvens och inte får överlappa i tid (till skillnad från olika spår, som får överlappa
  // och då renderas ovanpå varandra enligt spårordningen).
  const backgroundClips = []
  let timelineCursor = 0

  segmentsPlan.forEach((seg, index) => {
    const trimStart = parseTimecode(seg.start)
    const trimEnd = parseTimecode(seg.end)
    const length = Math.max(trimEnd - trimStart, 0.5)
    const manualEffect = segmentEffects[index]
    const effect =
      typeof manualEffect === 'string' && manualEffect
        ? manualEffect
        : SEGMENT_EFFECTS[index % SEGMENT_EFFECTS.length]
    const manualFilter = segmentFilters[index]
    const transition = {
      in: index === 0 ? 'fadeFast' : SEGMENT_TRANSITIONS_IN[index % SEGMENT_TRANSITIONS_IN.length],
      out: 'fadeFast',
    }

    if (index === 0 && backgroundSwapActive) {
      // Bakgrundsbilden fyller hela segmentets yta — eget spår (backgroundClips), inte
      // videoClips, se kommentaren ovanför backgroundClips-deklarationen för varför.
      backgroundClips.push({
        asset: { type: 'image', src: backgroundImageUrl },
        start: timelineCursor,
        length,
        fit: 'cover',
      })
      // ...och den grön-nycklade riktiga personen läggs ovanpå (på videoClips-spåret, som
      // ligger högre upp i spårordningen än backgroundClips), trimmad till samma
      // tidsintervall som segmentet skulle haft i originalvideon (backgroundMattedVideoUrl
      // är hela originalvideon med bakgrunden borttagen, inte bara segmentet). Manuellt
      // färgfilter hoppas medvetet över här — det kan störa en redan känslig kromakey-
      // nyckling.
      videoClips.push({
        asset: {
          type: 'video',
          src: backgroundMattedVideoUrl,
          trim: trimStart,
          volume: 1,
          chromaKey: { color: '#00FF00', threshold: 150, halo: 100 },
        },
        start: timelineCursor,
        length,
        fit: 'crop',
        effect,
        transition,
      })
    } else {
      videoClips.push({
        asset: { type: 'video', src: videoUrl, trim: trimStart, volume: 1 },
        start: timelineCursor,
        length,
        fit: 'crop',
        effect,
        ...(typeof manualFilter === 'string' && manualFilter ? { filter: manualFilter } : {}),
        transition,
      })
    }

    // Ord-för-ord om vi har riktiga tidsstämplar för det här segmentet (CapCut/TikTok-stil,
    // synkat exakt mot talet) — annars en statisk frasöverlägg som tidigare.
    const segmentWords = words.filter((w) => w.start >= trimStart && w.start < trimEnd)

    if (segmentWords.length > 0) {
      for (const w of segmentWords) {
        const word = w.word.trim()
        if (!word) continue
        captionClips.push({
          asset: {
            type: 'html',
            html: `<p>${escapeHtml(word)}</p>`,
            css: WORD_CAPTION_CSS,
            width: 950,
            height: 220,
            position: 'bottom',
          },
          start: timelineCursor + Math.max(w.start - trimStart, 0),
          length: Math.max(w.end - w.start, WORD_CAPTION_MIN_LENGTH),
        })
      }
    } else {
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
            background: TEXT_BACKGROUND,
            size: 'small',
            position: 'bottom',
          },
          start: timelineCursor,
          length,
        })
      }
    }

    // AI-effekt läggs ovanpå det första segmentet, från dess start — inte längre än
    // segmentet själv eller effektens egen längd, det som är kortast.
    if (index === 0 && effectVideoUrl) {
      effectClips.push({
        asset: {
          type: 'video',
          src: effectVideoUrl,
          trim: 0,
          volume: 0,
          ...(effectComposite.chromaKey ? { chromaKey: EFFECT_CHROMA_KEY } : {}),
        },
        start: timelineCursor,
        length: Math.min(effectDuration, length),
        position: effectComposite.position,
        ...(effectComposite.scale !== undefined ? { scale: effectComposite.scale } : {}),
        ...(effectComposite.fit !== undefined ? { fit: effectComposite.fit } : {}),
        ...(effectComposite.opacity !== undefined ? { opacity: effectComposite.opacity } : {}),
      })
    }

    timelineCursor += length

    // B-roll klipps in som ett eget, kortare segment direkt efter första huvudklippet —
    // inget textöverlägg här, bara atmosfärisk bild mellan de faktiska klippen.
    if (index === 0 && brollVideoUrl) {
      videoClips.push({
        asset: { type: 'video', src: brollVideoUrl, trim: 0, volume: 0 },
        start: timelineCursor,
        length: brollDuration,
        fit: 'crop',
        effect: 'zoomInFast',
        transition: { in: 'fadeFast', out: 'fadeFast' },
      })
      timelineCursor += brollDuration
    }
  })

  const hookClip = hookText
    ? [
        {
          asset: {
            type: 'title',
            text: wrapText(truncateForOverlay(hookText, HOOK_MAX_CHARS), HOOK_CHARS_PER_LINE),
            style: 'blockbuster',
            color: '#ffffff',
            background: TEXT_BACKGROUND,
            size: 'medium',
            position: 'center',
          },
          start: 0,
          length: Math.min(2.5, timelineCursor),
        },
      ]
    : []

  const tracks = [
    { clips: hookClip },
    { clips: captionClips },
    { clips: effectClips },
    { clips: videoClips },
    { clips: backgroundClips },
  ].filter((track) => track.clips.length > 0)

  const editPayload = {
    timeline: {
      background: '#000000',
      tracks,
    },
    output: {
      format: 'mp4',
      size: OUTPUT_SIZE,
      // Shotstacks default ("medium") är optimerad för liten filstorlek, inte skärpa.
      // "high" är i princip visuellt lossless — rätt val för en slutgiltig TikTok-leverans
      // som inte transkodas vidare av oss (TikTok komprimerar den själva vid uppladdning,
      // så bättre att gå in med så hög kvalitet som möjligt).
      quality: 'high',
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
// hela meningar, oavsett källa (nyckelfras, transkript eller segmentbeskrivning). Kapar vid
// senaste ordgränsen inom gränsen, inte mitt i ett ord (t.ex. "FLÖD…" istället för "FLÖDA…")
// — en ren teckengräns såg trasig/oavsiktlig ut i skarpa klipp.
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
