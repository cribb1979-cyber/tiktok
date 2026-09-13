// Valfritt tillval: AI-genererad bakgrundsmusik (med egen text/sång eller rent instrumentalt)
// via Replicate, modellen ACE-Step 1.5 (`fishaudio/ace-step-1.5`) — öppen källkod, valt efter
// research (WebSearch, 2026-09) som det klart billigaste alternativet med stöd för EGEN TEXT
// + fri stilbeskrivning: ~0,04 USD/generering (jämfört med Meta MusicGen ~0,06 USD/generering,
// som bara gör instrumental musik utan sångtext-stöd, och ElevenLabs Music API, som har officiell
// API men kostar ~0,30-0,65 USD PER MINUT och kräver en helt ny tjänst/nyckel). Suno (den mest
// kända sångtjänsten) har ingen officiell publik API alls 2026 — bara opålitliga
// tredjepartswrappers, medvetet undviket samma sätt som tidigare i den här appen.
//
// CLAUDE_API_KEY och REPLICATE_API_TOKEN exponeras aldrig i klienten.
//
// OSÄKERT (kunde inte verifieras mot ett skarpt svar härifrån — replicate.com är blockerad
// från den här sandboxen): input-fältnamnen (`tags`/`lyrics`/`duration`) är sammanställda
// från Replicates egen modellsida och ACE-Steps officiella dokumentation, men INTE testade
// mot ett skarpt Replicate-anrop. Justera enligt Replicates eget felmeddelande om ett
// fältnamn visar sig fel vid nästa test, samma mönster som tidigare HeyGen/D-ID/Bria-
// fältnamnsfixar i den här appen.
//
// Pollas via BEFINTLIGA /api/broll-status — Replicates predictions-endpoint är
// modelloberoende, samma id fungerar oavsett vilken modell som skapade prediction, så ingen
// ny statusendpoint behövdes (samma återanvändning som redan gäller för D-ID/HeyGen-mönstret
// dokumenterat i README).

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-5'
const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/models'
const REPLICATE_MODEL = 'fishaudio/ace-step-1.5'

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
    replicateResponse = await fetch(`${REPLICATE_PREDICTIONS_URL}/${REPLICATE_MODEL}/predictions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${replicateApiToken}`,
      },
      body: JSON.stringify({
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
