# Klippapp

Webbapp (React + Vite) för att skapa, publicera och analysera korta videoklipp (TikTok-format). Byggs stegvis enligt projektspecen — nu klart t.o.m. **steg 6**: projekt-scaffold, datamodell i Supabase, Bibliotek-vyn, Claude API-koppling, Whisper-transkribering, och Shotstack-rendering.

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

   Båda är idempotenta och ofarliga att köra mot ett projekt som redan har annat innehåll.
3. Kopiera projektets URL och anon-nyckel till `.env`.

`pgvector`-extensionen och embedding-kolumnen på `clips` läggs till i ett senare steg (retrieval av liknande klipp), enligt byggordningen.

## Sidor

- **Idébank** – platshållare, trenddata kopplas på senare
- **Klippstudio** – fungerande: ladda upp råmaterial (video/ljud, valfritt) för tidsstämplad transkribering, skriv prompt + kategori/underämne → Claude föreslår klippningsplan och 2-3 hook-alternativ. Om råmaterial laddats upp kan klippet renderas (undertexter inbrända från transkriptet, zoom-effekt per segment, hook-text som textöverlägg) via Shotstack, med förhandsgranskning innan det sparas som utkast i Bibliotek.
- **Bibliotek** – fungerande: lista, lägg till och ta bort klipp manuellt, sortera på bäst presterande, filtrera på kategori
- **Kalender** – platshållare
- **Inställningar** – platshållare, TikTok-koppling kopplas på senare

## Claude API-integration (steg 4)

`netlify/edge-functions/generate-plan.ts` anropar Claude API server-side (nyckeln
`CLAUDE_API_KEY` exponeras aldrig i klienten). Svaret tvingas fram strukturerat via
`output_config.format` (JSON-schema) istället för att be modellen "svara med ren JSON-text" —
garanterat parseable, inget beroende av att modellen undviker markdown-kodblock.

Anropsformatet innehåller redan nu ett `previousBestClips`-fält för few-shot-kontext
(tidigare bäst presterande klipp i samma kategori) — det skickas som tom lista tills manuell
historik (steg 9) och pgvector-retrieval (steg 10) kopplas på, så anropsformatet inte behöver
byggas om senare.

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

## Nästa steg

7. Idébank med trenddata
8. TikTok-koppling som stub/mock
9. Few-shot-kontext i Claude-anropen (fylla `previousBestClips` med riktig historik)
10. Retrieval via pgvector
