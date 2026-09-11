// Steg 6: startar en rendering hos Shotstack — bränner in korta textöverlägg (nyckelfraser,
// inte hela meningar — enligt spec: "textöverlägg vid nyckelord") med bakgrundsruta för
// läsbarhet, varierande effekter/övergångar mellan segmenten, hook-texten i början, (valfritt)
// ett inklippt AI-genererat B-roll-segment mellan huvudklippen, (valfritt) en AI-genererad
// overlay-effekt (ljusklot/dimma/gnistor/kantglöd/static, se EFFECT_COMPOSITE) ovanpå det
// första segmentet, och (valfritt) ett AI-bakgrundsbyte som ERSÄTTER första segmentets
// bakgrund med en AI-genererad bild (se backgroundSwapActive, generate-background.ts,
// matte-video.ts), och (valfritt) en manuellt positionerad, pulserande glow-overlay
// (glowEffect, se GLOW_* nedan) — fast position under ett tidsintervall, ingen AI-spårning.
// Start-/sluttid och uppspelningshastighet per segment kan också redigeras manuellt
// (segmentStarts/segmentEnds/segmentSpeeds) — override av AI-förslaget i segmentsPlan.
// SHOTSTACK_API_KEY exponeras aldrig i klienten.
//
// Flera klipp: `clips` är en lista av uppladdade råklipp ([{id, url, transcript, words}]) —
// varje segment i segmentsPlan pekar ut VILKET klipp (clip_id, satt av generate-plan.ts eller
// revise-plan.ts) dess start/end/undertexter kommer från. Ett enda uppladdat klipp fungerar
// precis som tidigare, bara som en lista med ett element. Övergångarna mellan segment
// (SEGMENT_TRANSITIONS_IN) bryr sig inte om två på varandra följande segment kommer från
// samma eller olika klipp — samma Shotstack-mekanik fungerar oförändrat över klippgränser.

// "stage" = Shotstack sandbox (gratis, vattenstämplat, 512×288@15fps oavsett begärd
// output.size/quality) — säkert default tills du har en produktionsnyckel. Sätt
// SHOTSTACK_ENV=v1 i Netlify när du vill rendera skarpt.
//
// preview: true (skickas från "Snabb förhandsgranskning" i Klippstudio) TVINGAR sandbox
// oavsett SHOTSTACK_ENV — en gratis, riktig (samma motor/JSON som den skarpa renderingen,
// så WYSIWYG är garanterad) förhandsgranskning innan man committar till den betalda
// slutrenderingen. render-status.ts måste pollas med samma preview-flagga (samma host).
const SHOTSTACK_STAGE_HOST = 'https://api.shotstack.io/stage'
const SHOTSTACK_PROD_HOST = 'https://api.shotstack.io/v1'
function resolveShotstackHost(preview: boolean): string {
  if (preview) return SHOTSTACK_STAGE_HOST
  return Deno.env.get('SHOTSTACK_ENV') === 'v1' ? SHOTSTACK_PROD_HOST : SHOTSTACK_STAGE_HOST
}

const OUTPUT_SIZE = { width: 1080, height: 1920 } // 9:16, TikTok-format

// Shotstacks title-klipp radbryter inte text automatiskt, och "minimal"/"blockbuster" har
// bred bokstavsspaltning — långa rader (även efter radbrytning på ordantal) gick fortfarande
// utanför bildkanten. Håll överlägg korta (nyckelfraser, inte hela meningar) och räkna
// konservativt med få tecken per rad.
const CAPTION_MAX_CHARS = 34
const CAPTION_CHARS_PER_LINE = 15
const HOOK_MAX_CHARS = 26
const HOOK_CHARS_PER_LINE = 11
// Hooken ligger på ett eget spår ÖVER tankebubblorna (se tracks-ordningen nedan) under de
// första HOOK_MAX_DURATION sekunderna av hela klippet — måste vara samma värde här och i
// hookClip.length nedan, annars kan en tankebubbla för första segmentet hamna mitt i
// hook-fönstret och krocka visuellt med den (rapporterad bugg: bubbeltext synlig
// bakom/ovanpå hook-texten).
const HOOK_MAX_DURATION = 2.5

