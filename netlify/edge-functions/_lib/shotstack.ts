// Delad hjälpkod för Shotstack-anrop. Filnamnet börjar med "_" så Netlify inte
// registrerar den som en egen endpoint — bara importerbar från andra edge functions.

export const SHOTSTACK_HOST =
  Deno.env.get('SHOTSTACK_ENV') === 'v1' ? 'https://api.shotstack.io/v1' : 'https://api.shotstack.io/stage'

export async function submitShotstackRender(apiKey: string, editPayload: unknown): Promise<string> {
  const response = await fetch(`${SHOTSTACK_HOST}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(editPayload),
  })
  const data = await parseShotstackJson(response)
  if (!response.ok || !data?.response?.id) {
    throw new Error(`Shotstack render-fel: ${JSON.stringify(data)}`)
  }
  return data.response.id as string
}

// .json() kan kasta om Shotstack svarar med något som inte är giltig JSON (t.ex. en
// HTML-felsida vid ett tillfälligt driftavbrott) — läs som text först och försök tolka, så
// anroparen får ett förklarande Error istället för att krascha okontrollerat.
async function parseShotstackJson(response: Response): Promise<{ response?: { id?: string; status?: string; url?: string; error?: string } }> {
  const rawText = await response.text()
  try {
    return JSON.parse(rawText)
  } catch {
    throw new Error(`Kunde inte tolka Shotstacks svar som JSON: ${rawText}`)
  }
}

export async function pollShotstackRender(
  apiKey: string,
  id: string,
  maxAttempts = 40,
  intervalMs = 3000
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))

    const response = await fetch(`${SHOTSTACK_HOST}/render/${id}`, {
      headers: { 'x-api-key': apiKey },
    })
    const data = await parseShotstackJson(response)
    if (!response.ok || !data?.response) {
      throw new Error(`Shotstack status-fel: ${JSON.stringify(data)}`)
    }
    if (data.response.status === 'done') return data.response.url as string
    if (data.response.status === 'failed') {
      throw new Error(`Shotstack-rendering misslyckades: ${data.response.error ?? 'okänt fel'}`)
    }
  }
  throw new Error('Shotstack-rendering tog för lång tid.')
}
