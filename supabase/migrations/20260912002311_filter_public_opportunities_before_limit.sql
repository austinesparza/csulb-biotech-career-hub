-- Keep anonymous board search bounded without losing matches that sort below
-- an arbitrary pre-filter row limit.
create or replace function public.search_public_opportunities(
  p_query text default null,
  p_focus text default null,
  p_location text default null,
  p_paid_only boolean default false,
  p_sort text default 'recommended',
  p_limit integer default 200
)
returns setof public.public_opportunities
language sql
stable
security invoker
set search_path = ''
as $$
  select p.*
  from public.public_opportunities p
  where
    (
      nullif(btrim(p_query), '') is null
      or to_tsvector(
        'simple',
        concat_ws(
          ' ',
          p.company_name,
          p.title,
          p.location,
          p.eligibility,
          p.focus_area,
          array_to_string(p.scientific_lanes, ' '),
          array_to_string(p.job_functions, ' '),
          array_to_string(p.methods, ' ')
        )
      ) @@ websearch_to_tsquery('simple', p_query)
    )
    and (
      nullif(btrim(p_focus), '') is null
      or p.focus_area ilike '%' || p_focus || '%'
      or exists (
        select 1
        from unnest(coalesce(p.scientific_lanes, '{}'::text[])) as lane
        where lane ilike '%' || p_focus || '%'
      )
    )
    and (
      nullif(btrim(p_location), '') is null
      or p.location ilike '%' || p_location || '%'
    )
    and (
      not p_paid_only
      or p.paid_status in ('paid', 'stipend')
    )
  order by
    case when p_sort = 'deadline' then p.deadline end asc nulls last,
    case when p_sort = 'newest' then p.first_seen_at end desc nulls last,
    case when p_sort = 'company' then lower(p.company_name) end asc nulls last,
    case when p_sort not in ('deadline', 'newest', 'company')
      then p.relevance_score end desc nulls last,
    p.company_name asc,
    p.title asc,
    p.id asc
  limit least(greatest(coalesce(p_limit, 200), 1), 200);
$$;

revoke all on function public.search_public_opportunities(
  text, text, text, boolean, text, integer
) from public;
grant execute on function public.search_public_opportunities(
  text, text, text, boolean, text, integer
) to anon, authenticated;
