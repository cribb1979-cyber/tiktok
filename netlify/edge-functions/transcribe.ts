// Steg 5: transkribering med tidsstämplar via Whisper API (OpenAI).
// Körs server-side som Netlify Edge Function — WHISPER_API_KEY exponeras aldrig i klienten.

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
    // client-side konvertering är inte möjlig där). Klienten har redan konverterat videon
    // via /api/transcribe-convert + /api/render-status (se whisperClient.js) INNAN den
    // anropar oss — vi får bara den redan klara mp4-URL:en här. Att göra submit+poll av
    // Shotstack-konverteringen i DETTA anrop (som tidigare) riskerade att överskrida
    // Netlify Edge Functions 40-sekundersgräns för att svara med headers, vilket lät
    // hela anropet hänga sig utan att någonsin lyckas eller felas.
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
    }

    const mp4Url = body.mp4Url
    if (!mp4Url || typeof mp4Url !== 'string') {
      return jsonResponse({ error: 'mp4Url krävs.' }, 400)
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

  const rawWhisperText = await whisperResponse.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(rawWhisperText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka Whispers svar som JSON.', raw: rawWhisperText }, 502)
  }

  // Whisper hallucinerar ibland en fast fransk boilerplate-fras ("Sous-titres réalisés par la
  // communauté d'Amara.org" och varianter) på tyst/nästan tyst ljud — ett känt artefaktmönster
  // från träningsdatan (Amara.org är en community för crowd-sourcade undertexter). Filtreras
  // bort här, innan Claude-planeringen eller undertextrenderingen någonsin ser den — annars
  // dyker enstaka ord ur frasen (t.ex. "SOUS") upp som meningslösa ord-för-ord-undertexter.
  const isWhisperHallucination = (text: string) => /amara\.org|sous-titres/i.test(text)

  // Normaliserat till { start, end, text } (sekunder) — samma form som skickas vidare
  // till Claude-anropet i generate-plan.ts.
  const rawSegments = ((data.segments as unknown[]) ?? []).map((seg: { start: number; end: number; text: string }) => ({
    start: seg.start,
    end: seg.end,
    text: (seg.text ?? '').trim(),
  }))
  const hallucinatedRanges = rawSegments.filter((seg) => isWhisperHallucination(seg.text))
  const segments = rawSegments.filter((seg) => !isWhisperHallucination(seg.text))

  // Enskilda ord ur en hallucinerad fras ("Sous", "titres", "par", ...) innehåller själva
  // inte "amara.org" och matchar därför inte isWhisperHallucination direkt — filtreras
  // istället bort via tidsstämpel mot de hallucinerade segmentens tidsintervall.
  const words = ((data.words as unknown[]) ?? [])
    .map((w: { word: string; start: number; end: number }) => ({
      word: (w.word ?? '').trim(),
      start: w.start,
      end: w.end,
    }))
    .filter((w) => !hallucinatedRanges.some((r) => w.start >= r.start && w.start < r.end))

  // data.text (Whisperts egen sammanslagna helhetstext) är opåverkad av filtreringen ovan —
  // bygg om den från de rensade segmenten istället, så förhandsvisningen i Klippstudio inte
  // visar boilerplate-frasen även när resten av transkriptet är rent.
  const text = segments.map((s) => s.text).join(' ').trim()

  return jsonResponse({ text, segments, words }, 200)
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
