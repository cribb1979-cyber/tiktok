import { errorMessage } from './apiError.js'

// Anropar Netlify Edge Functions /api/generate-broll och /api/broll-status — aldrig
// Replicate/Claude direkt från klienten. Byggd mot Replicate (Wan 2.1) — tidigare Runway,
// bytt för lägre kostnad. Se generate-broll.ts för detaljer om leverantören.

async function submitBroll({ category, subtopic, hookText, customPrompt, allowIllustrativeFigures, refinedPrompt }) {
  const response = await fetch('/api/generate-broll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category,
      subtopic,
      hookText,
      customPrompt,
      allowIllustrativeFigures,
      refinedPrompt,
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta B-roll-generering.'))
  }
  return data // { taskId, prompt }
}

async function getBrollStatus(taskId) {
  const response = await fetch(`/api/broll-status?id=${encodeURIComponent(taskId)}`)
  const data = await response.json()
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte hämta B-roll-status.'))
  }
  return data
}

// Låter Claude förfina/översätta användarens egen idé (eller kategori/hook) till en
// filmisk engelsk bildprompt UTAN att starta någon (betald) Replicate-generering — så
// användaren kan se och redigera texten innan de bekräftar. Ingen polling, bara ett snabbt
// Claude-anrop.
export async function refineBrollPrompt({ category, subtopic, hookText, customPrompt, allowIllustrativeFigures }) {
  const response = await fetch('/api/generate-broll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category,
      subtopic,
      hookText,
      customPrompt,
      allowIllustrativeFigures,
      refineOnly: true,
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte förfina prompten.'))
  }
  return data.prompt
}

const POLL_INTERVAL_MS = 5000
const MAX_POLL_ATTEMPTS = 60 // ~5 minuter — videogenerering kan ta tid

// Startar B-roll-generering (opt-in, aldrig automatiskt) och pollar tills den är klar.
// refinedPrompt (valfritt): en redan Claude-förfinad/redigerad prompt (se
// refineBrollPrompt) — skickas med för att slippa köra Claude-steget igen.
export async function generateBroll({
  category,
  subtopic,
  hookText,
  customPrompt,
  allowIllustrativeFigures,
  refinedPrompt,
  onStatus,
}) {
  const { taskId, prompt } = await submitBroll({
    category,
    subtopic,
    hookText,
    customPrompt,
    allowIllustrativeFigures,
    refinedPrompt,
  })

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    const result = await getBrollStatus(taskId)
    onStatus?.(result.status)

    if (result.status === 'SUCCEEDED') return { url: result.url, prompt }
    if (result.status === 'FAILED') {
      throw new Error(result.error ?? 'B-roll-genereringen misslyckades hos Replicate.')
    }
  }

  throw new Error('B-roll-genereringen tog för lång tid. Försök igen senare.')
}
