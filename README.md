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

- **Idébank** – fungerande: trenddata (hashtags/ljud/kategori) läggs in manuellt på två sätt — antingen ett fält i taget, eller genom att klistra in en hashtag-lista (t.ex. kopierad direkt från TikTok Creative Centers webbgränssnitt) som tolkas till klickbara kandidater du väljer bland innan de sparas i bulk. Visas sedan ett kort i taget — "Hoppa över" eller "Bygg vidare" (skickar dig till Klippstudio med prompt/kategori förifyllda utifrån trenden). Automatisk skrapning/API-hämtning av trenddata byggs inte — TikTok har ingen öppen API för det (Research API är akademisk/icke-kommersiell, Creative Center har ingen offentlig API), så tredjepartsskrapning skulle innebära löpande kostnad och osäker ToS-status. Klistra-in-flödet är den medvetna kompromissen: du hittar trenden själv på riktiga TikTok/Creative Center, appen sköter bara tolkning och urval.
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

**Hashtag-förslag:** Claude returnerar även `suggested_hashtags` (3-5 st, utan "#"-tecken) i
samma svar som segmentplan/hook-alternativ/nyckelfraser. Visas i Klippstudio och sparas på
`clips.hashtags` (migration `0006_hashtags.sql`) när klippet sparas — syns även i Bibliotek.

## Whisper-integration (steg 5)

`netlify/edge-functions/transcribe.ts` tar emot en uppladdad video-/ljudfil och returnerar
tidsstämplade segment. Nyckeln `WHISPER_API_KEY` (en OpenAI API-nyckel) exponeras aldrig i
klienten. Transkriptet skickas vidare som `transcript` till `/api/generate-plan` så
klippningsplanen kan baseras på faktiskt videoinnehåll, inte bara prompten.

**Filstorlek:** Whisper har en hård 25 MB-gräns per fil, satt av OpenAI — går inte att höja.
Uppladdning/rendering (Shotstack) har ingen sådan gräns. Klippstudio skiljer därför på de
två: filer över 25 MB laddas upp för rendering som vanligt, men hoppar över transkriberingen
(klippningsplanen baseras då bara på prompten) istället för att blocka hela flödet. Egen
gräns i klienten för själva uppladdningen: 200 MB (`UPLOAD_MAX_FILE_BYTES` i
`Klippstudio.jsx`) — bara en förnuftig spärr, inte en teknisk gräns. Supabase Storage har
ett eget projektinställt max-filstorlekstak (Storage → Settings i Supabase-dashboarden) som
också kan behöva höjas om stora uppladdningar ändå fastnar.

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
(klipper/sekvenserar källvideon enligt Claudes plan), bränner in korta textöverlägg
(nyckelfraser från `suggested_subtitles`, med en halvgenomskinlig bakgrundsruta för
läsbarhet), och visar vald hook-text i början på samma sätt. `netlify/edge-functions/render-status.ts` pollas tills renderingen är klar.

**Effekter och övergångar:** varje segment cyklar igenom en lista effekter (`zoomInFast`,
`zoomOutFast`, `slideLeftFast`, `slideRightFast`, `slideUpFast`, `slideDownFast`) och
övergångar (`fadeFast`, `wipeLeft`, `wipeRight`, `slideLeft`, `slideRight`) — bara "Fast"-
varianterna används, de långsamma presetsen (`zoomIn`/`zoomOut`/`slideLeft`/`slideRight` utan
suffix) märktes knappt i ett kort TikTok-klipp. Ger en tydligt "klippt", redigerad känsla. Om
B-roll genererats (se nedan) klipps det in som ett eget segment direkt efter det första
huvudklippet (ett "cutaway"-snitt), inte bara som en fristående fil vid sidan av.

**Total videolängd:** Klippstudio har en valfri väljare ("Ingen preferens", 15/30/60/90
sekunder) som skickas som `targetDurationSeconds` till `/api/generate-plan`. Claude instrueras
att anpassa antal segment och deras start/end-tider så att summan av segmentens längder hamnar
nära det valda målet, istället för att alltid föreslå en fast längd. Rent förslag från Claude —
`render-clip.ts` klipper fortfarande bara utifrån de faktiska tiderna i `segments_plan`, så
den slutgiltiga längden kan avvika något om Claude missbedömer.

**Manuellt effektval per segment:** automatiken (ovan) är fortfarande default, men varje
segment i Klippstudios segmentplan har nu en dropdown (`SEGMENT_EFFECT_OPTIONS` i
`src/constants.js`) där du kan tvinga fram en specifik effekt istället — "Automatiskt" (tomt
värde) faller tillbaka till den cyklande listan. Valet skickas som `segmentEffects` (array,
samma index som `segments_plan`) till `/api/render-clip`, som använder det manuella värdet när
det finns, annars automatiken precis som innan.