// Halvgenomskinlig svart bakgrundsruta bakom text — TikTok-typisk captionstil, och ett extra
// skyddsnät för läsbarhet oavsett underliggande footage. Shotstack anger alpha FÖRST i
// hex-strängen (#AARRGGBB), omvänt mot vanlig CSS — "CC" ≈ 80% opacitet.
const TEXT_BACKGROUND = '#CC000000'

// Tankebubblor — glödande, korta "inre tankar" (plan.thought_bubbles från generate-plan.ts)
// som poppar upp ovanpå bilden, ett per segment. Manuellt positionerad (x/y-procent, samma
// dra-i-canvasen-mönster som glow-overlayen nedan) istället för växlande hörnpresets — låter
// användaren se tankebubblan och glöden TILLSAMMANS i "Klippets sammansättning" i
// Klippstudio. Ren Shotstack html-asset-styling, ingen AI-videogenerering inblandad.
const THOUGHT_BUBBLE_MAX_CHARS = 25
const THOUGHT_BUBBLE_DURATION = 1.8
const THOUGHT_BUBBLE_WIDTH = 620
const THOUGHT_BUBBLE_DEFAULT_X = 50
const THOUGHT_BUBBLE_DEFAULT_Y = 18
function buildThoughtBubbleCss(leftPx: number, topPx: number): string {
  return (
    `.bubble { position: absolute; left: ${leftPx}px; top: ${topPx}px; ` +
    `transform: translate(-50%, -50%); width: ${THOUGHT_BUBBLE_WIDTH}px; ` +
    `font-family: Arial, Helvetica, sans-serif; color: #1a1130; font-size: 38px; ` +
    `font-weight: 700; text-align: center; background: rgba(255,255,255,0.95); ` +
    `border-radius: 45px; padding: 22px 30px; margin: 0; ` +
    `box-shadow: 0 0 25px 10px rgba(178,132,255,0.9), 0 0 60px 24px rgba(124,77,255,0.55); }`
  )
}

// Glow-overlay (valfritt, manuellt positionerad av användaren i Klippstudio) — t.ex. för att
// få en tatuering/symbol/föremål att se ut att glöda som ett kraftmärke. FAST position under
// ett angivet tidsintervall i den FÄRDIGA klippets tidslinje (inte källvideons egna
// tidsstämplar) — INGEN AI-baserad objektspårning, avsedd för klipp där området hålls
// relativt stilla i bild. x_percent/y_percent/radius_percent är alla relativa till
// OUTPUT_SIZE.width (även vertikalt, så cirkeln blir rund oavsett 9:16-formatet).
const GLOW_COLORS: Record<string, string> = {
  gold: '255,200,60',
  blue: '80,160,255',
  white: '255,255,255',
  red: '255,70,70',
}
const GLOW_INTENSITY_OPACITY: Record<string, number> = {
  low: 0.55,
  medium: 0.75,
  high: 0.95,
}
const GLOW_DEFAULT_COLOR = 'gold'
const GLOW_DEFAULT_INTENSITY = 'medium'
// "Mjuk pulsering i opacitet" byggs av flera korta, sekventiella klipp med varierande
// opacity — Shotstacks verifierade klipp-nivå-fält (samma fält som redan används för
// "static"-effekten och bakgrundsbytets kromakey-lager) — snarare än en CSS-animation inuti
// html-asseten, vars beteende över tid i Shotstacks bildruteförrendering inte gick att
// verifiera härifrån (nätverksbegränsningar). Sinusvåg, ca 1,6s period.
const GLOW_PULSE_PERIOD = 1.6
const GLOW_PULSE_STEP = 0.25

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

