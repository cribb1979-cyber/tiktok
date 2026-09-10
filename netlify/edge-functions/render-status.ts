// Steg 6: pollar status för en pågående Shotstack-rendering.

const SHOTSTACK_HOST =
  Deno.env.get('SHOTSTACK_ENV') === 'v1' ? 'https://api.shotstack.io/v1' : 'https://api.shotstack.io/stage'

export default async (request: Request) => {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = Deno.env.get('SHOTSTACK_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'SHOTSTACK_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  const id = new URL(request.url).searchParams.get('id')
  if (!id) {
    return jsonResponse({ error: 'Query-parametern id krävs.' }, 400)
  }

  let shotstackResponse: Response
  try {
    shotstackResponse = await fetch(`${SHOTSTACK_HOST}/render/${id}`, {
      headers: { 'x-api-key': apiKey },
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå Shotstack API.', detail: String(err) }, 502)
  }

  const rawText = await shotstackResponse.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka Shotstacks svar som JSON.', raw: rawText }, 502)
  }

  if (!shotstackResponse.ok || !data?.response) {
    return jsonResponse({ error: 'Shotstack API-fel', detail: data }, 502)
  }

  const responseData = data.response as Record<string, unknown>

  return jsonResponse(
    {
      status: responseData.status,
      url: responseData.url ?? null,
      error: responseData.error ?? null,
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
  path: '/api/render-status',
}
