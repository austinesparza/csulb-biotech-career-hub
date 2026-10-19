begin;
do $$
declare v text;
begin
  foreach v in array array['$25/hr', '$25 - $35 per hour', '$35.34–$41.20/hour', '$1,500/week', '$60,000–$80,000 annually'] loop
    assert public.infer_source_paid_status(v) = 'paid', 'stated wage not detected: ' || v;
    assert public.extract_source_compensation_note(v) = v, 'source text must be retained: ' || v;
  end loop;
  assert public.infer_source_paid_status('$5,000 stipend') = 'stipend';
  assert public.infer_source_paid_status('Summer interns receive a monthly stipend based on academic level.') = 'stipend';
  assert public.infer_source_paid_status('Benefits include paid holidays and unpaid time off.') = 'unknown';
  assert public.infer_source_paid_status('Revenue of $400M; $130M funding.') = 'unknown';
  assert public.infer_source_paid_status('Housing stipend: $5,000.') = 'unknown';
  assert public.infer_source_paid_status('$5,000 housing stipend.') = 'unknown';
  assert public.infer_source_paid_status('$35/hour plus a housing stipend.') = 'paid';
  assert public.infer_source_paid_status('Salary Range: $ - $ per hour') = 'unknown';
  assert public.infer_source_paid_status('Pay Range: $0 - $0') = 'unknown';
  assert public.extract_source_compensation_note('Paid internship. Base pay: $35.34–$41.20/hour.') = 'Base pay: $35.34–$41.20/hour.';
  assert public.merge_source_compensation_note('Research context.', '$25/hr') = E'Research context.\n$25/hr';
  assert public.merge_source_compensation_note(E'Research context.\n$25/hr', '$25/hr') = E'Research context.\n$25/hr';
  assert public.merge_source_compensation_note('$25/hr', '$30/hr') = '$25/hr', 'conflicting rates require review';
  assert not has_function_privilege('anon', 'public.merge_source_compensation_note(text,text)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.merge_source_compensation_note(text,text)', 'EXECUTE');
end;
$$;
rollback;
