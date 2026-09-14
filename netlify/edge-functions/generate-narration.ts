// Berättarläge (valfritt tillval): omvandlar en skriven berättartext till tal via OpenAIs
// text-till-tal-API (samma OpenAI-konto/nyckel som redan används för Whisper — WHISPER_API_KEY
// är i praktiken bara "OpenAI-nyckeln", se samma återanvändning i embed-text.ts). Vald leverantör
// eftersom den redan är betald för via Whisper-kontot — ingen ny tjänst/nyckel/kostnad behövdes
// för det här tillvalet (jämfört med t.ex. ElevenLabs, som hade gett bättre röstkvalitet men
// krävt en helt ny integration).
//
// Returnerar den råa ljudfilen direkt (Content-Type: audio/mpeg), INTE en JSON-URL — OpenAIs
// TTS-endpoint ger tillbaka bytes direkt, ingen asynkron submit+poll behövs (rösten genereras på
// någon sekund, långt under Netlify Edge Functions 40-sekundersgräns). Klienten laddar upp de
// mottagna bytesen till Supabase Storage själv (samma uploadRawClip-flöde som allt annat
// råmaterial) för att få en publik URL att skicka vidare till /api/render-clip.
const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech'

// KORRIGERING (2026-09, efter klagomål om dåligt uttal): bytt från `tts-1` till `gpt-4o-mini-tts`
// — samma pris (~15 USD/1M tecken) men klart bättre, mer naturligt uttal/prosodi (bekräftat via
// WebSearch mot OpenAIs egen API-dokumentation, developers.openai.com/api/docs/guides/text-to-speech
// och developers.openai.com/api/reference/.../speech/methods/create). Samma endpoint/request-form,
// bara modellnamnet ändrat plus ett nytt `instructions`-fält (bara giltigt för gpt-4o-mini-tts,
// INTE tts-1/tts-1-hd) som styr leveransen i naturligt språk — används här för att uttryckligen be
// om tydligt, naturligt uttal.
const TTS_MODEL = 'gpt-4o-mini-tts'

// KORRIGERING (2026-09, klagomål om engelsk brytning i svenskt uttal): förstärkt instruktionen
// med en uttrycklig begäran om äkta svenskt uttal/fonetik, inte bara "naturligt". OSÄKERT hur
// mycket detta faktiskt hjälper — forumtrådar om gpt-4o-mini-tts rapporterar att
// accent-instruktioner inte alltid följs tillförlitligt för alla språk (modellens röster är i
// grunden optimerade för engelska, kvaliteten varierar per språk). Om uttalet fortfarande
// känns bruten efter det här: nästa steg vore en dedikerad svensk röstleverantör (t.ex. Azure
// Cognitive Services, samma sv-SE-SofieNeural-röst som redan används för D-ID i Manus-läget)
// — men det kräver en ny tjänst/nyckel/kostnad, inte gjort här.
const NARRATION_INSTRUCTIONS =
  'Texten är skriven på svenska. Uttala ALLA ord med äkta svenskt uttal och svensk fonetik — ' +
  'som en infödd svensktalande, INTE med engelsk brytning eller engelska vokalljud. Tala varmt ' +
  'och engagerande, som en berättarröst i en kort video, med tydlig och naturlig betoning.'

// "fable" beskrivs i OpenAIs egen dokumentation som en varm, berättande röst — bäst passform
// för en berättarröst jämfört med de mer neutrala alternativen (alloy/echo/nova/shimmer/onyx).
// Rösten är flerspråkig och följer automatiskt textens eget språk (svenska in ger svenskt
// uttal), ingen separat språkinställning behövs. Styrbar per anrop (voice i body) eller via
// NARRATION_VOICE i Netlify-miljövariabler. Finns kvar som röst även i gpt-4o-mini-tts.
const DEFAULT_VOICE = 'fable'

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = Deno.env.get('WHISPER_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'WHISPER_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return jsonResponse({ error: 'text (berättartexten) krävs.' }, 400)
  }

  const voice = (typeof body.voice === 'string' && body.voice) || Deno.env.get('NARRATION_VOICE') || DEFAULT_VOICE

  let openaiResponse: Response
  try {
    openaiResponse = await fetch(OPENAI_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: text,
        voice,
        instructions: NARRATION_INSTRUCTIONS,
        response_format: 'mp3',
      }),
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå OpenAIs text-till-tal-API.', detail: String(err) }, 502)
  }

  if (!openaiResponse.ok) {
    const errText = await openaiResponse.text()
    return jsonResponse({ error: 'OpenAI text-till-tal-fel', detail: errText }, 502)
  }

  const audioBytes = await openaiResponse.arrayBuffer()
  return new Response(audioBytes, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg' },
  })
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/generate-narration',
}
