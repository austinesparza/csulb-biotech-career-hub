-- Final tightening for the source-enrichment parser. Keep the extraction explicit
-- and deterministic, and preserve spacing in approximate duration labels.

create or replace function public.extract_source_program_timing(p_title text, p_text text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_combined text := concat_ws(' ', p_title, p_text);
  v_range text[];
  v_term text[];
  v_duration text[];
  v_term_label text;
  v_duration_prefix text;
begin
  v_range := regexp_match(
    coalesce(p_text, ''),
    '((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[[:space:]]+[0-9]{1,2}(?:st|nd|rd|th)?(?:,[[:space:]]*20[0-9]{2})?[[:space:]]+(?:through|to|until|[-–])[[:space:]]+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[[:space:]]+[0-9]{1,2}(?:st|nd|rd|th)?(?:,[[:space:]]*20[0-9]{2}))',
    'i'
  );
  if v_range is not null then
    return btrim(regexp_replace(v_range[1], '[[:space:]]+', ' ', 'g'));
  end if;

  v_term := regexp_match(
    v_combined,
    '\m(Spring|Summer|Fall|Autumn|Winter)\M[[:space:]]+(20[0-9]{2})',
    'i'
  );
  if v_term is null then
    v_term := regexp_match(
      v_combined,
      '\m(20[0-9]{2})\M[[:space:]]+(Spring|Summer|Fall|Autumn|Winter)\M',
      'i'
    );
    if v_term is not null then
      v_term_label := initcap(lower(v_term[2])) || ' ' || v_term[1];
    end if;
  else
    v_term_label := initcap(lower(v_term[1])) || ' ' || v_term[2];
  end if;

  if v_term_label is null then
    return null;
  end if;

  v_duration := regexp_match(
    coalesce(p_text, ''),
    '\m((?:approximately|about)[[:space:]]+)?([0-9]{1,2})[ -]?(week|month)s?\M',
    'i'
  );
  if v_duration is not null then
    v_duration_prefix := case
      when v_duration[1] is not null then lower(btrim(v_duration[1])) || ' '
      else ''
    end;
    return v_term_label || ' (' || v_duration_prefix
      || v_duration[2] || ' ' || lower(v_duration[3])
      || case when v_duration[2] = '1' then '' else 's' end || ')';
  end if;

  return v_term_label;
end;
$$;

revoke execute on function public.extract_source_program_timing(text, text) from public, anon, authenticated;
grant execute on function public.extract_source_program_timing(text, text) to service_role;
