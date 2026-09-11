// Pollar status för en pågående HeyGen-avatarvideogenerering (se generate-avatar-video.ts).

const HEYGEN_STATUS_URL = 'https://api.heygen.com/v1/video_status.get'

// HeyGens statusvärden (pending/processing/completed/failed) skiljer sig från vårt
// klient-kontrakt (PENDING/RUNNING/SUCCEEDED/FAILED, samma normalisering som
// broll-status.ts/generate-background-status.ts) — normaliseras här så heygenClient.js kan
// dela pollningsmönster med resten av appen.
const STATUS_MAP: Record<string, string> = {
  pending: 'PENDING',
  waiting: 'PENDING',
  processing: 'RUNNING',
  completed: 'SUCCEEDED',
  failed: 'FAILED',
}

export default async (request: Request) => {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = Deno.env.get('HEYGEN_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'HEYGEN_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  const id = new URL(request.url).searchParams.get('id')
  if (!id) {
    return jsonResponse({ error: 'Query-parametern id krävs.' }, 400)
  }

  let response: Response
  try {
    response = await fetch(`${HEYGEN_STATUS_URL}?video_id=${encodeURIComponent(id)}`, {
      headers: { 'X-Api-Key': apiKey },
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå HeyGen API.', detail: String(err) }, 502)
  }

  const rawText = await response.text()
  let data: { data?: { status?: string; video_url?: string; error?: { message?: string } } }
  try {
    data = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka HeyGens svar som JSON.', raw: rawText }, 502)
  }

  if (!response.ok || !data?.data) {
    return jsonResponse({ error: 'HeyGen API-fel', detail: data }, 502)
  }

  const statusData = data.data

  return jsonResponse(
    {
      status: STATUS_MAP[statusData.status as string] ?? statusData.status,
      url: statusData.video_url ?? null,
      error: statusData.error?.message ?? null,
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
  path: '/api/avatar-video-status',
}
