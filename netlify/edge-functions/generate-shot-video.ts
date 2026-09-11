// AI-kortfilm, steg 4 (sista): animerar en scens färdiga bildruta (se generate-shot-image.ts)
// till en kort videoklipp via Runway Gen-4 Turbo (bild-till-video, Replicate). Resultatet blir
// ETT klipp i clips-listan i Klippstudio.jsx, precis som ett uppladdat råklipp eller en
// Manus-genererad AI-avatar-video — hela nedströms klippningsplan-/renderingsflödet
// återanvänds oförändrat. Pollas via befintliga /api/broll-status.
// REPLICATE_API_TOKEN exponeras aldrig i klienten.
//
// OBS: fältnamnen nedan (prompt_image/prompt/duration/ratio) är sammanställda från Runways
// egen SDK-dokumentation (image_to_video.create) och tredjepartswrappers — Replicates EGNA
// wrapper-schema för runwayml/gen4-turbo kunde inte verifieras direkt mot replicate.com
// härifrån (nätverksbegränsningar). Justera enligt Replicates felmeddelande vid ett skarpt
// anrop om fältnamnen inte stämmer exakt (samma mönster som tidigare Bria/Shotstack-fixar).

const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/models'
const REPLICATE_MODEL = 'runwayml/gen4-turbo'

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

  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : ''
  const motionPrompt = typeof body.motionPrompt === 'string' ? body.motionPrompt.trim() : ''
  if (!imageUrl || !motionPrompt) {
    return jsonResponse({ error: 'imageUrl och motionPrompt krävs.' }, 400)
  }

  // Gen-4 Turbo stödjer bara 5 eller 10 sekunder.
  const duration = body.durationSeconds === 10 ? 10 : 5

  const replicateInput = {
    prompt_image: imageUrl,
    prompt: motionPrompt,
    duration,
    ratio: '720:1280', // 9:16, matchar OUTPUT_SIZE i render-clip.ts
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
  path: '/api/generate-shot-video',
}
