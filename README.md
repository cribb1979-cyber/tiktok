# Klippapp

Webbapp (React + Vite) för att skapa, publicera och analysera korta videoklipp (TikTok-format). Byggs stegvis enligt projektspecen — **alla 10 steg i byggordningen är klara**: projekt-scaffold, datamodell i Supabase, Bibliotek-vyn, Claude API-koppling, Whisper-transkribering, Shotstack-rendering, Idébank med trenddata, TikTok-koppling som mock, few-shot-kontext, och pgvector-retrieval. Plus ett valfritt tillval utöver planen: AI-genererad B-roll (se nedan).

## Kom igång

```bash
npm install
cp .env.example .env   # fyll i VITE_SUPABASE_URL och VITE_SUPABASE_ANON_KEY
npm run dev
```

`npm run dev` kör bara Vite (klienten). Klippstudions AI-anrop går till `/api/generate-plan`,
`/api/transcribe`, `/api/render-clip` och `/api/render-status` — fyra Netlify Edge Functions.
För att testa dem lokalt behövs [Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
npm install -g netlify-cli
netlify dev
```

`netlify dev` läser miljövariablerna (`CLAUDE_API_KEY`, `WHISPER_API_KEY`,
`SHOTSTACK_API_KEY`, `SHOTSTACK_ENV`) från `.env` (lokalt) eller Netlifys site-inställningar
(i produktion) — lägg aldrig till dem i `.env.example` med riktiga värden.

## Supabase-setup

1. Skapa ett Supabase-projekt (eller peka mot ett befintligt).
2. Kör migrationerna i `supabase/migrations/` i ordning (SQL Editor eller `supabase db push`):
   - `0001_init_schema.sql` — skapar tabellerna `clips` och `trend_snapshots`
   - `0002_storage_bucket.sql` — skapar en publik storage-bucket `raw-clips` för uppladdat råmaterial (Shotstack behöver en URL till videon, inte råa bytes)
   - `0003_pgvector_retrieval.sql` — aktiverar `pgvector`, lägger till `embedding vector(1536)` på `clips`, och skapar `match_clips`-funktionen för semantisk sökning
   - `0004_broll.sql` — lägger till `broll_enabled`, `broll_prompt`, `broll_video_url` och `ai_generated_content` på `clips` (valfritt B-roll-tillval, se nedan)

   Alla är idempotenta och ofarliga att köra mot ett projekt som redan har annat innehåll.
3. Kopiera projektets URL och anon-nyckel till `.env`.

## Sidor

- **Idébank** – fungerande: manuellt inklistrad trenddata (hashtags/ljud/kategori) visas ett kort i taget — "Hoppa över" eller "Bygg vidare" (skickar dig till Klippstudio med prompt/kategori förifyllda utifrån trenden). Riktig skrapning av trenddata (TikTok Creative Center e.dyl.) kopplas på senare.
- **Klippstudio** – fungerande: ladda upp råmaterial (video/ljud, valfritt) för tidsstämplad transkribering, skriv prompt + kategori/underämne → Claude föreslår klippningsplan och 2-3 hook-alternativ. Om råmaterial laddats upp kan klippet renderas (undertexter inbrända från transkriptet, zoom-effekt per segment, hook-text som textöverlägg) via Shotstack, med förhandsgranskning innan det sparas som utkast i Bibliotek.
- **Bibliotek** – fungerande: lista, lägg till och ta bort klipp manuellt, sortera på bäst presterande, filtrera på kategori. Utkast kan "Publiceras (mock)" och publicerade klipp kan få simulerade resultat via "Uppdatera resultat (mock)".
- **Kalender** – platshållare
- **Inställningar** – fungerande: TikTok-koppling (mock, se nedan). API-nycklar hanteras i Netlify, inte här.

## Claude API-integration (steg 4)

`netlify/edge-functions/generate-plan.ts` anropar Claude API server-side (nyckeln
`CLAUDE_API_KEY` exponeras aldrig i klienten). Svaret tvingas fram strukturerat via
`output_config.format` (JSON-schema) istället för att be modellen "svara med ren JSON-text" —
garanterat parseable, inget beroende av att modellen undviker markdown-kodblock.

Anropsformatet innehåller ett `previousBestClips`-fält för few-shot-kontext (tidigare bäst
presterande klipp i samma kategori) — fyllt sedan steg 9 (se nedan), tom lista dessförinnan.

## Whisper-integration (steg 5)

`netlify/edge-functions/transcribe.ts` tar emot en uppladdad video-/ljudfil (max 25 MB, samma
gräns som OpenAIs whisper-1-endpoint) och returnerar tidsstämplade segment. Nyckeln
`WHISPER_API_KEY` (en OpenAI API-nyckel) exponeras aldrig i klienten. Transkriptet skickas
vidare som `transcript` till `/api/generate-plan` så klippningsplanen kan baseras på faktiskt
videoinnehåll, inte bara prompten.

**.mov (iPhone/iPad):** Whisper accepterar inte .mov, och Safari på iOS saknar stöd för att
konvertera videon i webbläsaren (varken `decodeAudioData` för videocontainrar eller
`captureStream` fungerar där). För `.mov`-filer laddas videon istället upp till Supabase
Storage först (samma bucket som används för rendering), och `/api/transcribe` konverterar den
server-side via Shotstack (en enkel passthrough-rendering till mp4) innan den skickas till
Whisper. Detta kostar en liten extra Shotstack-rendering och några extra sekunders väntetid
för just .mov-uppladdningar.

## Shotstack-integration (steg 6)

Vid uppladdning sparas råmaterialet även i Supabase Storage-bucketen `raw-clips` (publik URL,
via `src/lib/storage.js`) — Shotstack är en extern tjänst som hämtar källvideon via URL, den
kan inte ta emot råa bytes direkt.

`netlify/edge-functions/render-clip.ts` bygger en Shotstack-"edit" utifrån `segments_plan`
(klipper/sekvenserar källvideon enligt Claudes plan), bränner in undertexter (från
transkriptets text inom respektive segments tidsspann, annars segmentets `description` som
fallback), lägger på en zoom-effekt per segment, och visar vald hook-text som textöverlägg i
början. `netlify/edge-functions/render-status.ts` pollas tills renderingen är klar.

`SHOTSTACK_ENV` styr miljö: `stage` (default) är Shotstacks gratis sandbox och
vattenstämplar videon — bra för att testa flödet. Sätt `SHOTSTACK_ENV=v1` i Netlify med en
produktionsnyckel för skarpa renderingar.

## TikTok-koppling (steg 8, mock)

`src/lib/tiktokAdapter.js` är ett adapter-lager: `connectAccount`, `disconnectAccount`,
`publishClip`, `schedulePost`, `fetchStats`. Bara mock-implementationen finns hittills —
"ansluten" state sparas i `localStorage`, publicering skriver ett fejkat `tiktok_post_id` +
`status: 'posted'` till klippet i Supabase, och "resultat" är slumpade siffror. Inställningar
har en "Anslut TikTok (mock)"-knapp, Bibliotek har "Publicera (mock)" (utkast) och
"Uppdatera resultat (mock)" (publicerade klipp).

Kräver ett godkänt TikTok Developer-konto + appgranskning för att bli skarpt (Content Posting
API för publicering, Display API för resultat, OAuth för kopplingen) — byt då bara ut
`tiktokAdapter`-exporten mot en riktig implementation med samma metodnamn, ingen annan kod
behöver ändras.

## Few-shot-kontext (steg 9)

`src/lib/clipHistory.js` hämtar de tre bäst presterande *publicerade* klippen (`status:
'posted'`, sorterat på `views_24h`) i samma kategori som valts i Klippstudio, och skickar dem
som `previousBestClips` till `/api/generate-plan`. Icke-kritiskt — om inga publicerade klipp
finns än (eller frågan failar) genereras planen ändå, bara utan few-shot-exempel. En liten
notis i Klippstudio visar hur många tidigare klipp som användes.

Detta är enkel filtrering/sortering, inte semantisk sökning — se steg 10 nedan för det.

## Retrieval via pgvector (steg 10)

`netlify/edge-functions/embed-text.ts` genererar embeddings (OpenAI `text-embedding-3-small`,
1536 dimensioner — samma `WHISPER_API_KEY` som Whisper, Anthropic har inget eget
embeddings-API). Varje klipp som sparas (Klippstudio eller Bibliotek) får automatiskt en
embedding sparad på `embedding`-kolumnen, icke-blockerande.

`fetchSimilarPreviousClips` i `src/lib/clipHistory.js` räknar hur många publicerade klipp som
har en embedding. Färre än 20 (spec: ">20-30 rader" innan retrieval ger nytta) → faller
tillbaka på steg 9:s enkla kategorisortering. Annars: embeddar den aktuella prompten och
anropar Postgres-funktionen `match_clips` (cosine similarity, `<=>`-operatorn) för att hitta
de tre semantiskt mest liknande tidigare klippen i samma kategori — oavsett hur populär
kategorin råkar vara, bara hur *likt just den här idén* de är.

Ett `ivfflat`-index för snabbare sökning är medvetet inte med i migrationen (ger varken nytta
eller pålitlig kvalitet på ett nästan tomt bord) — kör separat när det finns tillräckligt med
embeddade rader:

```sql
create index clips_embedding_idx on clips
using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

## AI-genererad B-roll (valfritt tillval, opt-in)

Utöver de 10 planerade byggstegen: ett kryssruta i Klippstudio ("AI-genererad B-roll,
valfritt") låter dig lägga till en kort atmosfärisk bakgrundsvideo (natur, ljus, stämning)
via [Runway](https://runwayml.com)s API — **aldrig av**, eller ens som ersättning för,
Christoffer själv i bild. Kontots trovärdighet bygger på att det faktiskt är honom, så
B-roll är bara stämningshöjande extra material, aldrig standard, alltid ett aktivt val per
klipp.

**Flöde:** `netlify/edge-functions/generate-broll.ts` ber Claude formulera en kort, filmisk,
uttryckligen person-fri visuell prompt utifrån klippets kategori/underämne/hook, skickar den
till Runways `text_to_video`-endpoint, och `broll-status.ts` pollas tills videon är klar.
Runways samma endpoint ger även tillgång till Googles Veo-modeller (styr med
`RUNWAY_MODEL=veo3.1` i Netlify) — Kling (ett annat vanligt nämnt alternativ) är ett separat
bolag utan gemensam endpoint och skulle behöva en egen adapter efter samma mönster som
`tiktokAdapter.js` om det blir aktuellt.

**TikTok-taggning:** `ai_generated_content` sätts automatiskt till `true` när B-roll används
(aldrig manuellt valbart av användaren) — Bibliotek visar en tydlig "AI-genererat
innehåll"-badge på sådana klipp. Kom ihåg när TikTok-kopplingen blir skarp: TikToks regler
kräver att den här flaggan skickas med i själva Content Posting API-anropet, inte bara sparas
i vår databas — se kommentaren i `tiktokAdapter.js`s `publishClip`.

**Miljövariabler:** `RUNWAY_API_KEY` (krävs för att funktionen ska gå att använda —
kryssrutan finns kvar även utan nyckel, men genereringen felar tydligt tills den är satt) och
valfri `RUNWAY_MODEL` (default `gen4.5`).

**Viktigt att veta:** Runways exakta API-fältnamn ovan är byggda utifrån deras publika
dokumentation (kunde inte verifieras direkt mot ett Runway-konto i den här miljön pga
nätverksbegränsningar) — precis som Shotstack-integrationen ursprungligen behövde justeras
efter första skarpa testet, räkna med att samma kan gälla här första gången du kör det mot
ett riktigt Runway-konto.
