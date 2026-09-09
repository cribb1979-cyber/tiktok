-- Steg 6: publik storage-bucket för uppladdat råmaterial, så Shotstack (extern tjänst)
-- kan hämta videon via URL för rendering.

insert into storage.buckets (id, name, public)
values ('raw-clips', 'raw-clips', true)
on conflict (id) do nothing;

-- Idempotent (drop+create) eftersom "create policy if not exists" inte stöds på alla
-- Postgres-versioner.
drop policy if exists "Public read raw-clips" on storage.objects;
create policy "Public read raw-clips"
on storage.objects for select
using (bucket_id = 'raw-clips');

-- Ingen inloggning/TikTok-koppling finns än, så uppladdning tillåts anonymt precis som
-- resten av appen (samma anon-nyckel-modell som clips/trend_snapshots). Strama åt med en
-- riktig policy när autentisering finns på plats.
drop policy if exists "Anon upload raw-clips" on storage.objects;
create policy "Anon upload raw-clips"
on storage.objects for insert
with check (bucket_id = 'raw-clips');
