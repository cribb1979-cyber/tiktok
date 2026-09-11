import { errorMessage, parseJsonResponse } from './apiError.js'

// Anropar Netlify Edge Function /api/generate-plan — aldrig Claude API direkt från klienten.
// clips: [{ id, transcript }] — ett eller flera uppladdade råklipp, se
// buildClipsFromState i Klippstudio.jsx.
export async function generateClipPlan({
  prompt,
  category,
  subtopic,
  clips = [],
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
      clips,
      trendContext,
      previousBestClips,
      targetDurationSeconds,
    }),
  })

  const data = await parseJsonResponse(response)

  if (!response.ok) {
    throw new Error(errorMessage(data, 'Något gick fel vid generering av klippningsplan.'))
  }

  return data
}

// Anropar Netlify Edge Function /api/revise-plan — reviderar en BEFINTLIG klippningsplan med
// en fri textinstruktion ("redigera med vägledning"), istället för att bara justera start-/
// sluttid/hastighet manuellt per segment. frames: bas64 JPEG (utan data:-prefix), en per
// segment, hämtade klientsidigt (se captureGuidanceFrames i Klippstudio.jsx).
export async function revisePlan({ segmentsPlan, clips = [], editInstruction, frames = [] }) {
  const response = await fetch('/api/revise-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segmentsPlan, clips, editInstruction, frames }),
  })

  const data = await parseJsonResponse(response)

  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte redigera klippningsplanen.'))
  }

  return data // { segments_plan, segment_speeds, summary }
}
