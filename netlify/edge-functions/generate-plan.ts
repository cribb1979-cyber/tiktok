// Steg 4: klippningsplan + hook-förslag via Claude API.
// Körs server-side som Netlify Edge Function — CLAUDE_API_KEY exponeras aldrig i klienten.

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-5'

const SYSTEM_PROMPT = `Du är en TikTok-klippstrateg för kontot @stoffe_medium (andlighet/medium-nisch, ~15k följare).
Ditt jobb: föreslå en klippningsplan för ett kort videoklipp, baserat på användarens idé.

Föreslå 2-3 hook-alternativ i hook_variants. Om inget transkript finns än, basera segmentplanen
på användarens promptbeskrivning istället och märk segmentens tider som preliminära
uppskattningar (t.ex. "00:00"–"00:05").`

// Svarsformatet tvingas fram strukturellt via output_config.format (json_schema) — modellen
// kan inte avvika från detta, så inget behov av att be den "bara svara med JSON" i prompten.
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
    hook_variants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['text', 'rationale'],
        additionalProperties: false,
      },
    },
    suggested_subtitles: {
      type: 'array',
      items: { type: 'string' },
    },
    category: {
      type: 'string',
      description:
        'En av: Kärlek/relationer, Paranormalt/andevärlden, Personlig reflektion/citat, Vardag/bakom kulisserna',
    },
    subtopic: { type: 'string' },
  },
  required: ['segments_plan', 'hook_variants', 'suggested_subtitles', 'category', 'subtopic'],
  additionalProperties: false,
}

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

  const {
    prompt,
    category,
    subtopic,
    // Transkript med tidsstämplar från Whisper. Tom array tills steg 5 kopplas på.
    transcript,
    // Dagens trenddata (hashtags/ljud). Tom/utelämnad tills Idébanken (steg 7) kopplas på.
    trendContext,
    // Few-shot-kontext: tidigare bäst presterande klipp i samma kategori (retrieval via
    // pgvector kommer i steg 10, manuell historik i steg 9). Skickas som tom array redan nu
    // så anropsformatet inte behöver ändras när den datan väl finns.
    previousBestClips,
  } = body

  if (!prompt || typeof prompt !== 'string') {
    return jsonResponse({ error: 'prompt (text) krävs.' }, 400)
  }

  const userMessage = [
    `Idé/prompt: ${prompt}`,
    typeof category === 'string' && category ? `Vald kategori: ${category}` : null,
    typeof subtopic === 'string' && subtopic ? `Vald underämne: ${subtopic}` : null,
    buildTrendBlock(trendContext),
    buildTranscriptBlock(transcript),
    buildFewShotBlock(previousBestClips),
  ]
    .filter(Boolean)
    .join('\n\n')

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
        messages: [{ role: 'user', content: userMessage }],
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

  let plan: unknown
  try {
    plan = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka Claudes svar som JSON.', raw: rawText }, 502)
  }

  return jsonResponse(plan, 200)
}

function buildFewShotBlock(previousBestClips: unknown) {
  if (!Array.isArray(previousBestClips) || previousBestClips.length === 0) {
    return 'Tidigare bäst presterande klipp (few-shot-exempel): inga tillgängliga ännu.'
  }
  const examples = previousBestClips
    .map((clip, i) => {
      const c = clip as Record<string, unknown>
      return `Exempel ${i + 1}:
Hook: ${c.hook_text ?? '–'}
Kategori: ${c.category ?? '–'} / ${c.subtopic ?? '–'}
Resultat: ${c.views_24h ?? '–'} visningar, ${c.avg_watch_pct ?? '–'}% snitt-tittartid
Klippningsplan: ${JSON.stringify(c.segments_plan ?? [])}`
    })
    .join('\n\n')
  return `Tidigare bäst presterande klipp (few-shot-exempel, samma kategori):\n\n${examples}`
}

function buildTranscriptBlock(transcript: unknown) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return 'Transkript: inget uppladdat ännu (kopplas på i steg 5 via Whisper). Basera planen på prompten.'
  }
  return `Transkript (tidsstämplat):\n${JSON.stringify(transcript)}`
}

function buildTrendBlock(trendContext: unknown) {
  if (!Array.isArray(trendContext) || trendContext.length === 0) {
    return null
  }
  return `Dagens trenddata (hashtags/ljud):\n${JSON.stringify(trendContext)}`
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/generate-plan',
}
