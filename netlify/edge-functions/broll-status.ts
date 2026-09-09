// Pollar status för en pågående Runway B-roll-generering.
// Se generate-broll.ts för anmärkningen om att API-formatet inte är testat mot ett riktigt
// Runway-konto i den här miljön.

const RUNWAY_TASKS_URL = 'https://api.dev.runwayml.com/v1/tasks'
const RUNWAY_VERSION = '2024-11-06'

export default async (request: Request) => {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const runwayApiKey = Deno.env.get('RUNWAY_API_KEY')
  if (!runwayApiKey) {
    return jsonResponse({ error: 'RUNWAY_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  const id = new URL(request.url).searchParams.get('id')
  if (!id) {
    return jsonResponse({ error: 'Query-parametern id krävs.' }, 400)
  }

  let response: Response
  try {
    response = await fetch(`${RUNWAY_TASKS_URL}/${id}`, {
      headers: {
        Authorization: `Bearer ${runwayApiKey}`,
        'X-Runway-Version': RUNWAY_VERSION,
      },
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå Runway API.', detail: String(err) }, 502)
  }

  const data = await response.json()

  if (!response.ok) {
    return jsonResponse({ error: 'Runway API-fel', detail: data }, 502)
  }

  return jsonResponse(
    {
      status: data.status,
      url: Array.isArray(data.output) ? data.output[0] ?? null : null,
      error: data.failure ?? data.failureReason ?? null,
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
