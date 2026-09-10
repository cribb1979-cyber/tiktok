// Tar bort bakgrunden ur användarens egen uppladdade video (Replicate, Bria
// video-remove-background) och ersätter den med en solid GRÖN färg — så att Shotstacks
// befintliga chromaKey-funktion (samma teknik som AI-overlay-effekterna, se
// generate-broll.ts) kan användas för att kompositera personen ovanpå en ny, AI-genererad
// bakgrund i render-clip.ts (backgroundSwapEnabled, se generate-background.ts för bilden).
// REPLICATE_API_TOKEN exponeras aldrig i klienten.
//
// OBS: background_color ("Green") och output_format ("mp4_h264") är verifierade mot
// Bria/Replicates dokumentation. Det exakta fältnamnet för själva video-inputen ("video"
// nedan) kunde INTE verifieras (Brias källkod är inte öppen) — räkna med att det kan behöva
// justeras första gången det körs skarpt, samma mönster som övriga Replicate-integrationer i
// det här projektet: visa hela felmeddelandet, justera.
//
// VIKTIGT: Bria har en gräns på max 60 sekunders indata. Vi skickar hela den uppladdade
// videon (inte bara det valda segmentet) för att slippa ett separat förklippningssteg —
// klipp längre än 60 sekunder kommer alltså att felas här. Om det blir ett vanligt problem
// är nästa steg att förklippa till bara det aktuella segmentet via Shotstack innan matning.

const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/models'
const MATTE_MODEL = 'bria/video-remove-background'

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

  const videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl : null
  if (!videoUrl) {
    return jsonResponse({ error: 'videoUrl krävs.' }, 400)
  }

  let replicateResponse: Response
  try {
    replicateResponse = await fetch(`${REPLICATE_PREDICTIONS_URL}/${MATTE_MODEL}/predictions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${replicateApiToken}`,
      },
      body: JSON.stringify({
        input: {
          video: videoUrl,
          background_color: 'Green',
          output_format: 'mp4_h264',
        },
      }),
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
  path: '/api/matte-video',
}
