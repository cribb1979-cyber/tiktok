// Valfritt tillval: AI-genererad B-roll (atmosfäriska bakgrundssekvenser, eller illustrativa
// berättelsescener — se allowIllustrativeFigures) via Replicate API, modellen Wan 2.1 (öppen
// källkod, mycket billigare än Runway — ~$0.05-0.09 per klipp mot Runways betydligt högre
// pris, bytt 2026-09 efter användarens önskemål). CLAUDE_API_KEY och REPLICATE_API_TOKEN
// exponeras aldrig i klienten.
//
// Person-skydd, två lägen (användarval, se Klippstudio.jsx):
// - Default (allowIllustrativeFigures: false): INGA människor alls i bild. B-roll ersätter
//   aldrig, och föreställer aldrig, Christoffer själv — kontots trovärdighet bygger på att
//   det är honom.
// - "Illustrera min berättelse" (allowIllustrativeFigures: true): tillåter generiska,
//   anonyma/stiliserade mänskliga figurer som illustration av en berättelse (t.ex. "en person
//   vid ett bord", en siluett) — men FÅR ALDRIG föreställa en specifik verklig identifierbar
//   person (inte kontoinnehavaren, inte namngivna anhöriga). Användarens eget val, uttryckligt
//   opt-in per klipp.
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

const PROMPT_SYSTEM_PERSON_FREE = `Du skriver korta, visuella prompts för AI-genererad B-roll
(atmosfärisk bakgrundsvideo) till TikTok-klipp om andlighet/medium-tema.

KRITISKT: Prompten får ALDRIG beskriva personer, ansikten, mänskliga figurer, kroppsdelar
eller siluetter av människor — B-roll ska bara vara stämning: natur, ljus, rök, vatten,
stjärnhimmel, candlelight, abstrakta mönster, väder, etc. Ingen text i bilden. Svara med
BARA prompten, max två meningar, filmisk och specifik (ljus/färg/rörelse), på engelska
(bildmodeller fungerar bäst med engelska prompts).`

const PROMPT_SYSTEM_ILLUSTRATIVE = `Du skriver korta, visuella prompts för en AI-genererad
illustrativ scen till ett TikTok-klipp om andlighet/medium-tema — en återskapad/illustrerad
stämningsbild av en berättelse användaren beskriver, inte en dokumentär avbildning.

Får innehålla generiska, anonyma eller stiliserade mänskliga figurer som en del av att
illustrera scenen (t.ex. en siluett vid ett bord, en skuggad gestalt som kliver in i rummet).
KRITISKT: prompten får ALDRIG beskriva eller antyda en specifik verklig identifierbar person
(inte kontoinnehavaren, inte namngivna anhöriga, inga specifika ansiktsdrag eller kända
kännetecken) — håll figurer generiska och anonyma: siluetter, oskarpt/dolt ansikte, bakifrån,
i skugga eller motljus, aldrig ett tydligt porträtt. Ingen text i bilden. Svara med BARA
prompten, max två meningar, filmisk och specifik (ljus/färg/rörelse/komposition), på engelska
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

  // Valfri egen idé från användaren (t.ex. "regn mot ett fönster, neonljus i vattenpölar") —
  // skickas fortfarande via Claude (PROMPT_SYSTEM nedan) istället för direkt till
  // videomodellen, så att person-skyddet gäller även här.
  const customPrompt = typeof body.customPrompt === 'string' ? body.customPrompt.trim() : ''

  const theme = [customPrompt, body.category, body.subtopic, body.hookText]
    .filter((v) => typeof v === 'string' && v.trim())
    .join(' — ')

  if (!theme) {
    return jsonResponse(
      { error: 'customPrompt, category, subtopic eller hookText krävs för att generera ett B-roll-tema.' },
      400
    )
  }

  const replicateModel = Deno.env.get('REPLICATE_MODEL') || 'wavespeedai/wan-2.1-t2v-720p'
  // Uttryckligt opt-in per klipp (default false) — se kommentaren högst upp i filen för
  // person-skyddets två lägen.
  const allowIllustrativeFigures = body.allowIllustrativeFigures === true
  const promptSystem = allowIllustrativeFigures ? PROMPT_SYSTEM_ILLUSTRATIVE : PROMPT_SYSTEM_PERSON_FREE

  // Steg 1: Claude formulerar en filmisk visuell prompt utifrån klippets tema — person-fri
  // som default, eller med generiska/anonyma figurer tillåtna om allowIllustrativeFigures.
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
        system: promptSystem,
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
  // prediction-baserat). negative_prompt är ett extra skyddsnät utöver instruktionen i
  // Claude-prompten — i default-läget blockeras människor helt, i illustrativt läge
  // blockeras bara sådant som skulle göra en figur igenkännbar (tydligt ansikte/porträtt)
  // snarare än generiska figurer i sig. fast_mode: "Fast" (en sträng, inte en boolean —
  // bekräftat via ett skarpt 422-fel: "Expected: string, given: boolean") för lägre
  // kostnad/kortare väntetid.
  const negativePrompt = allowIllustrativeFigures
    ? 'recognizable face, close-up portrait, detailed facial features, celebrity, named real person, text, watermark'
    : 'people, person, human face, human figure, man, woman, portrait, crowd, text, watermark'

  const replicateBody = {
    input: {
      prompt: visualPrompt,
      negative_prompt: negativePrompt,
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

  // .json() kan kasta om Replicate svarar med något som inte är giltig JSON (t.ex. en
  // HTML-felsida vid ett server-/auth-fel) — läs som text först och försök tolka, så en
  // ogiltig kropp ger ett vettigt felmeddelande istället för att krascha hela funktionen.
  const replicateRawText = await replicateResponse.text()
  let replicateData: Record<string, unknown>
  try {
    replicateData = JSON.parse(replicateRawText)
  } catch {
    return jsonResponse({ error: 'Replicate API-fel (ogiltigt svar)', detail: replicateRawText }, 502)
  }

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
