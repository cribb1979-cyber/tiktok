// Pollar status för en pågående Replicate (FLUX Schnell) bakgrundsbildsgenerering — se
// generate-background.ts för varför detta är submit+poll och inte "Prefer: wait".

const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/predictions'

// Samma normalisering som broll-status.ts/matte-video-status.ts.
const STATUS_MAP: Record<string, string> = {
  starting: 'PENDING',
  processing: 'RUNNING',
  succeeded: 'SUCCEEDED',
  failed: 'FAILED',
  canceled: 'FAILED',
}

export default async (request: Request) => {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const replicateApiToken = Deno.env.get('REPLICATE_API_TOKEN')
  if (!replicateApiToken) {
    return jsonResponse({ error: 'REPLICATE_API_TOKEN saknas i Netlify-miljövariabler.' }, 500)
  }

  const id = new URL(request.url).searchParams.get('id')
  if (!id) {
    return jsonResponse({ error: 'Query-parametern id krävs.' }, 400)
  }

  let response: Response
  try {
    response = await fetch(`${REPLICATE_PREDICTIONS_URL}/${id}`, {
      headers: { Authorization: `Bearer ${replicateApiToken}` },
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå Replicate API.', detail: String(err) }, 502)
  }

  const rawText = await response.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Replicate API-fel (ogiltigt svar)', detail: rawText }, 502)
  }

  if (!response.ok) {
    return jsonResponse({ error: 'Replicate API-fel', detail: data }, 502)
  }

  // output är alltid en array av URL:er för FLUX Schnell (verifierat mot cog-flux källkod).
  const output = data.output
  const imageUrl = Array.isArray(output) ? (output[0] ?? null) : null

  return jsonResponse(
    {
      status: STATUS_MAP[data.status as string] ?? data.status,
      imageUrl,
      error: data.error ?? null,
    },
    200
  )
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/generate-background-status',
}
