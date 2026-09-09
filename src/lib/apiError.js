// Slår ihop en edge functions felsvar { error, detail } till ett meddelande som visar hela
// underliggande felet (t.ex. Claude/Whisper/Shotstacks egna felmeddelande) direkt i
// gränssnittet, istället för bara den generiska texten — slipper leta i Netlify-loggar.
export function errorMessage(data, fallback) {
  const base = data?.error ?? fallback
  const detail = data?.detail
  if (!detail) return base
  const detailText = typeof detail === 'string' ? detail : JSON.stringify(detail)
  return `${base}: ${detailText}`
}
