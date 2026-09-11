// Manus-läge (steg 7): skickar den sammanslagna talbara dialogen (klienten bygger den av
// parse-script.ts's beats — regianvisningar är redan bortrensade) till HeyGen, som genererar
// en talande AI-avatar-video. Submittar bara och returnerar direkt (samma submit+poll-mönster
// som B-roll/bakgrundsbild/.mov-konvertering — videogenerering kan ta längre än Netlify Edge
// Functions 40-sekundersgräns för att svara med headers). Klienten pollar
// /api/avatar-video-status. HEYGEN_API_KEY exponeras aldrig i klienten.
//
// Leverantörsval (HeyGen, inte Synthesia/Arcads): HeyGen är rent pay-as-you-go per genererad
// sekund utan krav på månadsabonnemang för API-åtkomst (från ca $1/min vid 1080p,
// "Avatar III"-kvalitet) — Synthesia kräver ett $89/mån-abonnemang för API-åtkomst
// överhuvudtaget, och Arcads kräver en anpassad "Pro"-plan för API-åtkomst utan öppen
// prislista. Matchar appens övriga mönster (Shotstack/Replicate, betala per användning,
// inget fast månadsåtagande för en funktion som används oregelbundet).
//
// avatar_id/voice_id är kontospecifika (väljs en gång i HeyGens dashboard/API, se README) —
// satta via miljövariabler istället för en egen väljar-UI, för att hålla första versionen enkel.

const HEYGEN_GENERATE_URL = 'https://api.heygen.com/v2/video/generate'

// 9:16, TikTok-format — matchar OUTPUT_SIZE i render-clip.ts.
const AVATAR_DIMENSION = { width: 720, height: 1280 }

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = Deno.env.get('HEYGEN_API_KEY')
  const avatarId = Deno.env.get('HEYGEN_AVATAR_ID')
  const voiceId = Deno.env.get('HEYGEN_VOICE_ID')
  if (!apiKey || !avatarId || !voiceId) {
    return jsonResponse(
      { error: 'HEYGEN_API_KEY, HEYGEN_AVATAR_ID och HEYGEN_VOICE_ID krävs i Netlify-miljövariabler.' },
      500
    )
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
  }

  const inputText = typeof body.inputText === 'string' ? body.inputText.trim() : ''
  if (!inputText) {
    return jsonResponse({ error: 'inputText (sammanslagen talbar dialog) krävs.' }, 400)
  }

  let heygenResponse: Response
  try {
    heygenResponse = await fetch(HEYGEN_GENERATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        video_inputs: [
          {
            character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
            voice: { type: 'text', input_text: inputText, voice_id: voiceId },
          },
        ],
        dimension: AVATAR_DIMENSION,
      }),
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå HeyGen API.', detail: String(err) }, 502)
  }

  // .json() kan kasta om HeyGen svarar med något som inte är giltig JSON — läs som text
  // först och försök tolka, samma mönster som övriga edge functions i appen.
  const rawText = await heygenResponse.text()
  let data: { data?: { video_id?: string }; error?: { message?: string; code?: string } }
  try {
    data = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka HeyGens svar som JSON.', raw: rawText }, 502)
  }

  if (!heygenResponse.ok || !data?.data?.video_id) {
    return jsonResponse({ error: 'HeyGen API-fel', detail: data?.error ?? data }, 502)
  }

  return jsonResponse({ id: data.data.video_id }, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/generate-avatar-video',
}
