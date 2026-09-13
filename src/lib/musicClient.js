import { errorMessage, parseJsonResponse } from './apiError.js'

// Anropar Netlify Edge Function /api/generate-music — aldrig Replicate/Claude direkt från
// klienten. Byggd mot ACE-Step 1.5 (Replicate) — se generate-music.ts för leverantörsvalet
// (billigast med stöd för egen sångtext). Pollas via BEFINTLIGA /api/broll-status —
// Replicates predictions-endpoint är modelloberoende, ingen ny statusendpoint behövdes.

async function submitMusic({ styleIdea, refinedTags, lyrics, durationSeconds }) {
  const response = await fetch('/api/generate-music', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ styleIdea, refinedTags, lyrics, durationSeconds }),
  })

  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte starta musikgenerering.'))
  }
  return data // { taskId, tags }
}

async function getMusicStatus(taskId) {
  const response = await fetch(`/api/broll-status?id=${encodeURIComponent(taskId)}`)
  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte hämta musikgenereringsstatus.'))
  }
  return data
}

// Låter Claude förfina/översätta en fri stilidé (t.ex. "mörk, spöklik stämning") till
// ACE-Steps förväntade taggformat, UTAN att starta någon (betald) Replicate-generering — så
// användaren kan se och redigera taggarna innan de bekräftar.
export async function refineMusicStyle(styleIdea) {
  const response = await fetch('/api/generate-music', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ styleIdea, refineOnly: true }),
  })

  const data = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(errorMessage(data, 'Kunde inte förfina musikstilen.'))
  }
  return data.tags
}

const POLL_INTERVAL_MS = 5000
const MAX_POLL_ATTEMPTS = 60 // ~5 minuter — samma tålamodsgräns som B-roll

// Startar musikgenerering (opt-in, aldrig automatiskt) och pollar tills den är klar.
// refinedTags (valfritt): en redan Claude-förfinad/redigerad tagglista (se refineMusicStyle)
// — skickas med för att slippa köra Claude-steget igen.
export async function generateMusic({ styleIdea, refinedTags, lyrics, durationSeconds, onStatus }) {
  const { taskId, tags } = await submitMusic({ styleIdea, refinedTags, lyrics, durationSeconds })

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    const result = await getMusicStatus(taskId)
    onStatus?.(result.status)

    if (result.status === 'SUCCEEDED') return { url: result.url, tags }
    if (result.status === 'FAILED') {
      throw new Error(result.error ?? 'Musikgenereringen misslyckades hos Replicate.')
    }
  }

  throw new Error('Musikgenereringen tog för lång tid. Försök igen senare.')
}