type Segment = { clip_id?: string; start: string; end: string; description?: string; order?: number }
type TranscriptSegment = { start: number; end: number; text: string }
type WordTiming = { word: string; start: number; end: number }
// Ett uppladdat råklipp — flera kan vara aktuella samtidigt (se "Flera klipp" nedan).
// transcript/words är samma form som tidigare (från Whisper via transcribe.ts), bara
// nästlade per klipp istället för en enda global lista.
type ClipInput = { id: string; url: string; transcript?: TranscriptSegment[]; words?: WordTiming[] }

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

  // Gratis, vattenstämplad sandbox-rendering (se resolveShotstackHost ovan) istället för den
  // skarpa/betalda — samma edit-JSON, bara en annan host.
  const preview = body.preview === true
  const shotstackHost = resolveShotstackHost(preview)

  // Flera klipp: varje segment pekar ut VILKET uppladdat klipp (clip_id) dess start/end
  // syftar på — se generate-plan.ts. Ett enda uppladdat klipp fungerar precis som tidigare,
  // bara uttryckt som en lista med ett element istället för en enskild videoUrl.
  const clips = Array.isArray(body.clips) ? (body.clips as ClipInput[]) : []
  const clipById = new Map(clips.map((c) => [c.id, c]))
  // Fallback till första klippet om ett segments clip_id saknas/inte hittas — defensivt,
  // inte den normala vägen (generate-plan.ts instrueras att alltid sätta ett giltigt id).
  function resolveClip(clipId: string | undefined): ClipInput | undefined {
    return (clipId && clipById.get(clipId)) || clips[0]
  }

  const segmentsPlan = Array.isArray(body.segmentsPlan) ? (body.segmentsPlan as Segment[]) : []
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
  // Tankebubblor (valfritt) — se THOUGHT_BUBBLE_* ovan.
  const thoughtBubbles = Array.isArray(body.thoughtBubbles)
    ? (body.thoughtBubbles as string[]).filter((s) => typeof s === 'string' && s.trim())
    : []
  const thoughtBubblesEnabled = body.thoughtBubblesEnabled === true && thoughtBubbles.length > 0
  // Manuellt positionerad (x/y-procent, se GlowPositioner-mönstret) — saknat/ogiltigt värde
  // faller tillbaka till den gamla ungefärliga standardplatsen (övre mitten).
  const thoughtBubbleXPercent =
    typeof body.thoughtBubbleXPercent === 'number'
      ? Math.min(Math.max(body.thoughtBubbleXPercent, 0), 100)
      : THOUGHT_BUBBLE_DEFAULT_X
  const thoughtBubbleYPercent =
    typeof body.thoughtBubbleYPercent === 'number'
      ? Math.min(Math.max(body.thoughtBubbleYPercent, 0), 100)
      : THOUGHT_BUBBLE_DEFAULT_Y
  // Glow-overlay (valfritt) — se GLOW_* ovan. glowEffect är hela glow_effect-objektet från
  // klippet (samma form som sparas i clips.glow_effect i Supabase).
  const glowEffect =
    body.glowEffect && typeof body.glowEffect === 'object' ? (body.glowEffect as Record<string, unknown>) : null
  const glowEnabled =
    Boolean(glowEffect) &&
    glowEffect?.enabled === true &&
    typeof glowEffect?.x_percent === 'number' &&
    typeof glowEffect?.y_percent === 'number' &&
    typeof glowEffect?.start_seconds === 'number' &&
    typeof glowEffect?.end_seconds === 'number' &&
    (glowEffect.end_seconds as number) > (glowEffect.start_seconds as number)
  // Manuell redigering av start-/sluttid och uppspelningshastighet per segment (Klippstudio
  // segmentlista) — override av AI-förslaget i segmentsPlan[i].start/end. Tomt/saknat värde
  // för ett index faller tillbaka till seg.start/seg.end (samma tolerans som segmentEffects/
  // segmentFilters). segmentSpeeds är Shotstacks "speed"-fält (float-multiplikator på
  // video-asseten, t.ex. 2 = dubbel hastighet) — saknat/ogiltigt värde = normal hastighet.
  const segmentStarts = Array.isArray(body.segmentStarts) ? (body.segmentStarts as unknown[]) : []
  const segmentEnds = Array.isArray(body.segmentEnds) ? (body.segmentEnds as unknown[]) : []
  const segmentSpeeds = Array.isArray(body.segmentSpeeds) ? (body.segmentSpeeds as unknown[]) : []

  if (clips.length === 0 || !clips.every((c) => typeof c.url === 'string' && c.url)) {
    return jsonResponse({ error: 'clips (icke-tom lista, varje med giltig url) krävs.' }, 400)
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
  // Eget spår för tankebubblor — de visas samtidigt som (överlappar i tid med) de vanliga
  // undertexterna på captionClips, bara på en annan skärmposition, så de måste ligga på ett
  // separat spår av samma anledning som backgroundClips ovan.
  const bubbleClips = []
  // Eget spår för glow-overlayen — byggs EFTER segmentsPlan.forEach nedan (den positioneras på
  // den färdiga klippets tidslinje som helhet, inte per segment) men behöver ligga i samma
  // spårlista som resten.
  const glowClips: Record<string, unknown>[] = []
  let timelineCursor = 0

  segmentsPlan.forEach((seg, index) => {
    // Vilket uppladdat klipp DETTA segment klipps ur — avgör både videokällan och vilka
    // ord/transkriptrader som hör till segmentets tidsintervall (dessa är per-klipp, inte
    // globala, eftersom flera klipp kan ha överlappande egna tidslinjer 0:00–).
    const clip = resolveClip(seg.clip_id)
    const clipWords = clip?.words ?? []
    const clipTranscript = clip?.transcript ?? []
    const manualStart = segmentStarts[index]
    const manualEnd = segmentEnds[index]
    const trimStart = parseTimecode(typeof manualStart === 'string' && manualStart.trim() ? manualStart : seg.start)
    const trimEnd = parseTimecode(typeof manualEnd === 'string' && manualEnd.trim() ? manualEnd : seg.end)
    const length = Math.max(trimEnd - trimStart, 0.5)
    const manualEffect = segmentEffects[index]
    const effect =
      typeof manualEffect === 'string' && manualEffect
        ? manualEffect
        : SEGMENT_EFFECTS[index % SEGMENT_EFFECTS.length]
    const manualFilter = segmentFilters[index]
    const manualSpeedRaw = segmentSpeeds[index]
    const manualSpeed =
      typeof manualSpeedRaw === 'string' && manualSpeedRaw.trim() ? Number(manualSpeedRaw) : NaN
    const speed = Number.isFinite(manualSpeed) && manualSpeed > 0 ? manualSpeed : null
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
          ...(speed ? { speed } : {}),
        },
        start: timelineCursor,
        length,
        fit: 'crop',
        effect,
        transition,
      })
    } else {
      videoClips.push({
        asset: {
          type: 'video',
          src: clip?.url,
          trim: trimStart,
          volume: 1,
          ...(speed ? { speed } : {}),
        },
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
    const segmentWords = clipWords.filter((w) => w.start >= trimStart && w.start < trimEnd)

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
          : clipTranscript
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

    // Tankebubbla — ett per segment (cyklar om fler segment än bubblor), centrerad i
    // segmentets tidsfönster, på den manuellt valda x/y-positionen (samma för alla segment).
    if (thoughtBubblesEnabled) {
      const bubbleText = truncateForOverlay(thoughtBubbles[index % thoughtBubbles.length], THOUGHT_BUBBLE_MAX_CHARS)
      const bubbleLength = Math.min(THOUGHT_BUBBLE_DURATION, length)
      const naturalOffset = Math.max((length - bubbleLength) / 2, 0)
      // Tvinga bubblan att börja EFTER hooken för segment 0 — annars hamnar den centrerad
      // mitt i hook-fönstret (0–HOOK_MAX_DURATION) om segmentet är kort. earliestStart är 0
      // för alla andra segment (timelineCursor är då redan > HOOK_MAX_DURATION där).
      const earliestStart = index === 0 && hookText ? HOOK_MAX_DURATION : 0
      const offset = Math.max(naturalOffset, earliestStart - timelineCursor)
      // Hoppa över bubblan helt om segmentet är för kort för att rymma den efter hooken,
      // istället för att klämma in den eller låta den sticka in i nästa segment.
      if (offset + bubbleLength <= length) {
        const leftPx = Math.round((thoughtBubbleXPercent / 100) * OUTPUT_SIZE.width)
        const topPx = Math.round((thoughtBubbleYPercent / 100) * OUTPUT_SIZE.height)
        bubbleClips.push({
          asset: {
            type: 'html',
            html: `<div class="bubble">${escapeHtml(bubbleText)}</div>`,
            css: buildThoughtBubbleCss(leftPx, topPx),
            width: OUTPUT_SIZE.width,
            height: OUTPUT_SIZE.height,
          },
          position: 'center',
          start: timelineCursor + offset,
          length: bubbleLength,
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

  // Glow-overlay byggs på den FÄRDIGA klippets tidslinje (timelineCursor är nu den totala
  // längden), inte per segment — positionen är avsiktligt fast under hela intervallet.
  if (glowEnabled && glowEffect) {
    const xPercent = Math.min(Math.max(glowEffect.x_percent as number, 0), 100)
    const yPercent = Math.min(Math.max(glowEffect.y_percent as number, 0), 100)
    const radiusPercent =
      typeof glowEffect.radius_percent === 'number' && glowEffect.radius_percent > 0
        ? Math.min(glowEffect.radius_percent as number, 50)
        : 10
    const startSeconds = Math.max(glowEffect.start_seconds as number, 0)
    const endSeconds = Math.min(glowEffect.end_seconds as number, timelineCursor)
    const color =
      typeof glowEffect.color === 'string' && glowEffect.color in GLOW_COLORS
        ? (glowEffect.color as string)
        : GLOW_DEFAULT_COLOR
    const intensity =
      typeof glowEffect.intensity === 'string' && glowEffect.intensity in GLOW_INTENSITY_OPACITY
        ? (glowEffect.intensity as string)
        : GLOW_DEFAULT_INTENSITY
    const rgb = GLOW_COLORS[color]
    const maxOpacity = GLOW_INTENSITY_OPACITY[intensity]

    if (endSeconds > startSeconds) {
      const diameterPx = Math.max(Math.round((radiusPercent / 100) * OUTPUT_SIZE.width * 2), 20)
      const leftPx = Math.round((xPercent / 100) * OUTPUT_SIZE.width - diameterPx / 2)
      const topPx = Math.round((yPercent / 100) * OUTPUT_SIZE.height - diameterPx / 2)
      const glowCss =
        `.glow { position: absolute; left: ${leftPx}px; top: ${topPx}px; width: ${diameterPx}px; ` +
        `height: ${diameterPx}px; border-radius: 50%; ` +
        `background: radial-gradient(circle, rgba(${rgb},0.95) 0%, rgba(${rgb},0.55) 40%, rgba(${rgb},0) 72%); ` +
        `box-shadow: 0 0 ${Math.round(diameterPx * 0.4)}px ${Math.round(diameterPx * 0.2)}px rgba(${rgb},0.35); }`
      const minOpacity = maxOpacity * 0.55

      let t = startSeconds
      while (t < endSeconds) {
        const stepLength = Math.min(GLOW_PULSE_STEP, endSeconds - t)
        const phase = (t % GLOW_PULSE_PERIOD) / GLOW_PULSE_PERIOD
        const wave = (Math.sin(phase * 2 * Math.PI - Math.PI / 2) + 1) / 2 // 0..1
        const opacity = minOpacity + wave * (maxOpacity - minOpacity)
        glowClips.push({
          asset: {
            type: 'html',
            html: '<div class="glow"></div>',
            css: glowCss,
            width: OUTPUT_SIZE.width,
            height: OUTPUT_SIZE.height,
          },
          start: t,
          length: stepLength,
          position: 'center',
          opacity: Math.round(opacity * 100) / 100,
        })
        t += stepLength
      }
    }
  }

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
          length: Math.min(HOOK_MAX_DURATION, timelineCursor),
        },
      ]
    : []

  const tracks = [
    { clips: hookClip },
    { clips: bubbleClips },
    { clips: captionClips },
    { clips: glowClips },
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
