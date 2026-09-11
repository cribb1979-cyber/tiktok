// AI-kortfilm, steg 2: genererar EN referensbild per karaktär (se generate-shotlist.ts) via
// Runway Gen-4 Image (Replicate) — återanvänds sedan som reference_images i
// generate-shot-image.ts för att hålla samma "person" konsekvent genom alla scener.
// Bara submit, pollas via BEFINTLIGA /api/broll-status (Replicates predictions-endpoint är
// modelloberoende — samma id fungerar oavsett vilken modell som skapade predictionen).
// REPLICATE_API_TOKEN exponeras aldrig i klienten.
//
// OBS: exakta fältnamn för runwayml/gen4-image på Replicate är sammanställda från
// tredjepartsdokumentation (nätverksbegränsningar hindrade verifiering direkt mot
// replicate.com härifrån) — främst bekräftat via ett riktigt exempel-payload
// ({ prompt, resolution, aspect_ratio, reference_tags, reference_images }). Om ett skarpt
// anrop ger ett fältnamnsfel, justera input nedan enligt Replicates egna felmeddelande
// (samma mönster som tidigare Bria/Shotstack-fältnamnsfixar i den här appen).

const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/models'
const REPLICATE_MODEL = 'runwayml/gen4-image'

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const replicateApiToken = Deno.env.get('REPLICATE_API_TOKEN')
  if (!replicateApiToken) {
    return jsonResponse({ error: 'REPLICATE_API_TOKEN saknas i Netlify-miljövariabler.' }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) {
    return jsonResponse({ error: 'description (karaktärsbeskrivning) krävs.' }, 400)
  }

  const replicateInput = {
    prompt: `Full body portrait, neutral studio background, cinematic lighting: ${description}`,
    aspect_ratio: '9:16',
  }

  let replicateResponse: Response
  try {
    replicateResponse = await fetch(`${REPLICATE_PREDICTIONS_URL}/${REPLICATE_MODEL}/predictions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${replicateApiToken}`,
      },
      body: JSON.stringify({ input: replicateInput }),
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå Replicate API.', detail: String(err) }, 502)
  }

  const rawText = await replicateResponse.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Replicate API-fel (ogiltigt svar)', detail: rawText }, 502)
  }

  if (!replicateResponse.ok || !data?.id) {
    return jsonResponse({ error: 'Replicate API-fel', detail: data }, 502)
  }

  return jsonResponse({ taskId: data.id }, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/generate-character-image',
}
