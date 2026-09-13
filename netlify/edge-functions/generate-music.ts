// Valfritt tillval: AI-genererad bakgrundsmusik (med egen text/sång eller rent instrumentalt)
// via Replicate, modellen ACE-Step (`lucataco/ace-step`) — öppen källkod, valt efter research
// (WebSearch, 2026-09) som det klart billigaste alternativet med stöd för EGEN TEXT + fri
// stilbeskrivning: ~0,0002 USD/SEKUND genererat ljud (dvs. under 0,02 USD för en 60s-låt —
// jämfört med Meta MusicGen ~0,06 USD/generering, som bara gör instrumental musik utan
// sångtext-stöd, och ElevenLabs Music API, som har officiell API men kostar ~0,30-0,65 USD
// PER MINUT och kräver en helt ny tjänst/nyckel). Suno (den mest kända sångtjänsten) har
// ingen officiell publik API alls 2026 — bara opålitliga tredjepartswrappers, medvetet
// undviket samma sätt som tidigare i den här appen.
//
// KORRIGERING #2 (skarpt test, samma fel igen): `fishaudio/ace-step-1.5` gav 404, rättat till
// `lucataco/ace-step` (bekräftat via en riktad `site:replicate.com`-sökning) — men det gav
// ETT NYTT 404 vid nästa skarpa test. Två felaktiga modellnamn i rad tyder på att namn-baserade
// träffar från sökmotorresultat/AI-sammanfattningar av dem inte går att lita på här (kan vara
// gamla/borttagna/privata modeller, eller AI-sammanfattningen kan ha konstruerat en plausibel
// men fel URL av flera olika källor). Bytt strategi: istället för att gissa ett `ägare/namn`
// och lita på "senaste versionen"-genvägen, används nu en EXPLICIT version-ID (en konkret
// hash, hittad i en sökträff för `andreasjansson/ace-step:9fa9677d...`, inte bara ett namn)
// via Replicates generella `/v1/predictions`-endpoint — mindre känsligt för att modellens
// "senaste version" pekar om eller att ägar/namn-kombinationen är fel.
//
// CLAUDE_API_KEY och REPLICATE_API_TOKEN exponeras aldrig i klienten.
//
// FORTFARANDE OSÄKERT (kunde inte verifieras mot ett skarpt svar härifrån —
// replicate.com/api.replicate.com är blockerade från den här sandboxen, bara
// forskningsresultat, inget faktiskt testanrop): om `REPLICATE_MODEL_VERSION` nedan
// fortfarande ger 404/fel vid nästa test, är säkraste nästa steg att slå upp modellen direkt
// i ditt eget Replicate-konto (replicate.com/explore, sök "ace-step") och skicka mig den
// exakta `ägare/modellnamn`-sökvägen du ser där — det är mer tillförlitligt än ytterligare
// sökmotorgissningar härifrån. Input-fältnamnen (`tags`/`lyrics`/`duration`) är oförändrade
// och bekräftade av flera oberoende källor, sannolikt inte boven om felet kvarstår.
//
// Pollas via BEFINTLIGA /api/broll-status — Replicates predictions-endpoint är
// modelloberoende, samma id fungerar oavsett vilken modell som skapade prediction, så ingen
// ny statusendpoint behövdes (samma återanvändning som redan gäller för D-ID/HeyGen-mönstret
// dokumenterat i README).

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-5'
const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/predictions'
// andreasjansson/ace-step, version 9fa9677d... — se korrigeringskommentaren ovan för varför
// ett explicit version-ID används istället för ägare/namn + "senaste version"-genvägen.
const REPLICATE_MODEL_VERSION = '9fa9677db3357a7f1975ed49365e2825ab7e9a61ba659768534cef95a1ffb303'

const DEFAULT_DURATION_SECONDS = 60
const MAX_DURATION_SECONDS = 240

const PROMPT_SYSTEM_MUSIC_TAGS = `Du skriver en kort, kommaseparerad lista av taggar på ENGELSKA
som beskriver en musikstil för en AI-musikmodell (ACE-Step) — samma format som
Suno/musikgenereringsverktyg förväntar sig: genre, stämning, instrument, sångstil, tempo/BPM.

Exempel på bra svar: "dark ambient, mystical, slow tempo, ethereal female vocals, atmospheric
pads, 70 bpm" eller "upbeat pop, energetic, male vocals, synths, 120 bpm".

KRITISKT: svara med BARA taggarna, kommaseparerat, inget annat — ingen förklaring, inga
citattecken, ingen rubrik.`

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

  // Valfri fri idé för musikstilen (t.ex. "mörk, spöklik stämning") — skickas via Claude för
  // att skrivas om till ACE-Steps förväntade taggformat (kommaseparerade engelska nyckelord).
  const styleIdea = typeof body.styleIdea === 'string' ? body.styleIdea.trim() : ''
  // Om klienten redan har en Claude-förfinad tagglista (se refineOnly nedan) och användaren
  // godkänt/redigerat den, skickas den igen här — hoppar då över Claude-steget.
  const refinedTags = typeof body.refinedTags === 'string' ? body.refinedTags.trim() : ''
  // true = bara förfina/översätta stilidén via Claude och returnera taggarna, utan att starta
  // någon (betald) Replicate-generering.
  const refineOnly = body.refineOnly === true
  // Egen sångtext (helt valfritt) — skickas OFÖRÄNDRAD till ACE-Step, ingen Claude-omskrivning
  // (användaren skriver sin EGEN text, precis som efterfrågat). Tomt/saknat värde = rent
  // instrumental (ACE-Steps eget "[instrumental]"-läge).
  const lyrics = typeof body.lyrics === 'string' ? body.lyrics.trim() : ''
  const durationSeconds =
    typeof body.durationSeconds === 'number' && body.durationSeconds > 0
      ? Math.min(body.durationSeconds, MAX_DURATION_SECONDS)
      : DEFAULT_DURATION_SECONDS

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

  if (refineOnly) {
    return jsonResponse({ tags }, 200)
  }

  const replicateApiToken = Deno.env.get('REPLICATE_API_TOKEN')
  if (!replicateApiToken) {
    return jsonResponse({ error: 'REPLICATE_API_TOKEN saknas i Netlify-miljövariabler.' }, 500)
  }

  let replicateResponse: Response
  try {
    replicateResponse = await fetch(REPLICATE_PREDICTIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${replicateApiToken}`,
      },
      body: JSON.stringify({
        version: REPLICATE_MODEL_VERSION,
        input: {
          tags,
          lyrics: lyrics || '[instrumental]',
          duration: durationSeconds,
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
