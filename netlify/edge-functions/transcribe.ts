// Steg 5: transkribering med tidsstämplar via Whisper API (OpenAI).
// Körs server-side som Netlify Edge Function — WHISPER_API_KEY exponeras aldrig i klienten.

import { submitShotstackRender, pollShotstackRender } from './_lib/shotstack.ts'

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions'

// OpenAIs whisper-1-endpoint har en hård gräns på 25 MB per fil.
const MAX_FILE_BYTES = 25 * 1024 * 1024

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const whisperApiKey = Deno.env.get('WHISPER_API_KEY')
  if (!whisperApiKey) {
    return jsonResponse({ error: 'WHISPER_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  const contentType = request.headers.get('content-type') ?? ''
  let fileToTranscribe: File

  if (contentType.includes('application/json')) {
    // Format Whisper inte accepterar direkt (t.ex. .mov från iPhone/iPad — Safari på iOS
    // saknar både decodeAudioData-stöd för videocontainrar och captureStream, så
    // client-side konvertering är inte möjlig där). Klienten skickar istället en publik
    // URL till källvideon (redan uppladdad till Supabase Storage för renderingssteget) —
    // Shotstack (server-side, riktig omkodning) gör en enkel passthrough-rendering till
    // mp4 innan vi skickar resultatet vidare till Whisper.
    const shotstackApiKey = Deno.env.get('SHOTSTACK_API_KEY')
    if (!shotstackApiKey) {
      return jsonResponse({ error: 'SHOTSTACK_API_KEY saknas i Netlify-miljövariabler.' }, 500)
    }

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
    }

    const videoUrl = body.videoUrl
    if (!videoUrl || typeof videoUrl !== 'string') {
      return jsonResponse({ error: 'videoUrl krävs.' }, 400)
    }

    let mp4Url: string
    try {
      const renderId = await submitShotstackRender(shotstackApiKey, {
        timeline: {
          tracks: [{ clips: [{ asset: { type: 'video', src: videoUrl }, start: 0, length: 'auto' }] }],
        },
        // Shotstack kräver antingen "resolution" eller "size" i output — glömdes här
        // (render-clip.ts hade det redan rätt), vilket gav ett Bad Request-fel.
        output: { format: 'mp4', resolution: 'sd' },
      })
      mp4Url = await pollShotstackRender(shotstackApiKey, renderId)
    } catch (err) {
      return jsonResponse({ error: 'Kunde inte konvertera videon (Shotstack).', detail: String(err) }, 502)
    }

    let mp4Response: Response
    try {
      mp4Response = await fetch(mp4Url)
    } catch (err) {
      return jsonResponse({ error: 'Kunde inte hämta den konverterade videon.', detail: String(err) }, 502)
    }
    if (!mp4Response.ok) {
      return jsonResponse(
        { error: 'Kunde inte hämta den konverterade videon.', detail: `HTTP ${mp4Response.status}` },
        502
      )
    }

    const mp4Bytes = await mp4Response.arrayBuffer()
    if (mp4Bytes.byteLength > MAX_FILE_BYTES) {
      return jsonResponse({ error: 'Den konverterade filen är för stor (max 25 MB) för transkribering.' }, 413)
    }

    fileToTranscribe = new File([mp4Bytes], 'converted.mp4', { type: 'video/mp4' })
  } else {
    // Redan Whisper-kompatibelt format — vanlig direktuppladdning.
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

    fileToTranscribe = file
  }

  const whisperForm = new FormData()
  whisperForm.set('file', fileToTranscribe, fileToTranscribe.name || 'upload')
  whisperForm.set('model', 'whisper-1')
  whisperForm.set('response_format', 'verbose_json')
  whisperForm.append('timestamp_granularities[]', 'segment')
  // Ord-nivå-tidsstämplar — används för ord-för-ord-animerade undertexter (CapCut/TikTok-stil)
  // i render-clip.ts, istället för statiska frasöverlägg.
  whisperForm.append('timestamp_granularities[]', 'word')

  let whisperResponse: Response
  try {
    whisperResponse = await fetch(WHISPER_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${whisperApiKey}` },
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

  const words = (data.words ?? []).map((w: { word: string; start: number; end: number }) => ({
    word: (w.word ?? '').trim(),
    start: w.start,
    end: w.end,
  }))

  return jsonResponse({ text: data.text ?? '', segments, words }, 200)
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
