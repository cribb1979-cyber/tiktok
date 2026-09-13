// Pollar status för en pågående D-ID-videogenerering (se generate-did-video.ts). Samma
// osäkerhet som där kring autentiseringsformatet — justera enligt D-IDs eget felmeddelande om
// den skarpa nyckeln behöver base64-kodas här också (`Basic ${apiKey}` som den är, inte
// omkodad).
const DID_TALKS_URL = 'https://api.d-id.com/talks'

// D-IDs statusvärden (created/started/done/error) skiljer sig från vårt klient-kontrakt
// (PENDING/RUNNING/SUCCEEDED/FAILED, samma normalisering som avatar-video-status.ts/
// broll-status.ts) — normaliseras här så didClient.js kan dela pollningsmönster med resten
// av appen.
const STATUS_MAP: Record<string, string> = {
  created: 'PENDING',
  started: 'RUNNING',
  done: 'SUCCEEDED',
  error: 'FAILED',
}

export default async (request: Request) => {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = Deno.env.get('DID_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'DID_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  const id = new URL(request.url).searchParams.get('id')
  if (!id) {
    return jsonResponse({ error: 'Query-parametern id krävs.' }, 400)
  }

  let response: Response
  try {
    response = await fetch(`${DID_TALKS_URL}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Basic ${apiKey}` },
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå D-ID API.', detail: String(err) }, 502)
  }

  const rawText = await response.text()
  let data: { status?: string; result_url?: string; error?: { description?: string; message?: string } }
  try {
    data = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka D-IDs svar som JSON.', raw: rawText }, 502)
  }

  if (!response.ok) {
    return jsonResponse({ error: 'D-ID API-fel', detail: data }, 502)
  }

  return jsonResponse(
    {
      status: STATUS_MAP[data.status as string] ?? data.status,
      url: data.result_url ?? null,
      error: data.error?.description ?? data.error?.message ?? null,
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
  path: '/api/did-video-status',
}
