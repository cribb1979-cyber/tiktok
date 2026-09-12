# Klippapp

Webbapp (React + Vite) för att skapa, publicera och analysera korta videoklipp (TikTok-format). Byggs stegvis enligt projektspecen — **alla 10 steg i byggordningen är klara**: projekt-scaffold, datamodell i Supabase, Bibliotek-vyn, Claude API-koppling, Whisper-transkribering, Shotstack-rendering, Idébank med trenddata, TikTok-koppling som mock, few-shot-kontext, och pgvector-retrieval. Plus ett valfritt tillval utöver planen: AI-genererad B-roll (se nedan).

## Kom igång

```bash
npm install
cp .env.example .env   # fyll i VITE_SUPABASE_URL och VITE_SUPABASE_ANON_KEY
npm run dev
```

`npm run dev` kör bara Vite (klienten). Klippstudions AI-anrop går till `/api/generate-plan`,
`/api/transcribe` (+ `/api/transcribe-convert` för .mov, se nedan), `/api/render-clip` och
`/api/render-status` — Netlify Edge Functions.
För att testa dem lokalt behövs [Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
npm install -g netlify-cli
netlify dev
```

`netlify dev` läser miljövariablerna (`CLAUDE_API_KEY`, `WHISPER_API_KEY`,
`SHOTSTACK_API_KEY`, `SHOTSTACK_ENV`) från `.env` (lokalt) eller Netlifys site-inställningar
(i produktion) — lägg aldrig till dem i `.env.example` med riktiga värden.

## Installerbar webbapp (PWA)

`index.html` länkar en `public/manifest.webmanifest` + ikonuppsättning
(`public/icon-192.png`/`icon-512.png`/`apple-touch-icon.png`/`favicon*`) — genererade från en
användartillhandahållen ikon (klappbräda + sax + TikTok-loggan). Öppna sajten i Safari på
iPhone/iPad → Dela → "Lägg till på hemskärmen" för en fullskärmsikon utan webbläsarramar,
matchar spec-kravet "enkelt att använda från iPad/iPhone i webbläsaren". iOS läser INTE
`manifest.webmanifest` för det här (bara Android/Chrome gör) — därför finns även
`apple-mobile-web-app-capable`/`apple-touch-icon`-metataggarna i `index.html`, som är det iOS
faktiskt använder.

Medvetet INGEN service worker/offline-cache — appen är helt beroende av Netlify Edge
Functions/Supabase/externa AI-API:er ändå (offline-stöd skulle inte göra den användbar utan
uppkoppling), och en cachead service worker på en app som redeployas ofta riskerar att visa
gamla versioner tills cachen går ut, vilket hade varit förvirrande under aktiv utveckling.

## Supabase-setup

1. Skapa ett Supabase-projekt (eller peka mot ett befintligt).
2. Kör migrationerna i `supabase/migrations/` i ordning (SQL Editor eller `supabase db push`):
   - `0001_init_schema.sql` — skapar tabellerna `clips` och `trend_snapshots`
   - `0002_storage_bucket.sql` — skapar en publik storage-bucket `raw-clips` för uppladdat råmaterial (Shotstack behöver en URL till videon, inte råa bytes)
   - `0003_pgvector_retrieval.sql` — aktiverar `pgvector`, lägger till `embedding vector(1536)` på `clips`, och skapar `match_clips`-funktionen för semantisk sökning
   - `0004_broll.sql` — lägger till `broll_enabled`, `broll_prompt`, `broll_video_url` och `ai_generated_content` på `clips` (valfritt B-roll-tillval, se nedan)
   - `0008_scripts.sql` — skapar tabellen `scripts` (manus + tolkade beats, se "Manus-läge" nedan)

   Alla är idempotenta och ofarliga att köra mot ett projekt som redan har annat innehåll.
3. Kopiera projektets URL och anon-nyckel till `.env`.

## Sidor

- **Idébank** – fungerande: trenddata (hashtags/ljud/kategori) läggs in manuellt på två sätt — antingen ett fält i taget, eller genom att klistra in en hashtag-lista (t.ex. kopierad direkt från TikTok Creative Centers webbgränssnitt) som tolkas till klickbara kandidater du väljer bland innan de sparas i bulk. Visas sedan ett kort i taget — "Hoppa över" eller "Bygg vidare" (skickar dig till Klippstudio med prompt/kategori förifyllda utifrån trenden). Automatisk skrapning/API-hämtning av trenddata byggs inte — TikTok har ingen öppen API för det (Research API är akademisk/icke-kommersiell, Creative Center har ingen offentlig API), så tredjepartsskrapning skulle innebära löpande kostnad och osäker ToS-status. Klistra-in-flödet är den medvetna kompromissen: du hittar trenden själv på riktiga TikTok/Creative Center, appen sköter bara tolkning och urval.
- **Klippstudio** – fungerande: ladda upp ett eller flera korta råklipp (video/ljud, valfritt — "Lägg till klipp" för fler, se "Flera klipp" nedan), ELLER skriv ett manus som blir en AI-avatar-video (se "Manus-läge" nedan) — båda vägarna landar i samma `clips`-lista. Skriv prompt + kategori/underämne → Claude föreslår en klippningsplan (som kan klippa ihop segment från flera olika klipp, oavsett om de är uppladdade eller AI-avatar-genererade) och 2-3 hook-alternativ. Om råmaterial finns kan klippet renderas (undertexter inbrända från transkriptet, zoom-effekt per segment, hook-text som textöverlägg) via Shotstack, med förhandsgranskning innan det sparas som utkast i Bibliotek. De valfria AI-tilläggen (B-roll, AI-effekt, bakgrundsbyte, tankebubblor, glow — se respektive avsnitt nedan) döljs bakom en hopfälld "Avancerat"-knapp under klippningsplanen (`advancedOpen`-state, default stängd) — infört efter att standardflödet blivit rörigt med fem separata korta synliga samtidigt. Allt finns kvar, bara ur vägen tills man aktivt öppnar sektionen.
- **Bibliotek** – fungerande: lista, lägg till och ta bort klipp manuellt, sortera på bäst presterande, filtrera på kategori. "Visa genererad text" expanderar kortet med sparade hook-alternativ och segmentplan i sin helhet, "Generera om" kör Claude-genereringen igen för klippets sparade prompt/kategori/underämne och skriver över hook-alternativ/segmentplan/hashtags med ett nytt förslag. Utkast kan "Publiceras (mock)" och publicerade klipp kan få simulerade resultat via "Uppdatera resultat (mock)".
- **Kalender** – platshållare
- **Tips & trix** – fungerande, statisk guide (`src/pages/Tips.jsx`, ingen AI/databas inblandad): för dig som filmar själv istället för Manus/AI-kortfilm — filmtips, vilka effekter som finns och vad de gör, hur du lägger till dem (under "Avancerat" i Klippstudio), i vilken ordning lagren läggs ovanpå varandra (praktiskt viktigt — en tankebubbla kan täcka undertexter om de hamnar på samma plats, se render-clip.ts's spårordning), och hur klippning/redigering (segment-trim, hastighet, "Redigera med vägledning") fungerar.
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

**Engagemangsstrategi (CTA):** systemprompten instruerar Claude att låta minst ett
hook-alternativ eller sista segmentets beskrivning avsluta med en öppen fråga till tittaren
("Skulle du testa detta?") snarare än ett rent påstående, när ämnet naturligt tillåter det —
TikToks algoritm belönar kommentarer/delningar mer än bara visningar. Övriga tips från samma
källa är kreatörens eget ansvar snarare än något Claude kan styra i en textgenerering: svara på
kommentarer med video, bra ljus/ljud (stå vid ett fönster), och ladda upp regelbundet
(3-5 ggr/vecka utspritt, inte allt på en gång).

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
Storage först (samma bucket som används för rendering), och konverteras server-side via
Shotstack (en enkel passthrough-rendering till mp4) innan den skickas till Whisper.

Detta sker i tre klientstyrda steg istället för ett enda serveranrop som gör allt:
1. `/api/transcribe-convert` submittar Shotstack-konverteringen och svarar direkt med ett
   render-id (submittar bara, väntar inte på att den blir klar).
2. Klienten (`transcribeFromUrl` i `whisperClient.js`) pollar `/api/render-status` (samma
   endpoint som videorenderingen redan pollar) var tredje sekund tills konverteringen är
   klar, upp till ~3 minuter.
3. `/api/transcribe` får den redan färdiga mp4-URL:en och skickar den vidare till Whisper.

Anledning: Netlify Edge Functions måste svara med headers inom 40 sekunder, annars dödar
plattformen funktionen mitt i anropet — och en Shotstack-konvertering kan själv ta längre än
så. Ett tidigare enda kombinerat anrop (submit+poll+hämta+transkribera i samma edge function)
riskerade därför att bli dödat av plattformen mitt under pollningen, vilket visade sig som att
klippet blev stående på "Bearbetar…" i Klippstudio för alltid — varken fel eller resultat kom
någonsin tillbaka till klienten, och hela uppladdnings-/genereringsflödet blev låst (filinput
och "Skapa klippningsplan" är avstängda medan något klipp fortfarande bearbetas). Uppdelningen
i tre korta anrop håller varje enskilt serveranrop väl under 40-sekundersgränsen. Klienten
sätter dessutom en egen 60-sekunders timeout (`AbortController`) på varje enskilt anrop som en
extra spärr, så ett hängande `fetch()` (som saknar egen timeout) aldrig kan låsa UI:t för
evigt — statustexten ("Konverterar video…" / "Transkriberar…") uppdateras löpande via en
`onStatus`-callback.

**Hallucinerade boilerplate-undertexter:** Whisper hittar ibland på fasta avslutningsfraser
("Thank you for watching", "시청해 주셔서 감사합니다", "Sous-titres réalisés par la
communauté d'Amara.org", m.fl. på flera språk) på tyst/nästan tyst ljud — ett känt
artefaktmönster från träningsdatan (YouTube-avslutningskort och undertext-communities).
`transcribe.ts` filtrerar bort segment som antingen matchar en känd fras, ELLER har hög
`no_speech_prob` (Whisper API:ts egen skattning av sannolikheten att segmentet är tyst), ELLER
innehåller CJK-skript (kinesiska/japanska/koreanska tecken) — de generiska signalerna fångar
även varianter/språk som inte finns i frastexten. CJK-filtret är strukturellt snarare än en
fraslista: @stoffe_medium är ett svenskt konto där legitimt CJK-tal i praktiken aldrig
förekommer, och Shotstacks textöverlägg använder Arial/Helvetica utan CJK-glyfer — sådan text
hade ändå bara blivit fyrkantiga "tofu"-placeholders i den brända-in undertexten (observerat i
en riktig rendering). Enstaka ord ur en filtrerad fras (t.ex. "SOUS") filtreras separat bort
ur ord-listan via tidsstämpel mot det hallucinerade segmentets tidsintervall (eftersom ett
enskilt ord inte matchar frasen), och CJK-ord filtreras dessutom direkt oavsett segmentgräns.

**Överlappande ord-för-ord-undertexter:** Whisper ger enstaka gånger lätt överlappande eller
icke-monotona tidsstämplar mellan ord i samma segment (särskilt nära gränser för filtrerade
segment) — utan åtgärd hann nästa ords bildtext börja innan föregåendes hunnit försvinna,
synligt som två sammanflätade texter i samma bildruta i en riktig rendering. `render-clip.ts`
sorterar nu segmentets ord i tidsordning och klämmer varje ords visningslängd så den aldrig
går förbi nästa ords starttid.

**Tillfälliga uppladdningsfel:** `uploadRawClip` (`src/lib/storage.js`) gör upp till två
återförsök med kort paus vid fel mot Supabase Storage, eftersom stora videouppladdningar från
mobil är känsliga för tillfälliga nätverks-/Cloudflare-hicka (observerat: "HTTP 520 error")
som normalt lyckas vid omförsök.

## Flera klipp: klippa ihop flera korta råklipp till ett (valfritt)

Klippstudio stödjer flera uppladdade råklipp istället för bara ett — "Lägg till klipp" kan
tryckas flera gånger, varje klipp laddas upp/transkriberas separat och visas som ett eget
kort (namn, status, "Ta bort"). Ett enda klipp fungerar precis som tidigare, bara som en
lista med ett element.

**Övergångar kräver INGEN ny logik** — `render-clip.ts` växlar redan effekt/övergång
(`fadeFast`/`wipeLeft`/`wipeRight`/`slideLeft`/`slideRight`) per segment; Shotstack bryr sig
inte om två på varandra följande segment kommer från samma eller olika källfiler, samma
mekanik gäller rakt av över klippgränser.

**Datamodell:** varje klipp får ett stabilt id (`c0`, `c1`, … — genererat klientsidigt,
oberoende av array-index som ändras vid borttagning). Claude (`generate-plan.ts` och
`revise-plan.ts`) får alla klipps transkript, och varje segment i `segments_plan` får ett
`clip_id` som pekar ut VILKET klipp segmentets start/end (alltid relativa till DET klippets
egen tidslinje, aldrig en gemensam) kommer från. Claude instrueras att använda klippen i
uppladdningsordning om inget annat gör mer narrativ mening, och behöver inte använda hela
eller ens alla klipp.

`render-clip.ts` tar emot `clips: [{id, url, transcript, words}]` istället för en enskild
`videoUrl`/`transcript`/`words` — för varje segment slås `clip_id` upp mot listan
(`resolveClip`, med fallback till första klippet om id:t saknas/inte hittas) för att avgöra
både videokällan (`asset.src`) OCH vilka ord-för-ord-tidsstämplar/transkriptrader som hör
till just det segmentets tidsintervall (dessa är per-klipp, inte globala — flera klipp har
annars överlappande egna 0:00-baserade tidslinjer).

**Tar bort ett klipp efter att en plan redan genererats:** planen nollställs och användaren
ombeds generera på nytt, istället för att riskera `clip_id`-referenser mot ett klipp som
inte längre finns (`handleRemoveClip` i `Klippstudio.jsx`).

**Avancerade tillval som är förankrade till "första segmentet"** (glow-förhandsvisningens
bildruta, bakgrundsbytets källvideo) använder `primaryClip` — det uppladdade klipp som
`segments_plan[0].clip_id` faktiskt pekar på (eller det först uppladdade, innan en plan
finns) — istället för ett fast, enda klipp. `captureGuidanceFrames` (Redigera med
vägledning) går längre och slår upp RÄTT klipp per segment individuellt, eftersom Claude kan
blanda segment från olika klipp i samma reviderade plan.

## Manus-läge (steg 7): dialog → AI-avatar-video (valfritt)

Ett tredje sätt att få ett klipp in i `clips`-listan, utöver att ladda upp råmaterial: skriv
ett manus (dialog blandat med regianvisningar i hakparenteser, t.ex. `[Lugn början – du
sitter stilla]`) i Klippstudio, och en AI-avatar-tjänst (HeyGen) genererar en talande video av
manuset. Byggt som huvudvägen enligt spec-dokumentet ("tidsbrist gör att filma själv sällan
är realistiskt") — det sekundära, valbara "Guidning/filma själv"-läget (teleprompter-vy) är
INTE byggt än, prioriterat bort till förmån för AI-avatar-vägen.

**Flöde:**
1. `netlify/edge-functions/parse-script.ts` (Claude) tolkar det fritt skrivna manuset till
   `parsed_beats`: `[{ line, direction, suggested_duration_seconds, pause_after_seconds }]` per
   rad — `line` är BARA den talbara dialogen (regianvisningar bortrensade), `direction`
   regianvisningen som hörde till raden, `pause_after_seconds` en uppskattad paus/tystnad
   (sekunder, 0 om ingen) om regianvisningen bad om det (t.ex. "[paus]", "[tystnad]", eller en
   explicit längd som "[3 sekunders tystnad]"). Visas i Klippstudio som en granskningslista
   innan man går vidare (videogenerering kostar riktiga pengar per sekund, värt att kunna
   se/ångra innan man trycker).
2. Klippstudio (`handleGenerateAvatarVideo`) slår ihop alla `parsed_beats[].line` till en
   sammanhängande text, och lägger in en `<break time="Xs"/>`-tagg efter varje rad som har
   `pause_after_seconds > 0` — HeyGens `input_text` stödjer den taggen (den ENDA taggen den
   stödjer, ingen full SSML-`<speak>`-inpackning, det ger enligt HeyGens dokumentation extra
   uppläst brus) för riktiga pauser i talet. Utan detta läste avataren tidigare upp replikerna
   rakt igenom utan att respektera tystnad markerad i manuset (rapporterad bugg — hela poängen
   med en regianvisning som "[tystnad]" gick förlorad). Kräver att den valda `HEYGEN_VOICE_ID`
   faktiskt stödjer pauser — kolla `support_pause`-fältet för din röst via
   `GET https://api.heygen.com/v2/voices` (se "Miljövariabler" nedan för hur du listar dem).
3. `netlify/edge-functions/generate-avatar-video.ts` tar emot den färdiga texten (med
   ev. `<break>`-taggar redan inbakade), plus ev. valda `avatarId`/`voiceId` från
   avatar-/röstväljaren (se "Avatar-/röstväljare" nedan — annars miljövariabel-standardvalet),
   och submittar det till HeyGens `v2/video/generate` — bara submit, svarar direkt (samma
   anledning som `.mov`-konverteringen ovan: videogenerering kan ta längre än Netlify Edge
   Functions 40-sekundersgräns för att svara med headers).
4. Klienten (`generateAvatarVideo` i `src/lib/heygenClient.js`) pollar
   `netlify/edge-functions/avatar-video-status.ts` (samma
   PENDING/RUNNING/SUCCEEDED/FAILED-kontrakt som B-roll/bakgrundsbild) tills videon är klar.
5. Den färdiga videon läggs till i `clips`-listan i Klippstudio.jsx precis som ett vanligt
   uppladdat klipp — samma `{ id, name, publicUrl, transcript, transcribing, ... }`-form,
   samma nedströms klippningsplan-/renderingsflöde återanvänds oförändrat. Transkriberas via
   `transcribeMp4Url` (`whisperClient.js`) — en ny, enklare variant av `transcribeFromUrl` som
   hoppar över Shotstack-konverteringssteget helt, eftersom HeyGen redan levererar ett
   Whisper-kompatibelt mp4 (konverteringen behövs bara för format Whisper inte tar direkt,
   som `.mov`).

**Leverantörsval (HeyGen, inte Synthesia/Arcads)** — research (WebSearch, 2026-09):
HeyGens API är rent pay-as-you-go per genererad sekund (från ca $1/min vid 1080p,
"Avatar III"-kvalitet) UTAN krav på något månadsabonnemang för API-åtkomst. Synthesia kräver
minst $89/månaden-planen för API-åtkomst överhuvudtaget (30 min/månad ingår, sen $2-5/min
extra). Arcads kräver en anpassad "Pro"-plan (ingen öppen prislista, kontakta säljteam) för
API-åtkomst — de lägre planerna (`$110`/`$220` per månad) har ingen API alls. HeyGen matchar
appens övriga mönster bäst: betala per faktisk användning (som Shotstack/Replicate), inget
fast månadsåtagande för en funktion som används oregelbundet.

**Miljövariabler:** `HEYGEN_API_KEY` (från HeyGens dashboard → API-nycklar), plus valfria
`HEYGEN_AVATAR_ID`/`HEYGEN_VOICE_ID` som ETT förvalt standardval.

**Avatar-/röstväljare:** Klippstudio hämtar (via `netlify/edge-functions/list-avatars.ts` och
`list-voices.ts` — rena proxyanrop mot HeyGens `/v2/avatars`/`/v2/voices`, nyckeln stannar
server-side) ditt HeyGen-kontos avatar-/röstbibliotek och visar dem som två dropdowns ovanför
manusfältet, en gång per sidladdning (bara metadata, kostar inget). Väljer du inget (eller om
listorna inte gick att hämta, t.ex. fel API-nyckel — visas då som en varning istället för att
blockera Manus-läget) faller `generate-avatar-video.ts` tillbaka på
`HEYGEN_AVATAR_ID`/`HEYGEN_VOICE_ID`-miljövariablerna.

Röstlistan filtreras i `list-voices.ts` till bara **svenska röster** plus ett urval på
**`ENGLISH_VOICE_LIMIT` (10) engelska röster** — @stoffe_medium är ett svenskt konto, och
HeyGens fulla bibliotek har hundratals röster över dussintals språk som annars gör dropdownen
oanvändbart lång. Visas grupperat (Svenska/Engelska) i UI:t. Röstlistan visar "— stödjer paus"
för röster där `support_pause` är sant (se pausfunktionen ovan) — välj en sådan om manuset
använder `[paus]`/`[tystnad]`.

**Bekräfta avatar/röst innan generering:** HeyGen kan döpa en klonad röst likadant som
avataren den klonades ifrån (observerat: en användares egen röst hette samma sak som deras
egen avatar, "The energy around us") — lätt att blanda ihop i en ren textlista, särskilt när
samma namn dyker upp i BÅDA dropdownarna. Istället för att ändra eller gissa på listorna visar
Klippstudio nu en förhandsgranskning av det just valda alternativet: avatarens förhandsbild
(`previewImageUrl` från `list-avatars.ts`) och ett spelbart ljudprov av rösten
(`previewAudioUrl` från `list-voices.ts`, HeyGens `preview_audio`-fält) — syns direkt under
väljarna så man kan se/höra att det verkligen är rätt innan man betalar för en generering.

**Korrigering (v3/Avatar IV istället för v2/video/generate):** ett skarpt test visade att en
egen "video-avatar" (skapad från en inspelad video) via HeyGens v2-endpoint alltid spelade upp
sin egen inbyggda röst oavsett vilket `voice_id` som skickades med — trots att ljudprovet i
förhandsgranskningen ovan bevisligen var rätt röst. Avgörande test: exakt samma avatar+röst-
kombination fungerade KORREKT i HeyGens eget webbgränssnitt, vilket bekräftade att det var
v2-anropet (inte en begränsning hos HeyGen som plattform) som var problemet — HeyGens nyare
"Avatar IV"-motor stödjer fritt röstval även för videoavatarer, men v2 gjorde uppenbarligen
inte det. `generate-avatar-video.ts` submittar nu via `POST https://api.heygen.com/v3/videos`
med `engine: { type: 'avatar_iv' }` istället, och `avatar-video-status.ts` pollar motsvarande
`GET /v3/videos/{id}` istället för den äldre `v1/video_status.get`. Fältnamnen (`script` istället
för `input_text`, `aspect_ratio` istället för `dimension`, den platta bodyn utan
`video_inputs`-array) är sammanställda från HeyGens dokumentation men INTE verifierade direkt
mot ett skarpt svar härifrån (nätverksbegränsningar) — justera enligt HeyGens eget
felmeddelande om något fältnamn visar sig fel vid nästa test, samma mönster som tidigare
Bria/Shotstack/Replicate-fältnamnsfixar i den här appen.

**Korrigering #2 (statuspollning fastnade):** bytet ovan flyttade OCKSÅ statuspollningen till
en gissad `GET /v3/videos/{id}`, med antagandet att v1-statusendpointen inte skulle känna igen
video-id:n skapade via v3. Fel antagande, bekräftat skarpt: videon blev klar och gick att se
direkt på HeyGens egen sajt, men appen fastnade ändå på "Genererar film…" (till slut ett
timeout-fel) — v3/videos/{id} svarade sannolikt inte i det format koden förväntade sig, aldrig
verifierat mot ett skarpt svar. `avatar-video-status.ts` pollar nu åter `GET
v1/video_status.get?video_id=...` (samma endpoint som innan v3-migreringen) — precis som
Replicates predictions-endpoint (se `broll-status.ts`) är den modelloberoende: samma video_id
fungerar oavsett om videon submittades via v1/v2/v3. Bara SUBMIT-anropet (`generate-avatar-
video.ts`) behövde bytas till v3 för röstfixen ovan, inte statuskollen.

**Datamodell:** `scripts`-tabellen (`0008_scripts.sql`) sparar `raw_text`/`parsed_beats` som
historik — `clip_id` sätts inte automatiskt idag (kopplas inte till det sparade klippet i
Bibliotek ännu), bara till för framtida bruk enligt spec-dokumentets datamodell.

## Shotstack-integration (steg 6)

Vid uppladdning sparas råmaterialet även i Supabase Storage-bucketen `raw-clips` (publik URL,
via `src/lib/storage.js`) — Shotstack är en extern tjänst som hämtar källvideon via URL, den
kan inte ta emot råa bytes direkt.

`netlify/edge-functions/render-clip.ts` bygger en Shotstack-"edit" utifrån `segments_plan`
(klipper/sekvenserar källvideon enligt Claudes plan), bränner in korta textöverlägg
(nyckelfraser från `suggested_subtitles`, med en halvgenomskinlig bakgrundsruta för
läsbarhet), och visar vald hook-text i början på samma sätt. `netlify/edge-functions/render-status.ts` pollas tills renderingen är klar.

**Textlängd:** `suggested_subtitles`/hook-text kortas av (`truncateForOverlay`,
`CAPTION_MAX_CHARS`/`HOOK_MAX_CHARS`) om de är längre än vad som får plats utan att gå utanför
bildkanten — kapas vid senaste ordgränsen inom gränsen, aldrig mitt i ett ord (t.ex. "Lugnet
ger…" inte "Lugnet ger energin plats att flö…"). `generate-plan.ts` instrueras dessutom att
hålla `suggested_subtitles` under ~30 tecken från början, så avkortning sällan triggas alls.

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

**Färgfilter per segment:** ytterligare en dropdown per segment (`SEGMENT_FILTER_OPTIONS`) —
boost/contrast/muted/darken/lighten/greyscale/negative, Shotstacks inbyggda clip-nivå
`filter`-fält. Standard är inget filter alls (till skillnad från effekter cyklas inget filter
automatiskt fram). Skickas som `segmentFilters` till `/api/render-clip`.

**Ord-för-ord-undertexter (CapCut/TikTok-stil):** `netlify/edge-functions/transcribe.ts`
begär numera även `timestamp_granularities[]=word` från Whisper, så varje ord i transkriptet
har sin egen start/end-tid. `render-clip.ts` bygger, när sådana tidsstämplar finns för ett
segment, ett kort `html`-klipp per ord (stort, fetstilat, ett ord i taget — synkat exakt mot
talet i videon) istället för det gamla statiska frasöverlägget. Faller tillbaka till det gamla
beteendet (nyckelfraser från `suggested_subtitles`, ett överlägg per segment) om inga
ordtidsstämplar finns för det segmentet — t.ex. när transkribering hoppades över (fil >25 MB).
Byggt med samma html-asset-mönster som Shotstacks eget "kinetic-text"-exempel (verifierat
schema) snarare än den nyare "Rich Captions"-asset-typen, vars exakta fältnamn inte gick att
verifiera mot Shotstacks dokumentationssajt härifrån (nätverksbegränsningar) — värt att byta
till om/när det schemat går att bekräfta, då den har inbyggt stöd för highlighting-animationer.

`SHOTSTACK_ENV` styr miljö: `stage` (default) är Shotstacks gratis sandbox och
vattenstämplar videon — bra för att testa flödet. Sätt `SHOTSTACK_ENV=v1` i Netlify med en
produktionsnyckel för skarpa renderingar (inget vattenmärke). **Om videorna fortfarande känns
lågupplösta/suddiga trots det** — kontrollera att detta faktiskt är satt i Netlifys
miljövariabler, annars renderas allt i sandboxläge.

**Bildkvalitet:** `output.quality` sätts till `"high"` (Shotstacks eget fält, default är
annars `"medium"` — optimerat för liten filstorlek, inte skärpa). `"high"` är i princip
visuellt lossless. TikTok komprimerar videon igen själva vid uppladdning oavsett, så det är
bättre att leverera med så hög kvalitet som möjligt in i det steget.

**Snabb förhandsgranskning (gratis):** en knapp i Klippstudio ("Snabb förhandsgranskning")
skickar EXAKT samma redigering (`buildRenderParams()` i `Klippstudio.jsx`, återanvänds av
både förhandsgranskningen och den skarpa renderingen — inga separata kodvägar att hålla i
synk) men med `preview: true`, vilket TVINGAR Shotstacks sandbox-host oavsett `SHOTSTACK_ENV`
(se `resolveShotstackHost` i `render-clip.ts`/`render-status.ts`). Sandbox-renderingar
kostar inga krediter alls (kräver bara att kontot har minst 1 kredit för att räknas som
aktivt) och ger en riktig video (512×288@15fps, vattenstämplad) på några sekunder — byggd av
EXAKT samma motor/JSON som den skarpa renderingen, så resultatet är garanterat verklighets-
troget (inte en client-side-gissning). Sparas ALDRIG till Bibliotek, rent engångsbruk för att
se resultatet (hook, undertexter, effekter, glow, allt) innan man committar till den betalda
slutrenderingen. `render-status.ts` måste pollas med samma `?preview=true` som renderingen
submittades med, annars letar den i fel Shotstack-miljö efter jobbet.

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
via [Replicate](https://replicate.com)s API (modellen Wan 2.1, öppen källkod) — aldrig standard,
alltid ett aktivt val per klipp.

**Person-skydd, två lägen:** default är B-roll helt person-fri (ingen människa alls i bild,
Christoffer själv ersätts eller föreställs aldrig — kontots trovärdighet bygger på att det
faktiskt är honom). Ett andra kryssruta, "Illustrera min berättelse", tillåter generiska/
anonyma mänskliga figurer som illustration av en berättelse (t.ex. "en siluett vid ett bord")
— men får ALDRIG föreställa en specifik verklig identifierbar person, varken kontoinnehavaren
eller namngivna anhöriga. Två separata systemprompter till Claude (`PROMPT_SYSTEM_PERSON_FREE`
/ `PROMPT_SYSTEM_ILLUSTRATIVE` i `generate-broll.ts`) plus olika `negative_prompt` till
Replicate beroende på läge. Uttryckligt opt-in per klipp, inget default-beteende ändrat.

**Leverantör:** byggdes ursprungligen mot Runway, bytt 2026-09 till Replicate/Wan 2.1 — samma
sorts video-AI men betydligt billigare (~$0.05-0.09 per klipp mot Runways väsentligt högre
pris), öppen källkod. `src/lib/replicateClient.js` (döpt om från `runwayClient.js`) har samma
funktionssignatur (`generateBroll`) så resten av koden (Klippstudio.jsx) inte behövde ändras.

**Flöde:** `netlify/edge-functions/generate-broll.ts` ber Claude formulera en kort, filmisk,
visuell prompt utifrån klippets kategori/underämne/hook — och valfritt en egen idé du skriver
själv i Klippstudio (`customPrompt`, t.ex. "regn mot ett fönster, neonljus i vattenpölar").
Din text går fortfarande via Claude istället för direkt till videomodellen, så person-skyddet
gäller även då. Prompten skickas sedan till Replicates `models/{model}/predictions`-endpoint.
`broll-status.ts` pollas (Replicates statusvärden starting/processing/succeeded/failed
normaliseras internt till samma PENDING/RUNNING/SUCCEEDED/FAILED-kontrakt som tidigare, så
klientkoden är oförändrad) tills videon är klar.

**Förhandsgranska/redigera prompten (valfritt mellansteg):** "Förfina prompt"-knappen i
Klippstudio anropar `/api/generate-broll` med `refineOnly: true` — kör bara Claude-steget och
returnerar den engelska, filmiska prompten utan att starta någon (betald) Replicate-
generering. Resultatet visas i ett redigerbart textfält; när du sedan trycker "Generera
B-roll" skickas texten med som `refinedPrompt`, vilket hoppar över Claude-steget helt och går
direkt till Replicate med exakt den text du sett/redigerat. Tömmer du fältet innan du
genererar körs Claude-steget igen som vanligt (från `customPrompt`/kategori/hook).

**Modell/leverantör (uppdaterad 2026-09-10):** default är `wan-video/wan-2.1-1.3b` (mindre
1.3B-modell, körs direkt via Replicate). Ursprungligen `wavespeedai/wan-2.1-t2v-720p` (14B,
bättre kvalitet) — men den leverantören (WaveSpeedAI) hade driftstopp: samma fel (`(E002)`,
`helpers.exceptions.prediction.ModelError`) reproducerades i Replicates egen Playground med
enkel standardprompt, dvs. bekräftat inte ett fel i vår kod. De två modellerna har OLIKA
input-scheman (verifierat mot respektive Schema-sida på replicate.com):
- `wavespeedai/wan-2.1-t2v-720p`: `prompt`, `negative_prompt`, `aspect_ratio`, `fast_mode` m.fl.
- `wan-video/wan-2.1-1.3b`: `prompt`, `aspect_ratio`, `seed`, `frame_num`, `resolution`,
  `sample_shift`, `sample_steps`, `sample_guide_scale` — inget `negative_prompt`/`fast_mode`.

`generate-broll.ts` skickar bara `negative_prompt`/`fast_mode` när `REPLICATE_MODEL` pekar på
en `wavespeedai/`-modell (se `isWaveSpeedModel`), annars bara `prompt`/`aspect_ratio` — annars
ger Replicate ett valideringsfel för okända fält. **Viktigt:** person-skyddet vilar i båda
lägen på Claude-instruktionen (`PROMPT_SYSTEM_PERSON_FREE`/`PROMPT_SYSTEM_ILLUSTRATIVE`) —
`negative_prompt` är bara ett extra skyddsnät som finns på wavespeedai-modellen, inte på
default-modellen. Byt tillbaka via `REPLICATE_MODEL=wavespeedai/wan-2.1-t2v-720p` om
WaveSpeedAI-driftstoppet löser sig och du vill ha 14B-kvaliteten igen.

**Person-skydd, två lägen:** default är B-roll helt person-fri. Ett kryssruta i Klippstudio,
"Illustrera min berättelse", tillåter generiska/anonyma mänskliga figurer som illustration av
en berättelse (t.ex. "en siluett vid ett bord") — men får ALDRIG föreställa en specifik
verklig identifierbar person, varken kontoinnehavaren eller namngivna anhöriga. Uttryckligt
opt-in per klipp, inget default-beteende ändrat.

**TikTok-taggning:** `ai_generated_content` sätts automatiskt till `true` när B-roll används
(aldrig manuellt valbart av användaren) — Bibliotek visar en tydlig "AI-genererat
innehåll"-badge på sådana klipp. Kom ihåg när TikTok-kopplingen blir skarp: TikToks regler
kräver att den här flaggan skickas med i själva Content Posting API-anropet, inte bara sparas
i vår databas — se kommentaren i `tiktokAdapter.js`s `publishClip`.

**Miljövariabler:** `REPLICATE_API_TOKEN` (krävs för att funktionen ska gå att använda —
kryssrutan finns kvar även utan nyckel, men genereringen felar tydligt tills den är satt) och
valfri `REPLICATE_MODEL` (default `wan-video/wan-2.1-1.3b`).

## AI-kortfilm: en hel berättelse över flera scener (valfritt tillval, opt-in)

Ett steg upp från B-roll (som bara är korta, person-fria atmosfärklipp): en fri idé (t.ex.
"två personer hittar ett ödehus, kliver in, dörren stängs och märkliga saker händer") blir en
hel liten film med SAMMA återkommande karaktärer genom flera scener. Bygger på Runway
Gen-4 Image/Turbo via Replicate (samma leverantör/nyckel som B-roll) — vald efter research
(WebSearch, 2026-09) av Kling/Veo/Runway: Gen-4s referensbild-baserade karaktärskonsistens
(en bild, ingen träning) matchar behovet bäst, och `runwayml/gen4-turbo` kostar ~$0,05/sekund
genererad video, billigast av de tre. En ~45-sekunders film med 5-6 scener kostar ungefär
20-25 kr per försök, mer om enstaka scener behöver köras om.

**Flöde (fyra Netlify Edge Functions, alla Replicate-baserade steg pollas via BEFINTLIGA
`/api/broll-status` — Replicates predictions-endpoint är modelloberoende, samma id fungerar
oavsett vilken modell som skapade predictionen, så inga nya statusendpoints behövdes):**
1. `generate-shotlist.ts` (Claude): idén blir en karaktärslista (1-3 st, generiska/påhittade —
   se person-skyddet nedan) och en ordnad scenlista (4-8 scener, varje med en bildbeskrivning,
   en rörelsebeskrivning, längd 5 eller 10 sekunder, och vilka karaktärer som syns).
2. `generate-character-image.ts`: EN referensbild per karaktär, via **FLUX Schnell** (rent
   text-till-bild — se korrigeringen nedan för varför INTE Gen-4 Image här).
3. `generate-shot-image.ts`: en konsekvent bildruta per scen. Har scenen en karaktär: Runway
   Gen-4 Image med den FÖRSTA karaktärens referensbild i `image`-fältet (en känd begränsning —
   bara en karaktär hålls helt konsekvent per scen, se nedan). Har scenen ingen karaktär (ren
   miljö-/stämningsbild): FLUX Schnell.
4. `generate-shot-video.ts`: animerar scenens bildruta till en 5-10 sekunders videoklipp
   (Runway Gen-4 Turbo, bild-till-video).

Klippstudio (`handleGenerateFilm`) orkestrerar hela kedjan: karaktärsbilder genereras
parallellt (oberoende av varandra), sedan scen för scen i ordning (bildruta → video, eftersom
nästa scen inte beror på föregåendes video men resultaten läggs till i `clips`-listan i
berättelsens ordning). Varje färdig scens video blir ETT klipp i `clips`-listan — precis som
ett uppladdat klipp eller en Manus-genererad AI-avatar-video — så hela klippningsplan-/
renderingsflödet återanvänds oförändrat, ingen ny renderingskod.

**Person-skydd:** samma princip som B-rollens "Illustrera min berättelse"-läge — karaktärerna
MÅSTE vara påhittade/generiska (`generate-shotlist.ts`s systemprompt), aldrig kontoinnehavaren
eller en namngiven verklig person. `ai_generated_content` sätts automatiskt (`aiGenerated` på
klipp-objektet, samma flagga som Manus-lägets AI-avatar-klipp använder).

**Korrigering efter ett skarpt test (2026-09):** Replicates version av `runwayml/gen4-image`
kräver ett `image`-fält (en befintlig bild att utgå från) — den kan INTE generera en bild från
ren text, till skillnad från vad tredjepartsdokumentation antydde (`reference_images`/
`reference_tags` som array, ospecificerat antal). Detta gav ett tydligt 422-fel
("input: image is required") vid den allra första karaktärsbilden, där det ännu inte fanns
någon bild att referera till. Löst genom att byta karaktärsbild-generering till FLUX Schnell
(rent text-till-bild, redan verifierat och använt av `generate-background.ts`), och begränsa
Gen-4 Image till att bara ta EN referensbild (`image`, singular — inte flera samtidigt). Praktisk
konsekvens: en scen med två karaktärer håller bara DEN FÖRSTA helt visuellt konsekvent, den
andra beskrivs bara i text. `generate-shotlist.ts` instrueras att skriva scenerna med detta i
åtanke (ingen @tag-syntax i bildprompten längre — stöddes aldrig av det enkla `image`-fältet).

**Korrigering #2 (samma dag):** ett skarpt test av `generate-shot-video.ts` (Gen-4 Turbo,
bild-till-video) gav SAMMA typ av 422-fel ("input: image is required") som Gen-4 Image hade —
Replicates wrapper vill ha startbilden i ett fält som heter `image`, inte `prompt_image` (som
är Runways egen SDK:s fältnamn, `image_to_video.create`, vilket tredjepartsdokumentationen
utgick från). Bytt till `image`. `prompt`/`duration`/`ratio` är fortfarande inte bekräftade
mot ett skarpt svar — justera enligt Replicates felmeddelande om nästa test visar ett nytt
fältnamnsfel, samma mönster som ovan.

**Korrigering #3 (skarpt test):** en helt vardaglig karaktärsbeskrivning ("en kvinna i
medelåldern... lugn och samlad hållning") gav `AiError: NSFW content detected` från FLUX
Schnell — ett känt falskt-positivt-mönster hos den här modellfamiljens inbyggda
NSFW-klassificerare, troligen utlöst av frasen "Full body portrait" i
`generate-character-image.ts`s prompt-mall i kombination med en persons kroppsbeskrivning,
inte av något olämpligt i den faktiska texten. Löst genom att justera prompt-frasen till
"Editorial character reference photo, fully clothed, ..." istället för "Full body
portrait, ..." — medvetet INTE genom att stänga av modellens säkerhetsfiltrering
(`disable_safety_checker`), som hade varit en trubbigare/mer riskabel lösning för samma
symptom. OBS: kunde inte verifieras med ett nytt skarpt test i den här sessionen — dyker
samma fel upp igen med den nya frasen behöver frasen justeras ytterligare.

**Miljövariabler:** ingen ny — återanvänder `REPLICATE_API_TOKEN` och `CLAUDE_API_KEY` som
redan krävs för B-roll respektive klippningsplanen.

**Inte byggt:** dialog/tal för karaktärerna (Gen-4 Turbo genererar ingen röst) — filmen blir
tyst bild+rörelse, eventuell musik/ljud får läggas på separat om det behövs.

**Filma en scen själv istället för AI (valfritt, per scen):** varje scens `image_prompt`/
`motion_prompt` fungerar redan som en filminstruktion (miljö/komposition + rörelse/kamera) —
samma text som skickas till AI-modellerna. En dag du har tid att filma själv istället för att
betala för AI-generering: ladda upp din egen video för just den scenen i granskningslistan
(`filmShotOverrides`-state i Klippstudio.jsx) — den scenen hoppar då över hela
AI-genereringskedjan (bildruta + video) och din uppladdade fil används rakt av, medan övriga
scener i samma film fortsätter genereras med AI som vanligt. Karaktärer som bara förekommer i
självfilmade scener får ingen AI-referensbild alls (sparar pengar på scener som ändå inte
AI-genereras). `ai_generated_content`/`aiGenerated` sätts INTE för en självfilmad scen — det är
din egen video, inget att TikTok-tagga som AI-genererat.

## AI-effekt: paranormala fenomen ovanpå videon (valfritt tillval, opt-in)

Utöver B-roll (som klipps in som ett eget segment): ett andra kryssruta i Klippstudio
("AI-effekt ovanpå bilden") lägger ett AI-genererat fenomen OVANPÅ ditt eget uppladdade klipp
— ett "caught on camera"-ögonblick, på tema för paranormalt/medium-innehåll. Skiljer sig från
B-roll genom att den kompositeras in i din egen video istället för att vara ett fristående,
inklippt segment.

**Korrigering (skarpt test):** "Egen idé"-fältet i UI:t är uttryckligen valfritt ("lämna
tomt för ett generiskt förslag som passar vald typ"), men `generate-broll.ts` krävde tidigare
ALLTID att `customPrompt`/`category`/`subtopic`/`hookText` gav ihop minst ett icke-tomt
"tema" — bekräftat skarpt: ett tomt "Egen idé"-fält gav 400 "customPrompt, category,
subtopic eller hookText krävs", eftersom AI-effekt-flödet (till skillnad från B-roll-flödet)
aldrig skickar med category/subtopic/hookText. Effekttypens egen `EFFECT_TYPES[type]
.promptSystem` beskriver redan fullständigt vad som ska genereras och behöver inget tema
utöver det — kravet gäller nu bara när `effectMode` INTE är satt (dvs. bara för vanlig
B-roll). Ett tomt tema i effect-läge skickas till Claude som "Inget specifikt tema
angivet — hitta på ett generiskt, filmiskt exempel som passar effekttypen." istället för en
tom sträng.

**Sex typer** (dropdown i Klippstudio, `EFFECT_TYPE_OPTIONS` i `constants.js`), varje med egen
systemprompt (`EFFECT_TYPES` i `generate-broll.ts`) och egen kompositering (`EFFECT_COMPOSITE`
i `render-clip.ts`):

| Typ | Motiv | Kompositering |
|---|---|---|
| `orb` (Ljusklot) | Ett runt lysande klot | Kromakey, skalad 45%, centrerad |
| `mist` (Dimma/rök) | Vit/grå dimma som rullar | Kromakey, fyller bildrutan, nedtill |
| `sparks` (Gnistor) | Svävande glödpartiklar | Kromakey, fyller bildrutan, centrerad |
| `edgeGlow` (Kantglöd) | Flimrande ljussken | Kromakey, skalad 50%, höger kant |
| `static` (TV-brus/glitch) | Svartvitt brus/interferens | Ingen kromakey — hela bilden är effekten, läggs på med `opacity: 0.5` som en kort 0,6s-blink |
| `eyes` (Lysande ögon) | Ett par lysande ögon i mörkret — uttryckligen INTE ett mänskligt ansikte, bara abstrakta lysande former | Kromakey, skalad 40%, centrerad |

De fyra kromakey-baserade typerna kräver alla en ren, helt svart bakgrund i den genererade
videon (annars blir borttagningen fläckig) — Claude instrueras uttryckligen om detta per typ.
Samma "Förfina prompt"-mellansteg som B-roll finns också här (`refineOnly`/`refinedPrompt`).

**Kompositering:** `render-clip.ts` lägger den genererade videon som ett eget lager ovanpå det
första huvudsegmentet, med Shotstacks `chromaKey`-fält (`{ color: '#000000', threshold: 150,
halo: 100 }`, verifierat mot Shotstacks dokumentation) för fyra av typerna, eller `opacity` för
`static`. Varar så länge typens `defaultDuration` anger (`effectDurationSeconds` styrbart) eller
så länge första segmentet är, beroende på vad som är kortast. Spårordning (z-index): hook →
undertexter → effekt → video, så texten alltid syns ovanpå effekten och effekten alltid syns
ovanpå videon. `effectType` måste skickas till `/api/render-clip` med samma värde som
`effectMode` hade när klippet genererades — annars kan fel kompositeringsinställningar (fel
skalning/position) användas.

**Effektbibliotek (`effect_library`-tabellen, `EffectLibraryPicker`):** varje genererad
effekt sparas AUTOMATISKT (icke-kritiskt, samma "fire and forget"-mönster som
`embedAndStoreClip`) i en egen tabell (`0009_effect_library.sql`: `id`, `created_at`,
`effect_type`, `prompt`, `video_url`) — till skillnad från t.ex. `segmentStarts`/
`segmentEnds`, som medvetet INTE sparas, är detta genererat innehåll som kostat ett
Replicate-anrop, så det ska aldrig behöva genereras om bara för att sessionen stängdes.
`EffectLibraryPicker` visas direkt under typväljaren, filtrerad på vald `effectType` (en
`orb`-video passar inte inkomponerad som `mist`, olika skala/position/kromakey per typ i
`EFFECT_COMPOSITE`), med en horisontellt skrollbar rad tysta loop-videor (hover eller klick
för att förhandslyssna) och knapparna "Använd" (sätter `effectVideoUrl`/`effectPrompt` direkt,
ingen ny generering/kostnad) och "Ta bort" (permanent, `delete` mot tabellen). Är en effekt
redan vald visas en "Välj en annan effekt"-knapp för att gå tillbaka till biblioteket/
generera-ny-flödet. Samma öppna RLS-policy som `clips`/`trend_snapshots` (appen har ingen
egen inloggning).

**Valfri starttid inom segmentet (`EffectTimingPicker`):** effekten låg tidigare FAST vid
segment 0:s allra första bildruta — inget sätt att t.ex. låta ett ljusklot dyka upp mitt i
meningen istället för direkt. `effectStartSeconds` (klientstate) + `effectStartOffsetSeconds`
(skickas till `/api/render-clip`) löser det: en tidslinje för HELA segment 0:s längd med ett
dragbart handtag för starttiden och en skuggad zon som visar hur lång tid effektens
`defaultDuration` (`EFFECT_DEFAULT_DURATIONS` i `constants.js`, speglar `EFFECT_COMPOSITE` i
`render-clip.ts`) tar i anspråk. `render-clip.ts` klämmer offseten mot
`Math.max(length - effectDuration, 0)` så effekten alltid ryms inom segmentets faktiska längd,
och adderar den till `timelineCursor` istället för att alltid använda `timelineCursor` rakt av.

Om effektvideon redan är genererad spelas den upp OVANPÅ segmentets källvideo, synkat med
tidslinje-handtaget, med CSS `mix-blend-mode: 'screen'` (`EFFECT_PREVIEW_LAYOUT` i
`constants.js`) som en billig client-side approximation av Shotstacks riktiga `chromaKey` mot
svart bakgrund — svart blir i praktiken genomskinligt med "screen"-blandning, så resultatet ser
förvånansvärt likt ut utan någon egen bildbehandling i webbläsaren. Uttryckligen bara en
ungefärlig fingervisning i UI:t — "Snabb förhandsgranskning" är facit.

**TikTok-taggning:** `ai_generated_content` sätts till `true` när B-roll, effekten eller
bakgrundsbytet (se nästa avsnitt) används (`brollEnabled || effectEnabled ||
backgroundSwapEnabled` i `persistClip`).

**Ej byggt än (nämnt av användaren som en senare, mer experimentell utökning):** en AI-
genererad person som går förbi i bild (till skillnad från bakgrundsbytet nedan, där personen
är riktig, bara bakgrunden är AI-genererad) — bedömdes svårare att få snyggt, kräver renare
urklippning än en ljus/glöd-effekt.

## Bakgrundsbyte: AI-genererad bakgrund bakom dig (experimentellt, opt-in)

Ett tredje kryssruta i Klippstudio ("Byt bakgrund bakom dig") — till skillnad från B-roll och
overlay-effekterna ovan (som lägger till AI-genererat material) ERSÄTTER det här bakgrunden
bakom dig i klippets första segment med en AI-genererad bild, medan DU är kvar som vanligt
(riktig video, inte AI-genererad). T.ex. "ett slott bakom mig" eller "jag går på en klippa".

**Flöde, två separata steg (båda krävs innan rendering använder bakgrundsbytet):**
1. **Generera bakgrund** (`generate-background.ts`/`generate-background-status.ts`) — Claude
   skriver en bildprompt (uttryckligen ALDRIG människor i bilden, eftersom du läggs på separat)
   och `black-forest-labs/flux-schnell` (Replicate) genererar en stillbild. Fälten är
   verifierade direkt mot modellens öppna källkod (`cog-flux`). Submit+poll (samma mönster som
   B-roll), INTE `Prefer: wait` — testat skarpt: FLUX Schnell är snabb när modellen redan är
   varm, men en "cold start" (modellen skalad ner, måste laddas in igen) kan ta betydligt
   längre än en enda blockerande HTTP-förfrågan tolererar, vilket gav ett timeout-fel.
2. **Ta bort bakgrund ur mitt klipp** (`matte-video.ts`/`matte-video-status.ts`) —
   `bria/video-remove-background` (Replicate) tar bort bakgrunden ur HELA din uppladdade
   video och ersätter den med en solid grön färg (`background_color: 'Green'`), så att
   Shotstacks befintliga `chromaKey`-funktion (samma teknik som overlay-effekterna) kan
   användas för kompositeringen. Asynkront, pollas precis som B-roll/effekterna.

**Kompositering:** `render-clip.ts` ersätter (inte lägger till) det första segmentets
normala klipp med två lager: bakgrundsbilden på ett eget spår (`backgroundClips` — måste vara
ett separat spår från `videoClips`, eftersom klipp inom samma Shotstack-spår läggs i sekvens
och inte får överlappa i tid) och den grön-nycklade riktiga videon ovanpå, trimmad till
samma tidsintervall som segmentet skulle haft. Manuellt färgfilter hoppas medvetet över för
det här segmentet — det kan störa en redan känslig kromakey-nyckling.

**Kända begränsningar:**
- `bria/video-remove-background` har en gräns på max 60 sekunders indata. Vi skickar hela
  den uppladdade filen (inte bara det valda segmentet) för att slippa ett separat
  förklippningssteg — klipp längre än 60 sekunder kommer att felas i matningssteget.
- Fältnamnet för video-inputen till Bria-modellen kunde inte verifieras i förväg (Brias
  repo är inte publikt) — gissningen `video` var fel, bekräftat skarpt: Replicate svarade
  "video_url is required". Rättat till `video_url` i `matte-video.ts`.
- Kvalitetsrisk (forskning gjord innan bygget, inte bara en gissning): video-matting på
  vanlig, icke-studio-filmad video (dåligt/blandat ljus, hår, rörelse) är ett känt svagt
  område för den här typen av modeller — förvänta dig synliga kant-/flimmerartefakter på
  vissa klipp, inte en garanterat ren klippning varje gång.

## Tankebubblor: glödande "inre tankar" ovanpå bilden (valfritt, opt-in)

Ren textöverlägg-effekt — ingen AI-videogenerering inblandad, bara Claude-text + Shotstacks
`html`-asset (samma mönster som ord-för-ord-undertexterna). Claude genererar 2-4 korta,
"inre tankar" i jag-form eller som retoriska frågor (`thought_bubbles` i `generate-plan.ts`,
t.ex. "Vad om det är sant?"), max ca 25 tecken vardera.

En kryssruta visas under klippningsplanen så fort `plan.thought_bubbles` finns — förhandsvisar
alla genererade tankar i beskrivningstexten. Ikryssad skickas `thoughtBubbles`/
`thoughtBubblesEnabled` till `/api/render-clip`.

**Position:** manuellt vald (x/y-procent, samma bas som glow-overlayen nedan) — dragbar i
"Klippets sammansättning" (se det avsnittet), samma position används för alla segment.
`thoughtBubbleXPercent`/`thoughtBubbleYPercent` skickas till `/api/render-clip`.

**Kompositering** (`render-clip.ts`): ett tankebubbla-klipp per segment (cyklar om fler segment
än bubblor), centrerat i segmentets tidsfönster, `THOUGHT_BUBBLE_DURATION` (1,8s) långt. Byggd
med samma `html`-canvas-teknik som glow-overlayen — en absolut-positionerad `<div>` (`left`/
`top` i exakt uträknade pixlar mot `OUTPUT_SIZE`, `transform: translate(-50%, -50%)` för
centrering oavsett textlängd) istället för Shotstacks förinställda `position`-lägen som
tidigare (växlade bara mellan `topLeft`/`topRight`). Glödande lila `box-shadow` runt en vit
rundad bubbla (`buildThoughtBubbleCss`). Eget spår (`bubbleClips`) eftersom den överlappar i
tid med undertext-spåret (`captionClips`) — klipp inom samma Shotstack-spår får inte
överlappa. Spårordning (z-index): hook → tankebubblor → undertexter → effekt → video →
bakgrund.

Taggas INTE som AI-genererat innehåll (`ai_generated_content`) — konceptuellt samma sak som
hook/undertexter (Claude-skriven text, ingen syntetisk bild/video), som redan inte taggas.

## Glow-overlay: manuellt positionerad glödeffekt (valfritt, opt-in)

En pulserande glöd ovanpå ett manuellt utvalt, FAST område i bilden — t.ex. för att få en
tatuering, symbol eller ett föremål att se ut att glöda/lysa som ett kraftmärke. Bygger
INTE på AI-baserad objektspårning/rotoscopering: positionen är statisk under hela det angivna
tidsintervallet, avsedd för klipp där området hålls relativt stilla i bild. UI:t texlar detta
tydligt. Rör sig materialet mycket vill användaren ha en spårad effekt rekommenderas extern
mjukvara (CapCut/DaVinci Resolve) istället — inte byggt in i appen.

Obs: appens faktiska renderingsmotor är Shotstack (se "Att göra: Remotion" nedan för varför
Remotion inte är kopplad på riktigt än) — glow-effekten är därför byggd med samma
Shotstack `html`-asset-mönster som tankebubblorna/ord-för-ord-undertexterna ovan, inte som en
Remotion-komponent.

**Flöde i Klippstudio** (kryssruta "Glow-effekt: få något att lysa", visas för varje klipp
oavsett B-roll/effekt/bakgrundsbyte):
1. **Positionering** sker i "Klippets sammansättning" (se det avsnittet nedan) — dra i
   mitten för att flytta (`x_percent`/`y_percent`), dra i handtaget i hörnet för att ändra
   storlek (`radius_percent`). Alla tre är procent av videons BREDD (även vertikalt), så
   cirkeln hålls rund oavsett att rutan/videon är 9:16.
2. **Starttid/sluttid** (sekunder, i glow-kortet) — positionerat på klippets FÄRDIGA
   tidslinje (efter klippning/B-roll/etc.), inte källvideons egna tidsstämplar.
3. **Färg** (guld/blå/vit/röd) och **intensitet** (låg/medel/hög).

**Datamodell:** sparas som `glow_effect jsonb` på `clips`-tabellen (migration
`0007_glow_effect.sql`), t.ex.:
```json
{
  "enabled": true,
  "x_percent": 42,
  "y_percent": 58,
  "radius_percent": 12,
  "start_seconds": 2.5,
  "end_seconds": 6.0,
  "color": "gold",
  "intensity": "medium"
}
```

**Kompositering** (`render-clip.ts`): byggs EFTER huvudloopen över segmenten (positionen är
fast över hela intervallet, inte per segment) som ett eget spår (`glowClips`) — samma skäl som
`bubbleClips`/`backgroundClips`, den kan tidsöverlappa andra spår. En `html`-asset med en
`radial-gradient`-cirkel + `box-shadow` i vald färg, i exakt pixelposition uträknad från
`x_percent`/`y_percent`/`radius_percent` mot `OUTPUT_SIZE` (1080×1920).

Den "mjuka pulseringen i opacitet" byggs INTE som en CSS-animation inuti html-asseten (kunde
inte verifieras mot Shotstacks dokumentation härifrån, nätverksbegränsningar) utan av flera
korta (0,25s), sekventiella klipp på samma spår med varierande `opacity` — Shotstacks redan
verifierade klipp-nivå-fält (samma fält som `static`-effekten och bakgrundsbytets kromakey-
lager använder) — sampling av en sinusvåg med ca 1,6s period. Spårordning (z-index): hook →
tankebubblor → undertexter → glow → AI-effekt → video → bakgrund, så glowen syns ovanpå
videon och den AI-genererade ljuseffekten men under text.

Taggas INTE som AI-genererat innehåll — manuell positionering/CSS, ingen AI-generering.

**Live tidslinje-förhandsgranskning (`GlowTimelinePreview`):** eftersom glowen renderas som
ren CSS (ingen AI-videogenerering) går den, till skillnad från AI-effekten ovan, att
återskapa nästan exakt client-side utan att vänta på en Shotstack-rendering. Komponenten
spelar upp klippets EGEN källvideo och ritar en `radial-gradient`-cirkel ovanpå — synlig bara
när `<video>`-elementets `currentTime` (via `onTimeUpdate`) ligger inom `[start_seconds,
end_seconds]` — med samma `GLOW_COLORS_RGB`/`GLOW_INTENSITY_OPACITY_CLIENT`-konstanter i
`constants.js` som speglar servern (`GLOW_COLORS`/`GLOW_INTENSITY_OPACITY` i `render-clip.ts`)
manuellt. Medveten förenkling: STATISK styrka istället för den riktiga renderingens pulsering
(sinusvågen byggd av många korta klipp, se ovan) — en CSS-animation i förhandsgranskningen hade
inte tillfört något för att bedöma placering/färg/storlek. Ett andra dragbart tidslinje-
handtagspar under videon (samma pointer-drag-mönster som `ClipTrimmer`) sätter
`glowStartSeconds`/`glowEndSeconds` direkt — talfälten ovanför finns kvar för exakt inmatning.

OBS samma begränsning som nämns i UI:t: `start_seconds`/`end_seconds` är sekunder på det
FÄRDIGA klippets tidslinje (efter ev. bortklippning/flera källklipp/hook), inte nödvändigtvis
källvideons egna tidsstämplar — stämmer exakt för ett enda oklippt källklipp, är annars en
ungefärlig fingervisning för att snabbt hitta rätt läge innan man kollar "Snabb
förhandsgranskning".

## Redigera start-/sluttid och hastighet per segment (valfritt)

I segmentlistan i Klippstudio kan varje segments start-/sluttid (mm:ss, förifyllt med AI:ns
förslag) redigeras direkt — antingen i två textfält, eller visuellt (se "Trimma visuellt"
nedan) — t.ex. för att klippa bort för mycket material om ett AI-föreslaget segment blev för
långt. En hastighets-dropdown (`SEGMENT_SPEED_OPTIONS` i `constants.js`, 0.5x–2x) skapar
slow-motion eller time-lapse-känsla per segment.

**Trimma visuellt (`ClipTrimmer`-komponenten):** en tidigare version av den här README:n
avfärdade drag-i-tidslinjen-scrubbing som ett ordentligt vägval bort, med motiveringen att en
förhandsvisning skulle avvika från Shotstacks faktiska rendering. Det gällde egentligen bara
om man vill förhandsvisa EFFEKTER/RENDERINGEN i tidslinjen — men det här är enklare: en ren
`<video>`-spelare av DIN EGEN uppladdade källfil (samma fil som redan skickas till Shotstack,
inget nytt att hålla synkat), med två dragbara handtag på en tidslinje under spelaren för
start-/sluttid. Ingen ny backend — handtagen skriver bara till exakt samma
`segmentStarts`/`segmentEnds`-state som textfälten, bara ett smidigare INMATNINGSSÄTT (peka
och dra istället för att räkna ut "0:05" i huvudet). Textfälten finns kvar bredvid för exakt
inmatning. Bara ett segments trimmer är öppen åt gången (`trimmerOpenIndex`) — flera
`<video>`-element samtidigt är tungt på mobil.

**Kompositering** (`render-clip.ts`): `segmentStarts`/`segmentEnds` (strängar, samma mm:ss-
format som `segments_plan[i].start/end`) skickas som parallella arrayer och används istället
för AI-förslaget om ifyllda — precis samma override-mönster som `segmentEffects`/
`segmentFilters`. Eftersom `trimStart`/`trimEnd` beräknas EN gång per segment och allt annat i
loopen (ord-för-ord-undertexter, nyckelfras-fallback, AI-effekten) redan använder dessa
variabler, kaskadar en redigerad tid automatiskt rätt genom hela segmentet utan någon extra
kod. `segmentSpeeds` sätts som Shotstacks `speed`-fält direkt på video-asseten (float-
multiplikator) — ändrar uppspelningstakten men INTE segmentets tilldelade tid på tidslinjen
(`length` är oförändrad, mer eller mindre av källvideon konsumeras för att fylla samma
tidsfönster).

Sparas INTE på klippet i Supabase (`glow_effect` sparas, men detta gör det inte) — samma
mönster som `segmentEffects`/`segmentFilters`, som redan bara är engångsval för en specifik
rendering.

## Klippets sammansättning: se alla overlay-tillval tillsammans (canvas)

Innan detta positionerades glow och (fram tills nyligen) tankebubblor blint i sina egna,
separata kort — du visste inte var AI-effekten eller bakgrundsbytet skulle hamna i
förhållande till glöden du precis placerat. `ClipCanvas`-komponenten i `Klippstudio.jsx`
(generaliserad från den ursprungliga `GlowPositioner`) löser det: EN gemensam 9:16-ruta,
byggd ovanpå klippets första bildruta, som visar alla aktiva tillval som "lager" samtidigt.
Visas överst i "Avancerat"-sektionen så snart råmaterial är uppladdat.

**Fyra lagertyper**, olika interaktivitet beroende på vad Shotstack faktiskt stödjer:
- `circle` (glow) — dragbar + resizable (handtag i hörnet). Shotstacks `html`-asset tillåter
  fri pixel-positionering, se glow-avsnittet ovan.
- `marker` (tankebubbla) — dragbar (samma html-asset-teknik), ingen storleksändring.
- `badge` (AI-effekt) — SKRIVSKYDDAD referensetikett vid `EFFECT_POSITION_HINTS[effectType]`
  (`constants.js`, matchar `EFFECT_COMPOSITE` i `render-clip.ts`). Går inte att dra: Shotstack
  stödjer bara förinställda lägen (`center`/`bottom`/`right`) för video-kompositering, inte
  fri positionering som för html-assets — en dragbar badge här hade varit missvisande.
- `zone`/`fullFrame` (hook, undertexter, bakgrundsbyte) — skrivskyddade band/indikatorer,
  ren visuell medvetenhet om var text alltid hamnar och att bakgrunden ersätts.

**Datan lever inte i komponenten** — `ClipCanvas` är "dum" (tar emot ett `layers`-array och
två callbacks, `onMoveLayer`/`onResizeLayer`), all faktisk positionsdata är samma
`glowXPercent`/`glowYPercent`/`glowRadiusPercent` och nya `thoughtBubbleXPercent`/
`thoughtBubbleYPercent`-state som redan fanns/beskrivs i respektive avsnitt ovan — canvasen
är bara EN gemensam vy in i dem, inte en ny datamodell.

Samma förhandsvisningsbild (`handleCaptureGlowPreview`, klientsidig `<video>`+`<canvas>`)
återanvänds — ingen ny bildruta-hämtning behövdes.

## Redigera med vägledning: fri textinstruktion tolkas av Claude (valfritt)

Ett alternativ till att ställa in start-/sluttid/hastighet manuellt (avsnittet ovan): en
textruta ("Redigera med vägledning") direkt under segmentlistan där du beskriver ändringen i
vanlig text — t.ex. "korta ner mittendelen", "sakta ner när jag säger den viktiga meningen",
"klipp bort de första 3 sekunderna" — och Claude omtolkar HELA segmentplanen (start/slut,
description, och ev. hastighet) åt dig, istället för att du fyller i siffror.

**Varför bildrutor, inte video:** Claude API tar emot bilder, inte videofiler (ingen inbyggd
videoförståelse) — Google Gemini är det som faktiskt kan analysera en video direkt, men det
vore en helt ny integration (egen nyckel, egen edge function, egen kostnad) utan något att
återanvända från det som redan finns. Kompromissen: `captureGuidanceFrames` i Klippstudio.jsx
hämtar en nedskalad bildruta (max 480px bredd) per segment, vid varje segments mittpunkt,
klientsidigt via samma `<video>`+`<canvas>`-teknik som glow-förhandsvisningen (se den för
varför videoelementet måste bifogas DOM:en, inte skapas "detached" — iOS Safari-kompatibilitet).
Ger Claude grov visuell kontext, inte rörelse/exakt tajming.

**Anropet** (`revise-plan.ts`, samma Claude-modell som `generate-plan.ts` för konsekvens):
multimodalt innehåll — en textrad + bildruta per segment i ordning, följt av den fulla
nuvarande planen, transkriptet och instruktionen som avslutande text. Strukturerat svar
(samma `output_config.format`-mönster som `generate-plan.ts`) med `segments_plan` (ny,
komplett plan — kan slå ihop/ta bort/lägga till segment, inte bara justera befintliga),
`segment_speeds` (parallell array, samma `SEGMENT_SPEED_OPTIONS`-värden) och `summary` (kort
förklaring som visas för användaren så de ser att instruktionen tolkades rätt).

Instrueras uttryckligen att hålla sig INOM det tidsspann segmenten redan täcker — Claude vet
inte hur lång källvideon är utöver det, och ska inte hitta på nya tidsintervall.

**Resultatet skrivs över `plan.segments_plan`** (inte bara `segmentStarts`/`segmentEnds` som
i det manuella läget ovan) eftersom Claude kan ändra antalet segment — därför nollställs även
`segmentEffects`/`segmentFilters` (gamla val per index skulle annars kunna hamna fel mot nya
segment). `editInstruction` sparas INTE på klippet, bara resultatet av den (samma engångsval-
princip som andra segment-nivå-fält).

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
