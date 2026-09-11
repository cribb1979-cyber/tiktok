// Steg 4: klippningsplan + hook-förslag via Claude API.
// Körs server-side som Netlify Edge Function — CLAUDE_API_KEY exponeras aldrig i klienten.

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODEL = 'claude-sonnet-5'

const SYSTEM_PROMPT = `Du är en TikTok-klippstrateg för kontot @stoffe_medium (andlighet/medium-nisch, ~15k följare).
Ditt jobb: föreslå en klippningsplan för ett kort videoklipp, baserat på användarens idé.

Föreslå 2-3 hook-alternativ i hook_variants, och 3-5 relevanta hashtags i suggested_hashtags
(utan "#"-tecken, blanda breda och nischade). Om inga klipp är uppladdade än, basera
segmentplanen på användarens promptbeskrivning istället och märk segmentens tider som
preliminära uppskattningar (t.ex. "00:00"–"00:05").

Ett eller flera RÅKLIPP kan vara uppladdade (se "Uppladdade klipp" nedan), varje med ett
eget id och eget transkript. VIKTIGT om flera klipp finns:
- Varje segment i segments_plan MÅSTE ha ett clip_id som anger VILKET klipp segmentets
  start/end-tider syftar på — start/end är alltid relativa till DET klippets EGEN tidslinje,
  aldrig en gemensam tidslinje över flera klipp.
- Använd klippen i den ordning de laddades upp om inget annat gör mer narrativ mening (t.ex.
  om ett senare klipp faktiskt är en bättre öppning) — hitta inte på en konstlad ordning.
  Du behöver inte använda hela varje klipp eller ens alla klipp.
- Om bara ett klipp finns, sätt clip_id till det klippets id på alla segment (samma beteende
  som tidigare, bara uttryckt explicit).

Om en önskad total videolängd anges: anpassa antal segment och deras start/end-tider så att
summan av alla segmentens längder hamnar så nära den önskade totallängden som möjligt (inom
någon sekund). Ett kort mål (t.ex. 15s) ska ge färre/kortare segment, ett längre mål (t.ex. 60s)
fler eller längre segment — hitta inte bara på en enda lång sekvens.

Engagemang: TikToks algoritm belönar kommentarer och delningar mer än bara visningar. Låt
därför minst ett hook-alternativ, eller det sista segmentets description, avsluta med en öppen
fråga till tittaren istället för ett rent påstående (t.ex. "Skulle du testa detta?" eller
"Har du upplevt något liknande?") när innehållet naturligt tillåter det — inte tvingat om
ämnet inte passar en fråga.

suggested_subtitles bränns in som textöverlägg i videon och MÅSTE vara korta nyckelfraser,
max ca 30 tecken vardera (t.ex. "Lugnet ger energin plats" — inte hela meningar som "Lugnet
ger energin plats att flöda fritt genom kroppen"). Längre fraser klipps av i renderingen.
(hook_variants.text ska fortsatt vara en fullständig, säljande hook-mening — den återanvänds
som klippets huvudrubrik i Bibliotek, inte bara som textöverlägg, och kortas av separat bara
i själva videoöverlägget om den är för lång.)

thought_bubbles: 2-4 korta "inre tankar" som dyker upp som glödande tankebubblor ovanpå
bilden — i jag-form eller som retoriska frågor som förstärker känslan i klippet (t.ex. "Vad om
det är sant?", "Jag kände det på en gång"). Max ca 25 tecken vardera, samma anledning som
suggested_subtitles.`

