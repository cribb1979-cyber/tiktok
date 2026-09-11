// Manus-läge (steg 7): tolkar ett fritt skrivet manus — dialog blandat med regianvisningar i
// hakparenteser (t.ex. "[Lugn början – du sitter stilla]\nHar du någonsin känt...") — till
// strukturerade "beats": en spelbar dialograd, ev. tillhörande regianvisning, och en föreslagen
// längd i sekunder. Klienten slår ihop alla beats.line till en sammanhängande talbar text som
// skickas vidare till generate-avatar-video.ts — regianvisningar ska ALDRIG läsas upp.
// CLAUDE_API_KEY exponeras aldrig i klienten.

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-5'

const SYSTEM_PROMPT = `Du tolkar ett manus för ett TikTok-klipp åt kontot @stoffe_medium
(andlighet/medium-nisch). Manuset är fritt skrivet av användaren: dialog blandat med
regianvisningar i hakparenteser, t.ex.:

"[Lugn början – du sitter stilla]
Har du någonsin känt att någon var i rummet, fast du var ensam?
[Paus, luta dig fram]
Det är inte inbillning."

Dela upp manuset i "beats" i ordning. Varje beat är ANTINGEN en dialograd (det som faktiskt
ska sägas högt av en AI-avatar) ELLER markerar en regianvisning som hör ihop med NÄSTA
dialograd — modellera det som ETT beat per dialograd, med regianvisningen (om någon precis
föregick den raden) i beat.direction.

VIKTIGT:
- beat.line ska INNEHÅLLA BARA det som faktiskt ska läsas upp av avataren — rensat från
  hakparenteser/regianvisningar, rensad interpunktion, redo att skickas rakt av till en
  text-till-tal-tjänst. Ändra inte innebörden eller ordvalet i själva dialogen.
- beat.direction: regianvisningen (utan hakparenteser) som hör till den raden, eller tom
  sträng om ingen fanns precis före den raden.
- beat.pause_after_seconds: om regianvisningen (antingen den som hör till DENNA rad, eller en
  fristående regianvisning direkt EFTER raden, före nästa dialog) uttryckligen ber om en paus/
  tystnad (t.ex. "[paus]", "[tystnad]", "[Paus, luta dig fram]") — uppskatta en rimlig längd i
  sekunder: en explicit angiven längd om en sådan finns (t.ex. "[3 sekunders tystnad]" → 3),
  annars en kort paus (~1s) för "paus" och en längre (~2-3s) för "tystnad"/"lång paus". 0 om
  ingen paus/tystnad efterfrågas efter raden.
- suggested_duration_seconds: en grov uppskattning baserad på radens längd (räkna ca 2,5
  ord/sekund naturligt talat svenska), avrundat till närmaste halva sekund. Inkludera INTE
  pause_after_seconds i detta tal, de är separata.
- Hoppa över rader som ENDAST är regianvisningar utan någon efterföljande dialog (de har
  inget ljud att generera) — men om en sådan fristående regianvisning ber om paus/tystnad,
  lägg den paus-längden på pause_after_seconds för FÖREGÅENDE beat istället för att tappa bort
  den.
- Om manuset är tomt eller inte innehåller någon talbar dialog alls: returnera en tom
  parsed_beats-lista, gissa inte fram påhittad dialog.`

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    parsed_beats: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line: { type: 'string', description: 'Enbart den talbara dialogen, utan regianvisningar/hakparenteser.' },
          direction: { type: 'string', description: 'Regianvisningen som hör till raden, eller tom sträng.' },
          suggested_duration_seconds: { type: 'number' },
          pause_after_seconds: {
            type: 'number',
            description: 'Uppskattad paus/tystnad (sekunder) efter raden, 0 om ingen paus efterfrågas.',
          },
        },
        required: ['line', 'direction', 'suggested_duration_seconds', 'pause_after_seconds'],
        additionalProperties: false,
      },
    },
  },
  required: ['parsed_beats'],
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

  const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : ''
  if (!rawText) {
    return jsonResponse({ error: 'rawText (manustext) krävs.' }, 400)
  }

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
        messages: [{ role: 'user', content: `Manus:\n\n${rawText}` }],
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
  const rawResponseText = textBlock?.text ?? ''

  let parsed: { parsed_beats?: unknown[] }
  try {
    parsed = JSON.parse(rawResponseText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka Claudes svar som JSON.', raw: rawResponseText }, 502)
  }

  if (!Array.isArray(parsed.parsed_beats)) {
    return jsonResponse({ error: 'Claude returnerade inga giltiga beats.', raw: rawResponseText }, 502)
  }

  return jsonResponse({ parsed_beats: parsed.parsed_beats }, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/parse-script',
}
