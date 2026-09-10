// Pollar status för en pågående video-bakgrundsborttagning (Replicate, Bria
// video-remove-background). Se matte-video.ts för anmärkningen om fältnamn som inte kunde
// verifieras. Samma normaliserings-mönster som broll-status.ts.

const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/predictions'

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

  // .json() kan kasta om Replicate svarar med något som inte är giltig JSON — läs som text
  // först och försök tolka, samma mönster som broll-status.ts.
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

  return jsonResponse(
    {
      status: STATUS_MAP[data.status as string] ?? data.status,
      url: Array.isArray(data.output) ? data.output[0] ?? null : typeof data.output === 'string' ? data.output : null,
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
  path: '/api/matte-video-status',
}
