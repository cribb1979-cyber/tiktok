-- Klippapp: grunddatamodell
-- Steg 2 i byggordningen (se projektspec).

create extension if not exists "pgcrypto";

create table if not exists clips (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  prompt text,
  category text,
  subtopic text,
  trend_source text,
  hook_text text,
  hook_variants jsonb,
  segments_plan jsonb,
  sound_used text,
  copyright_flag boolean default false,
  video_url text,
  status text default 'draft', -- draft, scheduled, posted
  scheduled_at timestamptz,
  posted_at timestamptz,
  tiktok_post_id text,
  views_24h int,
  avg_watch_pct numeric,
  shares int,
  comments int,
  retention_curve jsonb
);

create table if not exists trend_snapshots (
  id uuid primary key default gen_random_uuid(),
  fetched_at timestamptz default now(),
  hashtag text,
  sound_name text,
  sound_url text,
  category text,
  raw_data jsonb
);

create index if not exists clips_status_idx on clips (status);
create index if not exists clips_category_idx on clips (category);
create index if not exists clips_views_24h_idx on clips (views_24h desc);
create index if not exists trend_snapshots_fetched_at_idx on trend_snapshots (fetched_at desc);
