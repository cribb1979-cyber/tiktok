// Valfritt tillval: AI-genererad B-roll (atmosfäriska bakgrundssekvenser) via Replicate API,
// modellen Wan 2.1 (öppen källkod, mycket billigare än Runway — ~$0.05-0.09 per klipp mot
// Runways betydligt högre pris, bytt 2026-09 efter användarens önskemål).
// Genererar ALDRIG bilder/video av personer — B-roll är bara stämningshöjande bakgrund,
// aldrig en ersättning för Christoffer själv i bild, eftersom kontots trovärdighet bygger på
// att det är honom. CLAUDE_API_KEY och REPLICATE_API_TOKEN exponeras aldrig i klienten.
//
// OBS: fältnamnen nedan (prompt/negative_prompt/aspect_ratio/fast_mode) är verifierade mot
// Replicates publika modell-sida för wavespeedai/wan-2.1-t2v-720p, men själva anropet är INTE
// testat mot ett riktigt Replicate-konto i den här miljön (nätverksbegränsningar hindrade
// direkt verifiering av live-svar). Samma mönster som Shotstack/Runway-integrationerna:
// räkna med att mindre justeringar kan behövas första gången det körs skarpt — visa hela
// felmeddelandet, justera.

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-5'
const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/models'

const PROMPT_SYSTEM = `Du skriver korta, visuella prompts för AI-genererad B-roll
(atmosfärisk bakgrundsvideo) till TikTok-klipp om andlighet/medium-tema.

KRITISKT: Prompten får ALDRIG beskriva personer, ansikten, mänskliga figurer, kroppsdelar
eller siluetter av människor — B-roll ska bara vara stämning: natur, ljus, rök, vatten,
stjärnhimmel, candlelight, abstrakta mönster, väder, etc. Ingen text i bilden. Svara med
BARA prompten, max två meningar, filmisk och specifik (ljus/färg/rörelse), på engelska
(bildmodeller fungerar bäst med engelska prompts).`

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const claudeApiKey = Deno.env.get('CLAUDE_API_KEY')
  const replicateApiToken = Deno.env.get('REPLICATE_API_TOKEN')
  if (!claudeApiKey) {
    return jsonResponse({ error: 'CLAUDE_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }
  if (!replicateApiToken) {
    return jsonResponse({ error: 'REPLICATE_API_TOKEN saknas i Netlify-miljövariabler.' }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
  }

  const theme = [body.category, body.subtopic, body.hookText]
    .filter((v) => typeof v === 'string' && v.trim())
    .join(' — ')

  if (!theme) {
    return jsonResponse(
      { error: 'category, subtopic eller hookText krävs för att generera ett B-roll-tema.' },
      400
    )
  }

  const replicateModel = Deno.env.get('REPLICATE_MODEL') || 'wavespeedai/wan-2.1-t2v-720p'

  // Steg 1: Claude formulerar en filmisk, person-fri visuell prompt utifrån klippets tema.
  let visualPrompt: string
  try {
    const claudeResponse = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 300,
        system: PROMPT_SYSTEM,
        messages: [{ role: 'user', content: `Tema: ${theme}` }],
      }),
    })

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text()
      return jsonResponse({ error: 'Claude API-fel (B-roll-prompt)', detail: errText }, 502)
    }

    const claudeData = await claudeResponse.json()
    const textBlock = (claudeData?.content ?? []).find((b: { type: string }) => b.type === 'text')
    visualPrompt = (textBlock?.text ?? '').trim()
    if (!visualPrompt) throw new Error('Tomt svar från Claude.')
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte generera B-roll-prompt.', detail: String(err) }, 502)
  }

  // Steg 2: skicka prompten till Replicate (Wan 2.1) för videogenerering (asynkront,
  // prediction-baserat). negative_prompt är ett extra skyddsnät mot att personer dyker upp i
  // bild, utöver instruktionen i Claude-prompten. fast_mode: "Fast" (en sträng, inte en
  // boolean — bekräftat via ett skarpt 422-fel: "Expected: string, given: boolean") för lägre
  // kostnad/kortare väntetid — bra avvägning för atmosfärisk bakgrund som inte behöver
  // perfekt detaljrikedom.
  const replicateBody = {
    input: {
      prompt: visualPrompt,
      negative_prompt:
        'people, person, human face, human figure, man, woman, portrait, crowd, text, watermark',
      aspect_ratio: '9:16', // TikTok-format
      fast_mode: 'Fast',
    },
  }

  let replicateResponse: Response
  try {
    replicateResponse = await fetch(`${REPLICATE_PREDICTIONS_URL}/${replicateModel}/predictions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${replicateApiToken}`,
      },
      body: JSON.stringify(replicateBody),
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå Replicate API.', detail: String(err) }, 502)
  }

  const replicateData = await replicateResponse.json()

  if (!replicateResponse.ok || !replicateData?.id) {
    return jsonResponse({ error: 'Replicate API-fel', detail: replicateData }, 502)
  }

  return jsonResponse({ taskId: replicateData.id, prompt: visualPrompt }, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/generate-broll',
}
