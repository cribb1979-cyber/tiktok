// Valfritt tillval: AI-genererad bakgrundsmusik/låt (egen sångtext) via Replicate.
//
// KORRIGERING #3 (2026-09, bytt modell helt efter kvalitetsklagomål): `andreasjansson/ace-step`
// (den version-ID-pinnade modellen från Korrigering #2) gav tekniskt sett 200 OK och en spelbar
// låt, MEN ignorerade `duration` helt — bekräftat direkt i användarens eget Replicate-konto
// (Predictions-fliken): en begäran om 180 sekunder gav en låt på ~29 sekunder, med bara 27
// diffusionssteg och 9 sekunders total GPU-tid, dvs. modellen kör alltid sin snabba
// "förhandsgranskings"-konfiguration oavsett indata. Det förklarar även den upplevt låga
// ljudkvaliteten (färre steg = sämre resultat). Detta är alltså en verklig begränsning i den
// specifika community-porten, inte ett fel i vår egen kod.
//
// Bytt till **`minimax/music-1.5`** — en OFFICIELL Replicate-modell (114 800+ körningar,
// "Official"-märkt), betydligt mer pålitlig än de tre tidigare gissade community-portarna.
// Till skillnad från ACE-Step-sagan ovan är input-schemat denna gång bekräftat direkt av
// användaren själv (skärmdumpar av Replicates egen schema-sida), INTE en sökmotorgissning:
//   - `lyrics` (sträng, 10–600 tecken, stödjer [intro][verse][chorus][bridge][outro])
//   - `prompt` (sträng, 10–300 tecken — stil/genre/stämning, ACE-Steps `tags`-motsvarighet)
// VIKTIGA SKILLNADER mot ACE-Step (medvetet vald avvägning, se konversationen/README):
//   - INGET `duration`-fält alls — låtens längd styrs implicit av hur mycket text som skrivs
//     i `lyrics`, inget separat reglage för det.
//   - INGET renodlat instrumental-läge — `lyrics` kräver riktig text (minst 10 tecken), till
//     skillnad från ACE-Steps `[instrumental]`-konvention. All musik genererad här har sång.
// Körs via Replicates genvägs-endpoint (`/v1/models/{ägare}/{namn}/predictions`, senaste
// versionen) eftersom `minimax` är en etablerad, officiell modellägare — lägre risk än de
// gissade enskilda användarnamnen som gav 404 tidigare.
//
// CLAUDE_API_KEY och REPLICATE_API_TOKEN exponeras aldrig i klienten.
//
// Pollas via BEFINTLIGA /api/broll-status — Replicates predictions-endpoint är
// modelloberoende, samma id fungerar oavsett vilken modell som skapade prediction, så ingen
// ny statusendpoint behövdes (samma återanvändning som redan gäller för D-ID/HeyGen-mönstret
// dokumenterat i README).

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-5'
const REPLICATE_MODEL_PREDICTIONS_URL = 'https://api.replicate.com/v1/models/minimax/music-1.5/predictions'

const LYRICS_MIN_LENGTH = 10
const LYRICS_MAX_LENGTH = 600
const PROMPT_MAX_LENGTH = 300

const PROMPT_SYSTEM_MUSIC_TAGS = `Du skriver en kort, kommaseparerad lista av taggar på ENGELSKA
som beskriver en musikstil för en AI-musikmodell (MiniMax Music) — samma format som
Suno/musikgenereringsverktyg förväntar sig: genre, stämning, instrument, sångstil, tempo/BPM.

Exempel på bra svar: "dark ambient, mystical, slow tempo, ethereal female vocals, atmospheric
pads, 70 bpm" eller "upbeat pop, energetic, male vocals, synths, 120 bpm".

KRITISKT: svara med BARA taggarna, kommaseparerat, inget annat — ingen förklaring, inga
citattecken, ingen rubrik. Håll svaret under 250 tecken totalt.`

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
  }

  const styleIdea = typeof body.styleIdea === 'string' ? body.styleIdea.trim() : ''
  const refinedTags = typeof body.refinedTags === 'string' ? body.refinedTags.trim() : ''
  const refineOnly = body.refineOnly === true
  const lyrics = typeof body.lyrics === 'string' ? body.lyrics.trim() : ''

  if (!refinedTags && !styleIdea) {
    return jsonResponse({ error: 'styleIdea (musikstil) krävs.' }, 400)
  }

  const claudeApiKey = Deno.env.get('CLAUDE_API_KEY')
  if (!claudeApiKey) {
    return jsonResponse({ error: 'CLAUDE_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  let tags: string
  if (refinedTags) {
    tags = refinedTags
  } else {
    try {
      const claudeResponse = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 200,
          system: PROMPT_SYSTEM_MUSIC_TAGS,
          messages: [{ role: 'user', content: `Musikstil: ${styleIdea}` }],
        }),
      })

      if (!claudeResponse.ok) {
        const errText = await claudeResponse.text()
        return jsonResponse({ error: 'Claude API-fel (musiktaggar)', detail: errText }, 502)
      }

      const claudeData = await claudeResponse.json()
      const textBlock = (claudeData?.content ?? []).find((b: { type: string }) => b.type === 'text')
      tags = (textBlock?.text ?? '').trim()
      if (!tags) throw new Error('Tomt svar från Claude.')
    } catch (err) {
      return jsonResponse({ error: 'Kunde inte generera musiktaggar.', detail: String(err) }, 502)
    }
  }

  // Skyddsnät: MiniMax `prompt`-fältet tillåter max 300 tecken. Klipps defensivt om Claude
  // (eller en användarredigerad tagglista) skulle överskrida det.
  if (tags.length > PROMPT_MAX_LENGTH) {
    tags = tags.slice(0, PROMPT_MAX_LENGTH)
  }

  if (refineOnly) {
    return jsonResponse({ tags }, 200)
  }

  if (lyrics.length < LYRICS_MIN_LENGTH || lyrics.length > LYRICS_MAX_LENGTH) {
    return jsonResponse(
      {
        error: `Sångtext krävs (MiniMax Music stödjer inte rent instrumentalt) — mellan ${LYRICS_MIN_LENGTH} och ${LYRICS_MAX_LENGTH} tecken. Just nu: ${lyrics.length} tecken.`,
      },
      400,
    )
  }

  const replicateApiToken = Deno.env.get('REPLICATE_API_TOKEN')
  if (!replicateApiToken) {
    return jsonResponse({ error: 'REPLICATE_API_TOKEN saknas i Netlify-miljövariabler.' }, 500)
  }

  let replicateResponse: Response
  try {
    replicateResponse = await fetch(REPLICATE_MODEL_PREDICTIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${replicateApiToken}`,
      },
      body: JSON.stringify({
        input: {
          lyrics,
          prompt: tags,
        },
      }),
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå Replicate API.', detail: String(err) }, 502)
  }

  const rawText = await replicateResponse.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Replicate API-fel (ogiltigt svar)', detail: rawText }, 502)
  }

  if (!replicateResponse.ok || !data?.id) {
    return jsonResponse({ error: 'Replicate API-fel', detail: data }, 502)
  }

  return jsonResponse({ taskId: data.id, tags }, 200)
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/generate-music',
}
