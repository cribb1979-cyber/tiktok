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

// response.json() kastar om svaret inte är giltig JSON — t.ex. om en Netlify Edge Function
// timear ut på plattformsnivå (överskrider körtidsgränsen) och Netlifys egen infrastruktur
// svarar med en HTML-felsida istället för vår egen felhantering. Utan skydd visar Safari då
// ett kryptiskt, generiskt DOM-felmeddelande ("The string did not match the expected
// pattern.") som inte säger något om vad som faktiskt gick fel — läs som text först och ge
// ett begripligt fel istället, samma mönster som redan används server-side i edge functions.
export async function parseJsonResponse(response) {
  const rawText = await response.text()
  try {
    return rawText ? JSON.parse(rawText) : {}
  } catch {
    throw new Error(
      `Servern svarade med ett oväntat format (inte JSON) — troligen ett tillfälligt fel eller en timeout. Försök igen om en liten stund. (HTTP ${response.status})`
    )
  }
}
