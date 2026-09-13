// Manus-läge, alternativ leverantör till HeyGen (se generate-avatar-video.ts): D-ID, betydligt
// billigare för just "ladda upp ETT eget foto som avatar" — hos HeyGen sitter den funktionen
// bakom Business-nivån (~149 USD/mån), medan D-ID låter dig använda vilket foto som helst som
// `source_url` redan på de billiga nivåerna (Pro, ~29 USD/mån, ger API-åtkomst). Sämre
// läppsynk/kvalitet än HeyGen enligt oberoende jämförelser, men mycket billigare — ett
// medvetet pris/kvalitet-val användaren själv gör genom att välja leverantör i Klippstudio.
//
// D-ID_API_KEY exponeras aldrig i klienten.
//
// OSÄKERT (kunde inte verifieras mot ett skarpt svar härifrån — nätverksbegränsningar,
// d-id.com är blockerad från den här sandboxen): D-IDs eget dashboard ger API-nyckeln redan
// färdig att användas rakt av som `Authorization: Basic <nyckel>` (INTE en till
// base64-kodning av nyckeln som vi själva behöver göra) — justera till
// `Basic ${btoa(apiKey + ':')}` om D-ID svarar 401 på nyckeln som den är. `script.provider`
// (Microsoft Azure-röst) och `config.stitch` är sammanställda från allmänt kända D-ID-
// integrationsmönster, inte verifierade mot ett skarpt svar — justera enligt D-IDs eget
// felmeddelande om något fältnamn visar sig fel, samma mönster som tidigare
// HeyGen/Bria/Replicate-fältnamnsfixar i den här appen.
const DID_TALKS_URL = 'https://api.d-id.com/talks'

// Default: en svensk Microsoft Azure-neural-röst (samma TTS-leverantör som D-IDs "text"-
// script normalt använder) — matchar @stoffe_medium:s svenska innehåll. Går att byta via
// DID_VOICE_ID i Netlify-miljövariabler om en annan röst önskas.
const DEFAULT_DID_VOICE_ID = 'sv-SE-SofieNeural'

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = Deno.env.get('DID_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'DID_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
  }

  const inputText = typeof body.inputText === 'string' ? body.inputText.trim() : ''
  if (!inputText) {
    return jsonResponse({ error: 'inputText (sammanslagen talbar dialog) krävs.' }, 400)
  }

  const sourceImageUrl = typeof body.sourceImageUrl === 'string' ? body.sourceImageUrl.trim() : ''
  if (!sourceImageUrl) {
    return jsonResponse({ error: 'sourceImageUrl (foto att animera) krävs för D-ID.' }, 400)
  }

  const voiceId = (typeof body.voiceId === 'string' && body.voiceId) || Deno.env.get('DID_VOICE_ID') || DEFAULT_DID_VOICE_ID

  let didResponse: Response
  try {
    didResponse = await fetch(DID_TALKS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify({
        source_url: sourceImageUrl,
        script: {
          type: 'text',
          input: inputText,
          provider: { type: 'microsoft', voice_id: voiceId },
        },
        config: { stitch: true },
      }),
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå D-ID API.', detail: String(err) }, 502)
  }

  const rawText = await didResponse.text()
  let data: { id?: string; kind?: string; description?: string }
  try {
    data = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka D-IDs svar som JSON.', raw: rawText }, 502)
  }

  if (!didResponse.ok || !data?.id) {
    return jsonResponse({ error: 'D-ID API-fel', detail: data }, 502)
  }

  return jsonResponse({ id: data.id }, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/generate-did-video',
}
