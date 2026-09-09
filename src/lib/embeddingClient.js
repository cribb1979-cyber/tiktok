// Anropar Netlify Edge Function /api/embed-text — aldrig OpenAI direkt från klienten.
export async function embedText(text) {
  const response = await fetch('/api/embed-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error ?? 'Kunde inte generera embedding.')
  }

  return data.embedding
}
