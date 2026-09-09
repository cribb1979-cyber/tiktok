-- Valfritt tillval: AI-genererad B-roll (atmosfäriska bakgrundssekvenser) — ALDRIG för att
-- avbilda Christoffer själv i bild, kontots trovärdighet bygger på att det är honom. Opt-in
-- per klipp i Klippstudio, aldrig standard.

alter table clips add column if not exists broll_enabled boolean default false;
alter table clips add column if not exists broll_prompt text;
alter table clips add column if not exists broll_video_url text;

-- TikToks regler kräver taggning av AI-genererat innehåll. Sätts automatiskt när B-roll
-- används — aldrig ett fält användaren väljer manuellt, för att inte kunna glömmas bort.
alter table clips add column if not exists ai_generated_content boolean default false;
