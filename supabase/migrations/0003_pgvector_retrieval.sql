-- Steg 10: pgvector-retrieval av liknande tidigare klipp.
--
-- Aktiverar bara extension + embedding-kolumnen här. Ett ivfflat-index byggs INTE
-- automatiskt — enligt specen ger retrieval först nytta vid >20-30 rader, och ett index på
-- ett nästan tomt bord ger varken prestandavinst eller pålitlig kvalitet. Kör detta separat
-- när clips har tillräckligt många embeddade rader:
--
--   create index clips_embedding_idx on clips
--   using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create extension if not exists vector;

alter table clips add column if not exists embedding vector(1536);

-- Semantisk sökning (cosine similarity) bland tidigare publicerade klipp, valfritt
-- filtrerad på kategori. Anropas från klienten via supabase.rpc('match_clips', ...).
create or replace function match_clips(
  query_embedding vector(1536),
  match_category text default null,
  match_count int default 3
)
returns table (
  id uuid,
  hook_text text,
  category text,
  subtopic text,
  views_24h int,
  avg_watch_pct numeric,
  segments_plan jsonb,
  similarity float
)
language sql stable
as $$
  select
    clips.id,
    clips.hook_text,
    clips.category,
    clips.subtopic,
    clips.views_24h,
    clips.avg_watch_pct,
    clips.segments_plan,
    1 - (clips.embedding <=> query_embedding) as similarity
  from clips
  where clips.status = 'posted'
    and clips.embedding is not null
    and (match_category is null or clips.category = match_category)
  order by clips.embedding <=> query_embedding
  limit match_count;
$$;
