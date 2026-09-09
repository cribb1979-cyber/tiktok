// Valfritt tillval: AI-genererad B-roll (atmosfäriska bakgrundssekvenser) via Runway API
// (samma endpoint ger även tillgång till Googles Veo-modeller, styrbart via RUNWAY_MODEL).
// Genererar ALDRIG bilder/video av personer — B-roll är bara stämningshöjande bakgrund,
// aldrig en ersättning för Christoffer själv i bild, eftersom kontots trovärdighet bygger på
// att det är honom. CLAUDE_API_KEY och RUNWAY_API_KEY exponeras aldrig i klienten.
//
// OBS: Runways exakta fältnamn nedan är byggda utifrån deras publika API-dokumentation
// (api.dev.runwayml.com/v1, X-Runway-Version: 2024-11-06) men är INTE testade mot ett
// riktigt Runway-konto i den här miljön (nätverksbegränsningar hindrade direkt verifiering
// mot dokumentationen). Precis som Shotstack-integrationen: räkna med att mindre
// justeringar (fältnamn, statusvärden) kan behövas första gången det körs skarpt mot ett
// riktigt konto — samma mönster, samma sätt att felsöka (visa hela felmeddelandet, justera).

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-5'
const RUNWAY_API_URL = 'https://api.dev.runwayml.com/v1/text_to_video'
const RUNWAY_VERSION = '2024-11-06'

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
  const runwayApiKey = Deno.env.get('RUNWAY_API_KEY')
  if (!claudeApiKey) {
    return jsonResponse({ error: 'CLAUDE_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }
  if (!runwayApiKey) {
    return jsonResponse({ error: 'RUNWAY_API_KEY saknas i Netlify-miljövariabler.' }, 500)
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

  const runwayModel = Deno.env.get('RUNWAY_MODEL') || 'gen4.5'

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

  // Steg 2: skicka prompten till Runway för videogenerering (asynkront, task-baserat).
  const runwayBody: Record<string, unknown> = {
    model: runwayModel,
    promptText: visualPrompt,
    ratio: '720:1280', // 9:16, TikTok-format
    duration: 5,
  }

  // negativePrompt är bekräftat stöd på veo3/veo3.1 — extra skyddsnät mot att personer
  // dyker upp i bild, utöver instruktionen i Claude-prompten.
  if (runwayModel.startsWith('veo')) {
    runwayBody.negativePrompt =
      'people, person, human face, human figure, man, woman, portrait, crowd, text, watermark'
  }

  let runwayResponse: Response
  try {
    runwayResponse = await fetch(RUNWAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${runwayApiKey}`,
        'X-Runway-Version': RUNWAY_VERSION,
      },
      body: JSON.stringify(runwayBody),
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå Runway API.', detail: String(err) }, 502)
  }

  const runwayData = await runwayResponse.json()

  if (!runwayResponse.ok || !runwayData?.id) {
    return jsonResponse({ error: 'Runway API-fel', detail: runwayData }, 502)
  }

  return jsonResponse({ taskId: runwayData.id, prompt: visualPrompt }, 200)
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
