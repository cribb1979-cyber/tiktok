// Listar tillgängliga HeyGen-avatarer så Klippstudio kan visa en väljare istället för att
// vara låst till en enda HEYGEN_AVATAR_ID. Ren proxy — HEYGEN_API_KEY exponeras aldrig i
// klienten. Returnerar bara de fält UI:t faktiskt behöver, inte HeyGens fulla svar.

const HEYGEN_AVATARS_URL = 'https://api.heygen.com/v2/avatars'

export default async (request: Request) => {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = Deno.env.get('HEYGEN_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'HEYGEN_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  let response: Response
  try {
    response = await fetch(HEYGEN_AVATARS_URL, {
      headers: { 'X-Api-Key': apiKey },
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå HeyGen API.', detail: String(err) }, 502)
  }

  const rawText = await response.text()
  let data: { data?: { avatars?: unknown[] } }
  try {
    data = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka HeyGens svar som JSON.', raw: rawText }, 502)
  }

  if (!response.ok || !data?.data) {
    return jsonResponse({ error: 'HeyGen API-fel', detail: data }, 502)
  }

  const avatars = (data.data.avatars ?? []).map((a) => {
    const avatar = a as Record<string, unknown>
    return {
      id: avatar.avatar_id as string,
      name: (avatar.avatar_name as string) ?? (avatar.avatar_id as string),
      previewImageUrl: (avatar.preview_image_url as string) ?? null,
    }
  })

  return jsonResponse({ avatars }, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/list-avatars',
}
