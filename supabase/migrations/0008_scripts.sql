-- Manus-läge (steg 7 i spec-dokumentet): dialog + regianvisningar i hakparenteser
-- (t.ex. "[Lugn början – du sitter stilla]") tolkas av Claude till beats (rad, regianvisning,
-- föreslagen längd) och skickas som talbar dialog till en AI-avatar-tjänst (HeyGen), som
-- genererar en talande video. Den resulterande videon läggs sedan in i det VANLIGA
-- clips-flödet (samma multi-klipp-array som uppladdat råmaterial) i Klippstudio.jsx — scripts
-- är bara historiken över manuset/tolkningen, inte en egen renderingsväg.
--
-- clip_id sätts (om alls) EFTER att klippet sparats i Bibliotek, inte vid genereringen —
-- därför nullable och on delete set null (ett borttaget klipp ska inte ta bort manushistoriken).
create table if not exists scripts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  clip_id uuid references clips(id) on delete set null,
  raw_text text not null,
  parsed_beats jsonb,
  render_mode text not null default 'ai_avatar', -- ai_avatar | self_filmed (guidning/teleprompter, ej byggt än)
  avatar_provider text -- t.ex. 'heygen', null om render_mode = self_filmed
);

-- Samma öppna anon-policy-mönster som 0005_rls_policies.sql — appen har ingen egen
-- inloggning än, alla anrop görs med samma publika anon-nyckel.
alter table scripts enable row level security;

drop policy if exists "Anon full access to scripts" on scripts;
create policy "Anon full access to scripts"
on scripts for all
using (true)
with check (true);
