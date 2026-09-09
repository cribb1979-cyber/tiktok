// Steg 10: genererar embeddings för pgvector-retrieval av liknande tidigare klipp.
// Anthropic har inget eget embeddings-API, så vi återanvänder OpenAI-nyckeln som redan
// finns för Whisper (WHISPER_API_KEY). Modellen text-embedding-3-small ger 1536
// dimensioner — matchar embedding vector(1536)-kolumnen i migrationen.

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = Deno.env.get('WHISPER_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'WHISPER_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
  }

  const text = body.text
  if (!text || typeof text !== 'string') {
    return jsonResponse({ error: 'text krävs.' }, 400)
  }

  let response: Response
  try {
    response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå OpenAI Embeddings API.', detail: String(err) }, 502)
  }

  if (!response.ok) {
    const errText = await response.text()
    return jsonResponse({ error: 'Embeddings API-fel', detail: errText }, 502)
  }

  const data = await response.json()
  const embedding = data?.data?.[0]?.embedding

  if (!Array.isArray(embedding)) {
    return jsonResponse({ error: 'Oväntat svar från Embeddings API.' }, 502)
  }

  return jsonResponse({ embedding }, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/embed-text',
}
