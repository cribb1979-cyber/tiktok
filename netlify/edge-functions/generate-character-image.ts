// AI-kortfilm, steg 2: genererar EN referensbild per karaktär (se generate-shotlist.ts) —
// återanvänds sedan som `image` i generate-shot-image.ts (Runway Gen-4 Image) för att hålla
// samma "person" konsekvent genom alla scener. Bara submit, pollas via BEFINTLIGA
// /api/broll-status (Replicates predictions-endpoint är modelloberoende — samma id fungerar
// oavsett vilken modell som skapade predictionen). REPLICATE_API_TOKEN exponeras aldrig i
// klienten.
//
// Använder FLUX Schnell (samma modell/fält som generate-background.ts, verifierade direkt
// mot Replicates öppna källkod för modellen) istället för Runway Gen-4 Image här — ett skarpt
// test visade att Gen-4 Image på Replicate KRÄVER ett `image`-fält (ett befintligt foto att
// utgå från), dvs. den kan inte generera en bild från ren text utan något att referera till.
// FLUX Schnell är ett rent text-till-bild-verktyg, perfekt för just DEN HÄR första bilden
// (ingen tidigare bild att referera till för en helt ny karaktär) — sedan används Gen-4 Image
// för scenbilderna (generate-shot-image.ts), där FLUX-portättet skickas in som `image`.

const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/models'
const FLUX_MODEL = 'black-forest-labs/flux-schnell'

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
    replicateResponse = await fetch(`${REPLICATE_PREDICTIONS_URL}/${FLUX_MODEL}/predictions`, {
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
