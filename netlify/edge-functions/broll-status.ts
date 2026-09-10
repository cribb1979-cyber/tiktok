// Pollar status för en pågående Replicate (Wan 2.1) B-roll-generering.
// Se generate-broll.ts för anmärkningen om att API-formatet inte är testat mot ett riktigt
// Replicate-konto i den här miljön.

const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/predictions'

// Replicates statusvärden (starting/processing/succeeded/failed/canceled) skiljer sig från
// vårt klient-kontrakt (PENDING/RUNNING/SUCCEEDED/FAILED, satt när B-roll byggdes mot Runway)
// — normaliseras här så runwayClient.js/Klippstudio.jsx inte behöver ändras.
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
  // först och försök tolka, så ett ogiltigt svar ger ett vettigt felmeddelande istället för
  // att krascha hela funktionen (samma bugg/fix som i generate-broll.ts).
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
  path: '/api/broll-status',
}
