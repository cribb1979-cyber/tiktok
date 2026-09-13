-- Bibliotek för ALLT AI-genererat innehåll som inte redan har ett eget bibliotek
-- (effect_library, 0009, täcker bara AI-effekterna orb/mist/sparks/etc.) — B-roll, musik och
-- berättarröst sparas idag INGENSTANS permanent: en genererad video/ljudfil finns bara kvar
-- i React-state tills sidan stängs/laddas om, och går förlorad om man inte hann använda den i
-- en rendering. Efterfrågat direkt av användaren ("autospara alla genererade klipp oavsett
-- B-roll") efter att ha upplevt att en pågående generering kunde avbrytas (skärmen släcktes,
-- se README "Wake Lock"). Med detta bibliotek finns resultatet kvar och går att återanvända
-- även om själva genereringsflödet avbröts innan man hann spara/använda det direkt.
create table if not exists generated_content (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- 'broll' | 'music' | 'narration' — inga fler typer planerade än så (AI-effekter har redan
  -- effect_library, glow/tankebubblor är inte AI-genererade och behöver inget bibliotek).
  kind text not null,
  -- Den fria idé/text som gav upphov till innehållet (customPrompt/styleIdea/berättartext) —
  -- för att kunna känna igen/återanvända ett tidigare försök.
  prompt text,
  -- Typspecifika extra fält (t.ex. { lyrics, tags } för musik, { voice } för berättarröst) —
  -- jsonb istället för egna kolumner eftersom de tre typerna har helt olika fält.
  metadata jsonb,
  media_url text not null
);

create index if not exists generated_content_kind_idx on generated_content (kind);
create index if not exists generated_content_created_at_idx on generated_content (created_at desc);

-- Samma öppna RLS-mönster som clips/effect_library — appen har ingen egen inloggning, alla
-- anrop görs med samma publika anon-nyckel.
alter table generated_content enable row level security;

drop policy if exists "Anon full access to generated_content" on generated_content;
create policy "Anon full access to generated_content"
on generated_content for all
using (true)
with check (true);
