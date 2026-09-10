// Redigera klippningsplanen med fri text ("prompt och vägledning") istället för att bara
// justera start-/sluttid/hastighet manuellt per segment — samma Claude-anrop-mönster som
// generate-plan.ts, men reviderar en BEFINTLIG plan istället för att skapa en ny, och får
// dessutom ett fåtal nedskalade bildrutor från källvideon (en per segment, klientsidigt
// hämtade i Klippstudio.jsx) som visuell kontext. Claude API stödjer bilder, inte video —
// se README för avvägningen mot t.ex. Gemini som kan analysera video direkt.
// CLAUDE_API_KEY exponeras aldrig i klienten.

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
// Samma modell som generate-plan.ts — konsekvent med resten av appen, inte bytt till en
// dyrare modell bara för att den här anropet råkar innehålla bilder.
const CLAUDE_MODEL = 'claude-sonnet-5'

const SYSTEM_PROMPT = `Du är en TikTok-klippstrateg för kontot @stoffe_medium (andlighet/medium-nisch).
Du har redan föreslagit en klippningsplan (segments_plan) för ett klipp. Användaren har nu skrivit
en fri instruktion om hur planen ska ÄNDRAS (t.ex. "korta ner mittendelen", "sakta ner när jag säger
den viktiga meningen", "klipp bort de första 3 sekunderna", "gör klippet mer punchy").

Du får: den nuvarande segmentplanen, transkriptet (om det finns), ett fåtal nedskalade bildrutor
(en per segment, i samma ordning som segmenten — använd dem för grov visuell kontext, de är INTE
en fullständig video och du kan inte se rörelse/tajming i dem), och användarens instruktion.

VIKTIGT:
- Håll dig INOM det tidsspann som redan täcks av segmenten — hitta inte på nya tidsintervall
  utanför vad som redan beskrivits/visats, du vet inte hur lång källvideon faktiskt är utöver det.
- Du får korta ner, förlänga (inom befintligt spann), ta bort, slå ihop eller lägga till kortare
  segment mellan befintliga, samt skriva om description-fälten så de stämmer med den nya planen.
- segment_speeds är en array i SAMMA ordning som den nya segments_plan — sätt en snabbare/
  långsammare hastighet bara där instruktionen uttryckligen ber om det (slow-motion, time-lapse),
  annars tomt värde ('') för normal hastighet. Måste vara exakt lika lång som segments_plan.
- summary: 1-2 korta meningar på svenska som förklarar vad du ändrade och varför — visas för
  användaren så de ser att instruktionen tolkades rätt.
- Om instruktionen är oklar eller inte går att applicera meningsfullt: gör minsta rimliga tolkning
  och förklara det i summary, istället för att vägra.`

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    segments_plan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'Starttid, mm:ss' },
          end: { type: 'string', description: 'Sluttid, mm:ss' },
          description: { type: 'string' },
          order: { type: 'integer' },
        },
        required: ['start', 'end', 'description', 'order'],
        additionalProperties: false,
      },
    },
    segment_speeds: {
      type: 'array',
      items: { type: 'string', enum: ['', '0.5', '0.75', '1.25', '1.5', '2'] },
      description: 'Hastighet per segment, exakt samma ordning/längd som segments_plan. Tomt värde = normal hastighet.',
    },
    summary: {
      type: 'string',
      description: 'Kort förklaring (1-2 meningar, svenska) av vad som ändrades.',
    },
  },
  required: ['segments_plan', 'segment_speeds', 'summary'],
  additionalProperties: false,
}

type Segment = { start: string; end: string; description?: string; order?: number }
type TranscriptSegment = { start: number; end: number; text: string }

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = Deno.env.get('CLAUDE_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'CLAUDE_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
  }

  const segmentsPlan = Array.isArray(body.segmentsPlan) ? (body.segmentsPlan as Segment[]) : []
  const transcript = Array.isArray(body.transcript) ? (body.transcript as TranscriptSegment[]) : []
  const editInstruction = typeof body.editInstruction === 'string' ? body.editInstruction.trim() : ''
  // Bas64-kodade JPEG-bildrutor (utan "data:image/jpeg;base64,"-prefix), en per segment,
  // hämtade klientsidigt i Klippstudio.jsx (samma <video>+<canvas>-teknik som glow-
  // förhandsvisningen, nedskalade till max 480px bredd för rimlig anropsstorlek/kostnad).
  const frames = Array.isArray(body.frames)
    ? (body.frames as unknown[]).filter((f) => typeof f === 'string' && f.length > 0)
    : []

  if (segmentsPlan.length === 0) {
    return jsonResponse({ error: 'segmentsPlan (icke-tom lista) krävs.' }, 400)
  }
  if (!editInstruction) {
    return jsonResponse({ error: 'editInstruction (text) krävs — beskriv vad som ska ändras.' }, 400)
  }

  const planText = segmentsPlan
    .map((seg, i) => `${i + 1}. ${seg.start}–${seg.end}: ${seg.description ?? ''}`)
    .join('\n')
  const transcriptText =
    transcript.length > 0
      ? transcript.map((t) => `[${t.start}s–${t.end}s] ${t.text}`).join('\n')
      : 'Inget transkript tillgängligt.'

  // Multimodalt innehåll: en textrad + bildruta per segment (i ordning), sen den fulla
  // planen/transkriptet/instruktionen som avslutande text.
  const content: Record<string, unknown>[] = []
  frames.forEach((frame, i) => {
    const seg = segmentsPlan[i]
    content.push({
      type: 'text',
      text: seg ? `Bildruta för segment ${i + 1} (${seg.start}–${seg.end}):` : `Bildruta ${i + 1}:`,
    })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: frame },
    })
  })
  content.push({
    type: 'text',
    text: [
      `Nuvarande segmentplan:\n${planText}`,
      `Transkript:\n${transcriptText}`,
      `Användarens instruktion: ${editInstruction}`,
    ].join('\n\n'),
  })

  let claudeResponse: Response
  try {
    claudeResponse = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: RESPONSE_SCHEMA,
          },
        },
      }),
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå Claude API.', detail: String(err) }, 502)
  }

  if (!claudeResponse.ok) {
    const errText = await claudeResponse.text()
    return jsonResponse({ error: 'Claude API-fel', detail: errText }, 502)
  }

  const claudeData = await claudeResponse.json()

  if (claudeData.stop_reason === 'refusal') {
    return jsonResponse({ error: 'Claude avböjde att svara på den här förfrågan.' }, 502)
  }
  if (claudeData.stop_reason === 'max_tokens') {
    return jsonResponse({ error: 'Svaret blev avbrutet (max_tokens nått) och kan vara ofullständigt.' }, 502)
  }

  const textBlock = (claudeData?.content ?? []).find((block: { type: string }) => block.type === 'text')
  const rawText = textBlock?.text ?? ''

  let revised: { segments_plan?: Segment[]; segment_speeds?: string[]; summary?: string }
  try {
    revised = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka Claudes svar som JSON.', raw: rawText }, 502)
  }

  if (!Array.isArray(revised.segments_plan) || revised.segments_plan.length === 0) {
    return jsonResponse({ error: 'Claude returnerade ingen giltig segmentplan.', raw: rawText }, 502)
  }

  return jsonResponse(revised, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/revise-plan',
}
