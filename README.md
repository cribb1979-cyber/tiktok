# Klippapp

Webbapp (React + Vite) för att skapa, publicera och analysera korta videoklipp (TikTok-format). Byggs stegvis enligt projektspecen — nu klart t.o.m. **steg 5**: projekt-scaffold, datamodell i Supabase, Bibliotek-vyn, Claude API-koppling för klippningsplan + hook-förslag, och Whisper-transkribering (rendering fortfarande stubbad).

## Kom igång

```bash
npm install
cp .env.example .env   # fyll i VITE_SUPABASE_URL och VITE_SUPABASE_ANON_KEY
npm run dev
```

`npm run dev` kör bara Vite (klienten). Klippstudions AI-anrop går till `/api/generate-plan`
och `/api/transcribe`, två Netlify Edge Functions — för att testa dem lokalt behövs
[Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
npm install -g netlify-cli
netlify dev
```

`netlify dev` läser miljövariablerna `CLAUDE_API_KEY` och `WHISPER_API_KEY` från `.env`
(lokalt) eller Netlifys site-inställningar (i produktion) — lägg aldrig till dem i
`.env.example` med riktiga värden.

## Supabase-setup

1. Skapa ett Supabase-projekt (eller peka mot ett befintligt).
2. Kör migrationen i `supabase/migrations/0001_init_schema.sql` (SQL Editor eller `supabase db push`) för att skapa tabellerna `clips` och `trend_snapshots`. Migrationen använder `create table if not exists` och är ofarlig att köra mot ett projekt som redan har annat innehåll.
3. Kopiera projektets URL och anon-nyckel till `.env`.

`pgvector`-extensionen och embedding-kolumnen på `clips` läggs till i ett senare steg (retrieval av liknande klipp), enligt byggordningen.

## Sidor

- **Idébank** – platshållare, trenddata kopplas på senare
- **Klippstudio** – fungerande: ladda upp råmaterial (video/ljud, valfritt) för tidsstämplad transkribering, skriv prompt + kategori/underämne → Claude föreslår klippningsplan och 2-3 hook-alternativ baserat på både transkript och prompt, användaren väljer hook och sparar klippet som utkast i Bibliotek. Video-rendering är stubbad (ingen förhandsgranskning än).
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

## Nästa steg

6. Shotstack för rendering
7. Idébank med trenddata
8. TikTok-koppling som stub/mock
9. Few-shot-kontext i Claude-anropen (fylla `previousBestClips` med riktig historik)
10. Retrieval via pgvector
