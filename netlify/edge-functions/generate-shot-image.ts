// AI-kortfilm, steg 3: genererar en konsekvent bildruta för EN scen, med de karaktärer som
// syns i scenen som referensbilder (se generate-character-image.ts) — samma Runway Gen-4
// Image-mekanik som håller "samma person" igenkännbar mellan scenerna. Bildrutan animeras
// sedan till video i generate-shot-video.ts. Pollas via befintliga /api/broll-status.
// REPLICATE_API_TOKEN exponeras aldrig i klienten.
//
// OBS: se anmärkningen i generate-character-image.ts om att exakta Replicate-fältnamn inte
// gick att verifiera direkt mot replicate.com härifrån — reference_images/reference_tags är
// bekräftade via ett riktigt exempel-payload, men justera om ett skarpt anrop ger fel.

const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/models'
const REPLICATE_MODEL = 'runwayml/gen4-image'
// Gen-4 Image tillåter max 3 referensbilder per anrop.
const MAX_REFERENCE_IMAGES = 3

type CharacterRef = { tag: string; imageUrl: string }

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

  const imagePrompt = typeof body.imagePrompt === 'string' ? body.imagePrompt.trim() : ''
  if (!imagePrompt) {
    return jsonResponse({ error: 'imagePrompt krävs.' }, 400)
  }

  // Karaktärer som syns i DEN HÄR scenen — [{ tag, imageUrl }], matchar @tag i imagePrompt
  // (satt av generate-shotlist.ts). Tom lista för scener utan återkommande karaktärer (t.ex.
  // en ren miljö-/stämningsbild).
  const characterRefs = Array.isArray(body.characterRefs) ? (body.characterRefs as CharacterRef[]) : []
  const refs = characterRefs.slice(0, MAX_REFERENCE_IMAGES)

  const replicateInput: Record<string, unknown> = {
    prompt: imagePrompt,
    aspect_ratio: '9:16',
  }
  if (refs.length > 0) {
    replicateInput.reference_images = refs.map((r) => r.imageUrl)
    replicateInput.reference_tags = refs.map((r) => r.tag)
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
  path: '/api/generate-shot-image',
}
