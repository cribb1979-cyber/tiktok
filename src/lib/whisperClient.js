import { errorMessage } from './apiError.js'

// Anropar Netlify Edge Function /api/transcribe — aldrig Whisper API direkt från klienten.
export async function transcribeMedia(file) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData,
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(errorMessage(data, 'Något gick fel vid transkribering.'))
  }

  return data // { text, segments: [{ start, end, text }] }
}
