import { errorMessage, parseJsonResponse } from './apiError.js'

// Anropar Netlify Edge Function /api/transcribe — aldrig Whisper API direkt från klienten.
export async function transcribeMedia(file) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData,
  })

  const data = await parseJsonResponse(response)

  if (!response.ok) {
    throw new Error(errorMessage(data, 'Något gick fel vid transkribering.'))
  }

  return data // { text, segments: [{ start, end, text }], words: [{ word, start, end }] }
}

// För format Whisper inte accepterar direkt (t.ex. .mov från iPhone/iPad) — servern
// konverterar videon via Shotstack innan transkribering. videoUrl måste vara publikt nåbar.
export async function transcribeFromUrl(videoUrl) {
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoUrl }),
  })

  const data = await parseJsonResponse(response)

  if (!response.ok) {
    throw new Error(errorMessage(data, 'Något gick fel vid transkribering.'))
  }

  return data
}
