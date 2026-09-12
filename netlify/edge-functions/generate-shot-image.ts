// AI-kortfilm, steg 3: genererar en konsekvent bildruta för EN scen. Pollas via befintliga
// /api/broll-status. REPLICATE_API_TOKEN exponeras aldrig i klienten.
//
// Två vägar beroende på om scenen har någon återkommande karaktär:
// - Har scenen en karaktär: Runway Gen-4 Image, med karaktärens referensbild (från
//   generate-character-image.ts) i det bekräftat KRÄVDA `image`-fältet — ett skarpt test
//   visade att Replicates version av Gen-4 Image kräver `image` (inte `reference_images`/
//   `reference_tags` som tredjepartsdokumentation antydde). Eftersom fältet bara tar EN bild
//   används bara den FÖRSTA karaktären som syns i scenen som referens — en känd begränsning
//   för scener med flera karaktärer samtidigt (se README "AI-kortfilm").
// - Har scenen ingen karaktär (ren miljö-/stämningsbild): FLUX Schnell (samma modell som
//   generate-character-image.ts/generate-background.ts) — rent text-till-bild, inget
//   referensfoto att utgå från eller behövs.

const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/models'
const GEN4_IMAGE_MODEL = 'runwayml/gen4-image'
const FLUX_MODEL = 'black-forest-labs/flux-schnell'

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

  // Karaktärer som syns i DEN HÄR scenen — [{ tag, imageUrl }]. Tom lista för scener utan
  // återkommande karaktärer (t.ex. en ren miljö-/stämningsbild).
  const characterRefs = Array.isArray(body.characterRefs) ? (body.characterRefs as CharacterRef[]) : []
  // Bara den FÖRSTA karaktären används — Gen-4 Images `image`-fält tar bara en bild (se
  // anmärkningen högst upp i filen).
  const primaryRef = characterRefs[0]

  const replicateModel = primaryRef ? GEN4_IMAGE_MODEL : FLUX_MODEL
  const replicateInput: Record<string, unknown> = {
    prompt: imagePrompt,
    aspect_ratio: '9:16',
  }
  if (primaryRef) {
    replicateInput.image = primaryRef.imageUrl
  }

  let replicateResponse: Response
  try {
    replicateResponse = await fetch(`${REPLICATE_PREDICTIONS_URL}/${replicateModel}/predictions`, {
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