`SHOTSTACK_ENV` styr miljö: `stage` (default) är Shotstacks gratis sandbox och
vattenstämplar videon — bra för att testa flödet. Sätt `SHOTSTACK_ENV=v1` i Netlify med en
produktionsnyckel för skarpa renderingar.

Shotstacks `title`-asset (som används för alla textöverlägg) är enligt Shotstacks egen
dokumentation markerad som föråldrad till förmån för ett nyare `rich-text`/`rich-caption`-API
med bättre automatisk radbrytning och ord-för-ord-highlighting — inte migrerat hit än
eftersom det inte gick att verifiera det nya schemat mot Shotstacks dokumentationssajt från
den här miljön (nätverksbegränsningar). `title` fungerar fortfarande och är inte borttaget,
men värt att byta till om Shotstack någon gång fasar ut det helt.

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

## Att göra: Remotion som växlingsbart renderingsalternativ (pausat, påbörjat)

Uppdaterad spec vill kunna växla rendering mellan Shotstack (nuvarande, fungerar) och
Remotion (self-hosted, billigare per rendering) via en miljövariabel `RENDER_PROVIDER=shotstack|remotion`,
bakom samma `/api/render-clip` + `/api/render-status`-gränssnitt så klienten inte behöver
bry sig om vilken som är aktiv. Pausat på användarens begäran innan implementationen — så
här ser planen och det som redan verifierats ut:

**Varför det inte kan köras i en Netlify Edge Function:** Remotion renderar via
`@remotion/renderer`, som kräver riktig Node.js + headless Chromium + ffmpeg och tar
betydligt längre tid än en Edge Functions körgräns tillåter. Måste köras som en egen
server-process — t.ex. samma Render.com-tjänst som redan används för YrkesAPL, eller
Remotion Lambda (AWS).

**Redan verifierat i den här sessionen** (testat i en tillfällig scratch-mapp, inte incheckat):
- `@remotion/renderer` + `@remotion/bundler` fungerar med `renderMedia()`/`selectComposition()`.
- Viktig gotcha: option-namnet är `browserExecutable` (top-level), INTE `chromiumOptions.executable`
  — fel namn ger ett förvirrande 403-fel där Remotion försöker ladda ner en egen Chromium
  istället för att använda den angivna.
- En annan gotcha: peka på `headless_shell`-binären, inte huvud-`chrome`-binären — vanlig
  Chrome har tagit bort gamla headless-läget som Remotion behöver
  ("Old Headless mode has been removed..."). På en server med egen Chromium-installation
  (t.ex. via `npx remotion browser ensure` eller `@remotion/renderer`s inbyggda nedladdning,
  som funkar på en riktig server med nätverksåtkomst dit) löser sig detta automatiskt —
  gotchan gällde bara den här sandboxade miljöns nätverksbegränsningar.
- Test-rendering (enkel textkomposition, 1080×1920, 60 frames @ 30fps) gav en giltig mp4.

**Kvarstående arbete:**
1. Ny mapp `remotion/` i repot: en komposition (`ClipVideo.tsx` e.dyl.) som återskapar
   samma logik som `render-clip.ts` gör mot Shotstack idag — sekvensera segment med
   trim/zoom-effekter, textöverlägg med bakgrundsruta för captions, hook-text i början,
   B-roll inklippt efter första segmentet.
2. En liten render-server (Express e.dyl.) i samma mapp: `POST /render` (startar jobb,
   returnerar id), `GET /render/:id` (status + URL till resultatet, uppladdat till
   Supabase Storage). Samma kontrakt som Shotstacks submit/poll-mönster.
3. `render.yaml` eller `Dockerfile` för deploy till Render.com (Chromium/ffmpeg-beroenden
   kräver troligen en Docker-baserad tjänst, inte standard Node-runtime).
4. Uppdatera `netlify/edge-functions/render-clip.ts` och `render-status.ts`: läs
   `RENDER_PROVIDER` — `remotion` vidarebefordrar till `REMOTION_SERVICE_URL` (den nya
   Render.com-tjänsten), annars nuvarande Shotstack-beteende. Klientkoden
   (`src/lib/shotstackClient.js`) ska inte behöva ändras alls.
5. Miljövariabler att lägga till: `RENDER_PROVIDER`, `REMOTION_SERVICE_URL`, troligen en
   delad hemlighet (`REMOTION_SERVICE_API_KEY` e.dyl.) så inte vem som helst kan trigga
   renderingar på Render.com-tjänsten.

Säg till när det här ska plockas upp igen.
