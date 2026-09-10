-- RLS (Row Level Security) blev troligen aktiverat på clips/trend_snapshots via Supabase-
-- dashboarden (t.ex. en "Security Advisor"-varning) utan att policies sattes upp — vilket
-- blockerade ALLA sparningar med felet "new row violates row-level security policy".
--
-- Appen har ingen egen inloggning än — alla anrop görs med samma publika anon-nyckel — så
-- policies här är medvetet öppna för alla operationer, funktionellt likvärdigt med att RLS
-- inte fanns. Skärp åt (t.ex. filtrera på en user_id-kolumn) om/när riktig
-- användarinloggning byggs.

alter table clips enable row level security;
alter table trend_snapshots enable row level security;

drop policy if exists "Anon full access to clips" on clips;
create policy "Anon full access to clips"
on clips for all
using (true)
with check (true);

drop policy if exists "Anon full access to trend_snapshots" on trend_snapshots;
create policy "Anon full access to trend_snapshots"
on trend_snapshots for all
using (true)
with check (true);
