# Klippapp

Webbapp (React + Vite) för att skapa, publicera och analysera korta videoklipp (TikTok-format). Byggs stegvis enligt projektspecen — detta är **steg 1–3**: projekt-scaffold, datamodell i Supabase, och Bibliotek-vyn med manuell inmatning (utan AI-integrationer ännu).

## Kom igång

```bash
npm install
cp .env.example .env   # fyll i VITE_SUPABASE_URL och VITE_SUPABASE_ANON_KEY
npm run dev
```

## Supabase-setup

1. Skapa ett Supabase-projekt.
2. Kör migrationen i `supabase/migrations/0001_init_schema.sql` (SQL Editor eller `supabase db push`) för att skapa tabellerna `clips` och `trend_snapshots`.
3. Kopiera projektets URL och anon-nyckel till `.env`.

`pgvector`-extensionen och embedding-kolumnen på `clips` läggs till i ett senare steg (retrieval av liknande klipp), enligt byggordningen.

## Sidor

- **Idébank** – platshållare, trenddata kopplas på senare
- **Klippstudio** – platshållare, AI-klippningsplan kopplas på senare
- **Bibliotek** – fungerande: lista, lägg till och ta bort klipp manuellt, sortera på bäst presterande, filtrera på kategori
- **Kalender** – platshållare
- **Inställningar** – platshållare, TikTok-koppling kopplas på senare

## Nästa steg

4. Koppla på Claude API för klippningsplan + hook-förslag (server-side via Netlify Edge Functions)
5. Whisper för transkribering
6. Shotstack för rendering
7. Idébank med trenddata
8. TikTok-koppling som stub/mock
9. Few-shot-kontext i Claude-anropen
10. Retrieval via pgvector
