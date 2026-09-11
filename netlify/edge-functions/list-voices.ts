// Listar tillgängliga HeyGen-röster så Klippstudio kan visa en väljare istället för att vara
// låst till en enda HEYGEN_VOICE_ID. Ren proxy — HEYGEN_API_KEY exponeras aldrig i klienten.
// Inkluderar supportPause (röstens stöd för <break>-taggen, se generate-avatar-video.ts/
// README "Manus-läge") så UI:t kan varna om en vald röst inte stödjer inbyggda pauser.

const HEYGEN_VOICES_URL = 'https://api.heygen.com/v2/voices'

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
    response = await fetch(HEYGEN_VOICES_URL, {
      headers: { 'X-Api-Key': apiKey },
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå HeyGen API.', detail: String(err) }, 502)
  }

  const rawText = await response.text()
  let data: { data?: { voices?: unknown[] } }
  try {
    data = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka HeyGens svar som JSON.', raw: rawText }, 502)
  }

  if (!response.ok || !data?.data) {
    return jsonResponse({ error: 'HeyGen API-fel', detail: data }, 502)
  }

  const voices = (data.data.voices ?? []).map((v) => {
    const voice = v as Record<string, unknown>
    return {
      id: voice.voice_id as string,
      name: (voice.name as string) ?? (voice.voice_id as string),
      language: (voice.language as string) ?? null,
      gender: (voice.gender as string) ?? null,
      supportPause: voice.support_pause === true,
    }
  })

  return jsonResponse({ voices }, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/list-voices',
}
