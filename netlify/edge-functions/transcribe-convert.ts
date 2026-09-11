// Steg 5 (delsteg för .mov m.fl.): startar en Shotstack-konvertering till mp4 av en
// uppladdad videos publika URL, och returnerar direkt (submittar bara — pollar INTE här).
//
// Anledning till att detta är ett eget, snabbt steg istället för att göra submit+poll+hämta+
// transkribera i ett enda anrop (som transcribe.ts gjorde tidigare för videoUrl-fallet):
// Netlify Edge Functions måste svara med headers inom 40 sekunder, annars dödar plattformen
// funktionen mitt i — och en Shotstack-konvertering kan själv ta längre än så. Klienten
// pollar istället /api/render-status (samma endpoint som videorenderingen redan använder)
// och skickar sen den färdiga mp4-URL:en till /api/transcribe. Se whisperClient.js.

import { submitShotstackRender } from './_lib/shotstack.ts'

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const shotstackApiKey = Deno.env.get('SHOTSTACK_API_KEY')
  if (!shotstackApiKey) {
    return jsonResponse({ error: 'SHOTSTACK_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
  }

  const videoUrl = body.videoUrl
  if (!videoUrl || typeof videoUrl !== 'string') {
    return jsonResponse({ error: 'videoUrl krävs.' }, 400)
  }

  let id: string
  try {
    id = await submitShotstackRender(shotstackApiKey, {
      timeline: {
        tracks: [{ clips: [{ asset: { type: 'video', src: videoUrl }, start: 0, length: 'auto' }] }],
      },
      output: { format: 'mp4', resolution: 'sd' },
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte starta videokonvertering (Shotstack).', detail: String(err) }, 502)
  }

  return jsonResponse({ id }, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/transcribe-convert',
}
