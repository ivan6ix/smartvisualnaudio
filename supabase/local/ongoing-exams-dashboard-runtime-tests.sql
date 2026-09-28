do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'exam_attempts'
      and column_name = 'submission_reason'
  ) then
    raise exception 'Missing exam_attempts.submission_reason';
  end if;

  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'professor_ongoing_exam_dismissals'
  ) then
    raise exception 'Missing professor_ongoing_exam_dismissals';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_professor_ongoing_exams'
      and p.prosecdef
  ) then
    raise exception 'Missing security-definer get_professor_ongoing_exams';
  end if;

  if strpos(pg_get_functiondef('public.get_professor_ongoing_exams()'::regprocedure), '''answer''') > 0 then
    raise exception 'get_professor_ongoing_exams exposes answer JSON key';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'professor_ongoing_exam_dismissals'
      and policyname in ('professor_ongoing_dismissals_read_own', 'professor_ongoing_dismissals_manage_own')
  ) then
    raise exception 'Missing professor ongoing dismissal RLS policies';
  end if;
end $$;
