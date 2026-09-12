// AI-kortfilm (valfritt tillval, opt-in): en hel liten berättelse med återkommande karaktärer
// över flera scener — ETT steg upp från B-roll (som bara är person-fria atmosfärklipp).
// Claude bryter ner en fri idé (t.ex. "två personer hittar ett ödehus, märkliga saker
// händer") till en karaktärslista + en ordnad scenlista. Varje scen genereras sedan i två
// steg (se generate-shot-image.ts/generate-shot-video.ts): en konsekvent bildruta (samma
// karaktärer igen via referensbild) → animeras till en kort videoklipp. CLAUDE_API_KEY
// exponeras aldrig i klienten.

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-5'

const SYSTEM_PROMPT = `Du skriver en kort filmisk berättelse (skräck/spänning/andlighet-tema,
för kontot @stoffe_medium) som ska genereras med AI-video, scen för scen, med konsekventa
återkommande karaktärer.

KRITISKT — samma person-skydd som appens B-roll-funktion:
- Karaktärerna MÅSTE vara helt påhittade och generiska — beskriv utseende brett (t.ex. "en
  ung kvinna med mörkt hår, mörk jacka"), ALDRIG en specifik verklig identifierbar person
  (inte kontoinnehavaren Christoffer, inga namngivna kända personer, inga detaljerade
  kännetecken som skulle peka ut en riktig individ).
- Beskriv inte grafiskt våld, blod eller skadade kroppar — bygg spänning genom atmosfär,
  ljussättning, ljud och antydan snarare än explicita skräckbilder.

Dela upp berättelsen i:
- characters: 1-3 återkommande karaktärer, varje med ett kort namn (bara en enkel platshållare
  som "Person A", används som @tag i bildprompter, inte ett riktigt namn i berättelsen) och en
  kort visuell beskrivning (kläder/hår/kroppstyp, INTE ansiktsdrag i detalj — bildmodellen
  fyller i det, vi vill bara ha en konsekvent SILHUETT/STIL).
- shots: 4-8 scener i ordning som tillsammans berättar historien med stigande spänning och ett
  tydligt slut. Varje scen:
  - image_prompt: en filmisk beskrivning av EN bildruta (komposition, ljus, miljö) — beskriv
    karaktärer med VANLIG text (t.ex. "en kvinna närmar sig ett förfallet hus i skymningen"),
    ALDRIG @tag eller andra specialtecken i själva prompten (bildmodellen tar bara EN
    referensbild per scen, se character_tags nedan — ingen tag-syntax stöds i prompttexten).
  - motion_prompt: vad som händer när stillbilden animeras till video (rörelse/kamera/
    handling), kort och konkret, t.ex. "de går sakta mot dörren, kameran följer bakifrån".
  - duration_seconds: 5 eller 10 (Gen-4 Turbo stödjer bara dessa två längder).
  - character_tags: bara den FÖRSTA/viktigaste karaktären i scenen används faktiskt som
    bildreferens (teknisk begränsning) — lista ändå alla som syns, men skriv image_prompt så
    scenen fortfarande fungerar visuellt även om bara en av dem hålls helt konsekvent.`

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Kort arbetsnamn för berättelsen.' },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tag: {
            type: 'string',
            description: 'Kort alfanumerisk platshållare utan mellanslag, t.ex. "persona" — används som @tag.',
          },
          description: { type: 'string' },
        },
        required: ['tag', 'description'],
        additionalProperties: false,
      },
    },
    shots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          image_prompt: { type: 'string' },
          motion_prompt: { type: 'string' },
          duration_seconds: { type: 'integer', enum: [5, 10] },
          character_tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Vilka characters[].tag som syns i den här scenen (kan vara tom).',
          },
        },
        required: ['image_prompt', 'motion_prompt', 'duration_seconds', 'character_tags'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'characters', 'shots'],
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

  const idea = typeof body.idea === 'string' ? body.idea.trim() : ''
  if (!idea) {
    return jsonResponse({ error: 'idea (text) krävs.' }, 400)
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
        messages: [{ role: 'user', content: `Idé: ${idea}` }],
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

  let shotlist: { title?: string; characters?: unknown[]; shots?: unknown[] }
  try {
    shotlist = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka Claudes svar som JSON.', raw: rawText }, 502)
  }

  if (!Array.isArray(shotlist.shots) || shotlist.shots.length === 0) {
    return jsonResponse({ error: 'Claude returnerade ingen giltig scenlista.', raw: rawText }, 502)
  }

  return jsonResponse(shotlist, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/generate-shotlist',
}
