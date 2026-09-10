-- Hybrid retrieval: Postgres full-text + pgvector in one store.
-- The review's position, which I agree with: a separate vector database must
-- beat Postgres on OUR benchmark before it earns its operating cost.
--
-- Run lib/eval/retrieval-bench.ts BEFORE deploying this. If hybrid does not
-- beat lexical on the must-not-miss set, do not ship the embedding column.

create extension if not exists vector;

alter table public.candidates
  add column if not exists search_text text,
  -- Dimension must match your embedder. 1024 suits several current models;
  -- change it before the first insert, because altering it later rewrites the table.
  add column if not exists embedding vector(1024),
  add column if not exists embedded_at timestamptz,
  add column if not exists embedding_model text;

-- Generated tsvector: weighted so a term in the title outranks the same term
-- buried in boilerplate. A=title, B=employer, C=body.
alter table public.candidates
  add column if not exists fts tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(employer, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(search_text, '')), 'C')
  ) stored;

create index if not exists candidates_fts_idx on public.candidates using gin (fts);

-- HNSW over cosine distance. Build it AFTER backfilling embeddings; building on
-- an empty table then inserting is slower than the reverse.
create index if not exists candidates_embedding_idx
  on public.candidates using hnsw (embedding vector_cosine_ops);

-- Reciprocal rank fusion in SQL, mirroring lib/retrieval.ts so the benchmark
-- and production cannot silently diverge.
create or replace function public.hybrid_search(
  query_text   text,
  query_vector vector(1024) default null,
  match_limit  int default 50,
  rrf_k        int default 60,
  min_similarity float default 0.25
)
returns table (candidate_id uuid, score float, contributors text[])
language sql stable as $$
  with lexical as (
    select id, row_number() over (order by ts_rank_cd(fts, websearch_to_tsquery('english', query_text)) desc) as rank
    from public.candidates
    where kept and closed_at is null
      and fts @@ websearch_to_tsquery('english', query_text)
    limit match_limit * 2
  ),
  semantic as (
    select id, row_number() over (order by embedding <=> query_vector) as rank
    from public.candidates
    where query_vector is not null
      and embedding is not null
      and kept and closed_at is null
      -- cosine distance = 1 - similarity, so the floor becomes a distance ceiling
      and (embedding <=> query_vector) <= (1 - min_similarity)
    limit match_limit * 2
  ),
  fused as (
    select coalesce(l.id, s.id) as id,
           coalesce(1.0 / (rrf_k + l.rank), 0) + coalesce(1.0 / (rrf_k + s.rank), 0) as score,
           array_remove(array[
             case when l.id is not null then 'lexical' end,
             case when s.id is not null then 'semantic' end
           ], null) as contributors
    from lexical l full outer join semantic s on l.id = s.id
  )
  select id, score, contributors from fused order by score desc limit match_limit;
$$;

comment on function public.hybrid_search is
  'Mirrors lib/retrieval.ts reciprocal rank fusion. Passing query_vector => NULL degrades to lexical-only rather than returning nothing, matching the TypeScript retriever.';

-- Which candidates still need embedding. Drives the backfill worker.
create or replace view public.needs_embedding as
select id, employer, title, search_text
from public.candidates
where kept and closed_at is null and embedding is null and search_text is not null
order by first_seen_at desc;
