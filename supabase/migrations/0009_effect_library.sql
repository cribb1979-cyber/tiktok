-- Effektbibliotek: sparar varje AI-genererad ljuseffekt (orb/mist/sparks/edgeGlow/static/
-- eyes, se EFFECT_TYPE_OPTIONS i constants.js) permanent, så en redan betald Replicate-
-- generering går att återanvända i ett nytt klipp utan att generera (och betala för) om
-- samma effekt igen. Fristående från clips-tabellen — effekten är bara en overlay-video,
-- inte knuten till vilket klipp den skapades från.
create table if not exists effect_library (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  effect_type text not null,
  prompt text,
  video_url text not null
);

create index if not exists effect_library_effect_type_idx on effect_library (effect_type);
create index if not exists effect_library_created_at_idx on effect_library (created_at desc);

-- Samma öppna RLS-mönster som clips/trend_snapshots (0005_rls_policies.sql) — appen har
-- ingen egen inloggning, alla anrop görs med samma publika anon-nyckel.
alter table effect_library enable row level security;

drop policy if exists "Anon full access to effect_library" on effect_library;
create policy "Anon full access to effect_library"
on effect_library for all
using (true)
with check (true);
