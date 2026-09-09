// Steg 5: transkribering med tidsstämplar via Whisper API (OpenAI).
// Körs server-side som Netlify Edge Function — WHISPER_API_KEY exponeras aldrig i klienten.

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions'

// OpenAIs whisper-1-endpoint har en hård gräns på 25 MB per fil.
const MAX_FILE_BYTES = 25 * 1024 * 1024

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = Deno.env.get('WHISPER_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'WHISPER_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  let incomingForm: FormData
  try {
    incomingForm = await request.formData()
  } catch {
    return jsonResponse(
      { error: 'Kunde inte läsa uppladdad fil (förväntar multipart/form-data med fältet "file").' },
      400
    )
  }

  const file = incomingForm.get('file')
  if (!(file instanceof File)) {
    return jsonResponse({ error: 'Ingen fil hittades i fältet "file".' }, 400)
  }

  if (file.size > MAX_FILE_BYTES) {
    return jsonResponse({ error: 'Filen är för stor (max 25 MB). Korta ner klippet och försök igen.' }, 413)
  }

  // Whisper-endpointen avvisar .mov (standardformatet från iPhone/iPad), trots att kodeken
  // (H.264/HEVC + AAC) i praktiken är kompatibel. Det räcker inte att bara byta filnamnets
  // ändelse — multipart-anropets Content-Type för filen sätts från Blob/File-objektets egen
  // `type`-egenskap (video/quicktime), inte från filnamnet. Bygg därför om filen med rätt
  // `type` också. Inga bytes ändras.
  let uploadFile: File = file
  if (/\.mov$/i.test(file.name) || file.type === 'video/quicktime') {
    const filename = (file.name || 'upload').replace(/\.mov$/i, '') + '.mp4'
    const bytes = await file.arrayBuffer()
    uploadFile = new File([bytes], filename, { type: 'video/mp4' })
  }

  const whisperForm = new FormData()
  whisperForm.set('file', uploadFile)
  whisperForm.set('model', 'whisper-1')
  whisperForm.set('response_format', 'verbose_json')
  whisperForm.append('timestamp_granularities[]', 'segment')

  let whisperResponse: Response
  try {
    whisperResponse = await fetch(WHISPER_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: whisperForm,
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå Whisper API.', detail: String(err) }, 502)
  }

  if (!whisperResponse.ok) {
    const errText = await whisperResponse.text()
    return jsonResponse({ error: 'Whisper API-fel', detail: errText }, 502)
  }

  const data = await whisperResponse.json()

  // Normaliserat till { start, end, text } (sekunder) — samma form som skickas vidare
  // till Claude-anropet i generate-plan.ts.
  const segments = (data.segments ?? []).map((seg: { start: number; end: number; text: string }) => ({
    start: seg.start,
    end: seg.end,
    text: (seg.text ?? '').trim(),
  }))

  return jsonResponse({ text: data.text ?? '', segments }, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/transcribe',
}
