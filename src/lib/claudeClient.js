import { errorMessage } from './apiError.js'

// Anropar Netlify Edge Function /api/generate-plan — aldrig Claude API direkt från klienten.
export async function generateClipPlan({
  prompt,
  category,
  subtopic,
  transcript = [],
  trendContext = [],
  previousBestClips = [],
  targetDurationSeconds = null,
}) {
  const response = await fetch('/api/generate-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      category,
      subtopic,
      transcript,
      trendContext,
      previousBestClips,
      targetDurationSeconds,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(errorMessage(data, 'Något gick fel vid generering av klippningsplan.'))
  }

  return data
}
