import { errorMessage, parseJsonResponse } from './apiError.js'

// Anropar Netlify Edge Function /api/generate-narration — aldrig OpenAI direkt från klienten.
// Berättarläge (se Klippstudio.jsx/Berattare.jsx): omvandlar skriven text till en spelbar
// ljudfil (mp3), som sedan laddas upp till Supabase Storage (uploadRawClip, samma mönster som
// allt annat råmaterial) för att få en URL att skicka vidare till /api/render-clip som
// narrationAudioUrl.
//
// Till skillnad från B-roll/HeyGen/D-ID är det HÄR inget submit+poll-flöde — OpenAIs
// text-till-tal-endpoint svarar direkt med den färdiga ljudfilen (någon sekund), inte ett
// asynkront jobb-id.
export async function generateNarrationAudio(text, voice) {
  const response = await fetch('/api/generate-narration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  })

  if (!response.ok) {
    const data = await parseJsonResponse(response)
    throw new Error(errorMessage(data, 'Kunde inte generera berättarröst.'))
  }

  return response.blob()
}