// Svarsformatet tvingas fram strukturellt via output_config.format (json_schema) — modellen
// kan inte avvika från detta, så inget behov av att be den "bara svara med JSON" i prompten.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    segments_plan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          clip_id: {
            type: 'string',
            description:
              'Vilket uppladdat klipp (matchar id i "Uppladdade klipp") segmentets start/end syftar på. Lämna tom sträng om inga klipp finns uppladdade.',
          },
          start: { type: 'string', description: 'Starttid INOM det klippet, mm:ss' },
          end: { type: 'string', description: 'Sluttid INOM det klippet, mm:ss' },
          description: { type: 'string' },
          order: { type: 'integer' },
        },
        required: ['clip_id', 'start', 'end', 'description', 'order'],
        additionalProperties: false,
      },
    },
    hook_variants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['text', 'rationale'],
        additionalProperties: false,
      },
    },
    suggested_subtitles: {
      type: 'array',
      items: { type: 'string' },
      description: 'Korta nyckelfraser, max ca 30 tecken vardera — bränns in som textöverlägg, klipps av om längre.',
    },
    suggested_hashtags: {
      type: 'array',
      items: { type: 'string' },
      description:
        '3-5 relevanta TikTok-hashtags för klippet, utan "#"-tecken (läggs på i UI). Blanda breda (t.ex. andlighet, fyp) och nischade (kopplade till ämnet/kategorin).',
    },
    thought_bubbles: {
      type: 'array',
      items: { type: 'string' },
      description:
        '2-4 korta "inre tankar" (jag-form eller retoriska frågor), max ca 25 tecken vardera — visas som glödande tankebubblor ovanpå bilden, klipps av om längre.',
    },
    category: {
      type: 'string',
      description:
        'En av: Kärlek/relationer, Paranormalt/andevärlden, Personlig reflektion/citat, Vardag/bakom kulisserna',
    },
    subtopic: { type: 'string' },
  },
  required: [
    'segments_plan',
    'hook_variants',
    'suggested_subtitles',
    'suggested_hashtags',
    'thought_bubbles',
    'category',
    'subtopic',
  ],
  additionalProperties: false,
}

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = Deno.env.get('CLAUDE_API_KEY')
  if (!apiKey) {
    return jsonResponse({ error: 'CLAUDE_API_KEY saknas i Netlify-miljövariabler.' }, 500)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Ogiltig JSON i request-body.' }, 400)
  }

  const {
    prompt,
    category,
    subtopic,
    // Ett eller flera uppladdade råklipp: [{ id, transcript }]. transcript är samma
    // segment-med-tidsstämplar-form som tidigare (från Whisper), bara nästlad per klipp.
    // Tom array om inget råmaterial laddats upp än.
    clips,
    // Dagens trenddata (hashtags/ljud). Tom/utelämnad tills Idébanken (steg 7) kopplas på.
    trendContext,
    // Few-shot-kontext: tidigare bäst presterande klipp i samma kategori (retrieval via
    // pgvector kommer i steg 10, manuell historik i steg 9). Skickas som tom array redan nu
    // så anropsformatet inte behöver ändras när den datan väl finns.
    previousBestClips,
    // Önskad total längd på det färdiga klippet, i sekunder (t.ex. 15/30/60/90).
    // Valfri — om den utelämnas väljer Claude en rimlig längd själv.
    targetDurationSeconds,
  } = body

  if (!prompt || typeof prompt !== 'string') {
    return jsonResponse({ error: 'prompt (text) krävs.' }, 400)
  }

  const userMessage = [
    `Idé/prompt: ${prompt}`,
    typeof category === 'string' && category ? `Vald kategori: ${category}` : null,
    typeof subtopic === 'string' && subtopic ? `Vald underämne: ${subtopic}` : null,
    typeof targetDurationSeconds === 'number' && targetDurationSeconds > 0
      ? `Önskad total längd på det färdiga klippet: ca ${targetDurationSeconds} sekunder — anpassa antal segment och deras längd så att summan hamnar nära detta.`
      : null,
    buildTrendBlock(trendContext),
    buildClipsBlock(clips),
    buildFewShotBlock(previousBestClips),
  ]
    .filter(Boolean)
    .join('\n\n')

  let claudeResponse: Response
  try {
    claudeResponse = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: RESPONSE_SCHEMA,
          },
        },
      }),
    })
  } catch (err) {
    return jsonResponse({ error: 'Kunde inte nå Claude API.', detail: String(err) }, 502)
  }

  if (!claudeResponse.ok) {
    const errText = await claudeResponse.text()
    return jsonResponse({ error: 'Claude API-fel', detail: errText }, 502)
  }

  const claudeData = await claudeResponse.json()

  if (claudeData.stop_reason === 'refusal') {
    return jsonResponse({ error: 'Claude avböjde att svara på den här förfrågan.' }, 502)
  }
  if (claudeData.stop_reason === 'max_tokens') {
    return jsonResponse({ error: 'Svaret blev avbrutet (max_tokens nått) och kan vara ofullständigt.' }, 502)
  }

  const textBlock = (claudeData?.content ?? []).find((block: { type: string }) => block.type === 'text')
  const rawText = textBlock?.text ?? ''

  let plan: unknown
  try {
    plan = JSON.parse(rawText)
  } catch {
    return jsonResponse({ error: 'Kunde inte tolka Claudes svar som JSON.', raw: rawText }, 502)
  }

  return jsonResponse(plan, 200)
}

function buildFewShotBlock(previousBestClips: unknown) {
  if (!Array.isArray(previousBestClips) || previousBestClips.length === 0) {
    return 'Tidigare bäst presterande klipp (few-shot-exempel): inga tillgängliga ännu.'
  }
  const examples = previousBestClips
    .map((clip, i) => {
      const c = clip as Record<string, unknown>
      return `Exempel ${i + 1}:
Hook: ${c.hook_text ?? '–'}
Kategori: ${c.category ?? '–'} / ${c.subtopic ?? '–'}
Resultat: ${c.views_24h ?? '–'} visningar, ${c.avg_watch_pct ?? '–'}% snitt-tittartid
Klippningsplan: ${JSON.stringify(c.segments_plan ?? [])}`
    })
    .join('\n\n')
  return `Tidigare bäst presterande klipp (few-shot-exempel, samma kategori):\n\n${examples}`
}

function buildClipsBlock(clips: unknown): string {
  if (!Array.isArray(clips) || clips.length === 0) {
    return 'Uppladdade klipp: inga än. Basera planen på prompten istället — lämna clip_id som tom sträng på alla segment.'
  }
  const blocks = clips.map((c, i) => {
    const clip = c as Record<string, unknown>
    const id = typeof clip.id === 'string' && clip.id ? clip.id : `clip-${i}`
    const transcript = Array.isArray(clip.transcript) ? clip.transcript : []
    const transcriptText =
      transcript.length > 0
        ? `Transkript (segment med start/end i sekunder, relativt DETTA klipps egen tidslinje):\n${JSON.stringify(transcript)}`
        : 'Inget transkript för det här klippet (troligen för stor fil för Whisper, eller tyst ljud) — basera segment från det här klippet på prompten istället.'
    return `Klipp "${id}" (uppladdningsordning ${i + 1} av ${clips.length}):\n${transcriptText}`
  })
  return `Uppladdade klipp:\n\n${blocks.join('\n\n')}`
}

function buildTrendBlock(trendContext: unknown) {
  if (!Array.isArray(trendContext) || trendContext.length === 0) {
    return null
  }
  return `Dagens trenddata (hashtags/ljud):\n${JSON.stringify(trendContext)}`
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = {
  path: '/api/generate-plan',
}
