// Valfritt tillval: byt bakgrund bakom dig i ditt eget klipp. Claude skriver en filmisk
// bildprompt utifrån din idé (t.ex. "ett slott bakom mig"), Replicate (FLUX Schnell)
// genererar en stillbild som ny bakgrund. Din egen video matas separat genom
// video-bakgrundsborttagning (se matte-video.ts) och kompositeras ovanpå bilden i
// render-clip.ts (backgroundSwapEnabled).
//
// CLAUDE_API_KEY och REPLICATE_API_TOKEN exponeras aldrig i klienten.
//
// OBS: FLUX Schnell-fälten (prompt/aspect_ratio) är verifierade direkt mot Replicates
// öppna källkod för modellen (cog-flux, predict.py) — output är alltid en array av URL:er.
// "Prefer: wait" gör att Replicate väntar in hela genereringen (FLUX Schnell tar bara någon
// sekund) och svarar direkt, så ingen separat pollningsloop behövs för det här steget.

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-5'
const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/models'
const FLUX_MODEL = 'black-forest-labs/flux-schnell'

const PROMPT_SYSTEM_BACKGROUND = `Du skriver en kort, visuell prompt för en AI-genererad
bakgrundsbild till ett TikTok-klipp om andlighet/medium-tema — bilden ersätter bakgrunden
bakom personen i klippet (den riktiga personen läggs på separat, ovanpå bilden, i ett senare
steg).

KRITISKT:
- Beskriv ENDAST plats/miljö/arkitektur/landskap (t.ex. ett slott, en klippa, en skog) —
  ALDRIG människor, ansikten eller kroppar i bilden, eftersom den riktiga personen läggs
  ovanpå separat.
- Filmisk komposition med tydligt djup (förgrund/mellangrund/bakgrund) så det ser naturligt
  ut att någon står eller går i bilden.
- Ingen text i bilden.
Svara med BARA prompten, max en mening, på engelska (bildmodeller fungerar bäst med engelska
prompts).`

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const claudeApiKey = Deno.env.get('CLAUDE_API_KEY')
  if (!claudeApiKey) {
    return jsonResponse({ error: 'CLAUDE_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
  }

  const customPrompt = typeof body.customPrompt === 'string' ? body.customPrompt.trim() : ''
  if (!customPrompt) {
    return jsonResponse({ error: 'customPrompt krävs — beskriv önskad bakgrund.' }, 400)
  }

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
        system: PROMPT_SYSTEM_BACKGROUND,
        messages: [{ role: 'user', content: `Bakgrundsidé: ${customPrompt}` }],
      }),
    })

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text()
      return jsonResponse({ error: 'Claude API-fel (bakgrundsprompt)', detail: errText }, 502)
    }

    const claudeData = await claudeResponse.json()
    const textBlock = (claudeData?.content ?? []).find((b: { type: string }) => b.type === 'text')
    visualPrompt = (textBlock?.text ?? '').trim()
    if (!visualPrompt) throw new Error('Tomt svar från Claude.')
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte generera bakgrundsprompt.', detail: String(err) }, 502)
  }

  const replicateApiToken = Deno.env.get('REPLICATE_API_TOKEN')
  if (!replicateApiToken) {
    return jsonResponse({ error: 'REPLICATE_API_TOKEN saknas i Netlify-miljövariabler.' }, 500)
  }

  let replicateResponse: Response
  try {
    replicateResponse = await fetch(`${REPLICATE_PREDICTIONS_URL}/${FLUX_MODEL}/predictions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${replicateApiToken}`,
        Prefer: 'wait',
      },
      body: JSON.stringify({
        input: {
          prompt: visualPrompt,
          aspect_ratio: '9:16',
        },
      }),
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå Replicate API.', detail: String(err) }, 502)
  }

  // .json() kan kasta om Replicate svarar med något som inte är giltig JSON — läs som text
  // först och försök tolka, samma mönster som generate-broll.ts.
  const rawText = await replicateResponse.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Replicate API-fel (ogiltigt svar)', detail: rawText }, 502)
  }

  if (!replicateResponse.ok) {
    return jsonResponse({ error: 'Replicate API-fel', detail: data }, 502)
  }

  // output är alltid en array av URL:er (verifierat mot cog-flux källkod). Om "Prefer: wait"
  // hann timea ut innan genereringen blev klar kan output saknas trots 200 OK — svara då med
  // ett tydligt fel istället för att skicka tomt vidare.
  const output = data.output
  const imageUrl = Array.isArray(output) ? output[0] : null

  if (!imageUrl) {
    return jsonResponse(
      { error: `Ingen bild genererades (Replicate-status: ${String(data.status)}).`, detail: data },
      502
    )
  }

  return jsonResponse({ imageUrl, prompt: visualPrompt }, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/generate-background',
}
