begin;

alter table public.exam_start_sessions
  add column if not exists interruption_count integer not null default 0,
  add column if not exists interruption_limit integer not null default 3,
  add column if not exists recovery_event_keys jsonb not null default '[]'::jsonb,
  add column if not exists last_recovery_event_key text,
  add column if not exists last_recovery_at timestamptz;

create or replace function public.authorize_exam_start(p_exam_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.exams;
  started timestamptz;
  latest_submitted timestamptz;
  used_attempts integer;
  max_attempts integer;
begin
  select * into e from public.exams where id = p_exam_id for update;

  if e.id is null
     or not exists (
       select 1
       from public.profiles
       where id = auth.uid()
         and role = 'Student'
         and status = 'Active'
     ) then
    raise exception 'Exam access denied.';
  end if;

  select count(*)::integer, max(submitted_at)
  into used_attempts, latest_submitted
  from public.exam_attempts
  where exam_id = e.id
    and student_id = auth.uid();

  max_attempts := public.exam_attempt_limit(e.exam_settings);

  if max_attempts is not null and used_attempts >= max_attempts then
    raise exception 'You have used all available attempts for this exam.';
  end if;

  select started_at
  into started
  from public.exam_start_sessions
  where exam_id = e.id
    and student_id = auth.uid();

  if started is not null and not exists (
    select 1
    from public.exam_attempts
    where exam_id = e.id
      and student_id = auth.uid()
      and submission_session_started_at = started
  ) then
    return started;
  end if;

  if lower(e.status) not in ('published', 'active')
     or coalesce((e.exam_settings->>'archived')::boolean, false)
     or not exists (
       select 1
       from public.course_enrollments ce
       join public.courses c on c.id = ce.course_id
       where ce.course_id = e.course_id
         and ce.student_id = auth.uid()
         and not c.archived
     ) then
    raise exception 'Exam is not available for your account.';
  end if;

  if nullif(e.exam_settings->>'startsAt', '')::timestamptz > now() then
    raise exception 'This exam is scheduled and has not started.';
  end if;

  if nullif(e.exam_settings->>'deadline', '')::timestamptz <= now() then
    raise exception 'This exam has expired.';
  end if;

  insert into public.exam_start_sessions (
    exam_id,
    student_id,
    started_at,
    interruption_count,
    interruption_limit,
    recovery_event_keys,
    last_recovery_event_key,
    last_recovery_at
  )
  values (e.id, auth.uid(), clock_timestamp(), 0, 3, '[]'::jsonb, null, null)
  on conflict (exam_id, student_id) do update set
    started_at = clock_timestamp(),
    interruption_count = 0,
    interruption_limit = 3,
    recovery_event_keys = '[]'::jsonb,
    last_recovery_event_key = null,
    last_recovery_at = null
  returning started_at into started;

  return started;
end;
$$;

create or replace function public.record_exam_interruption_recovery(p_exam_id uuid, p_recovery_event_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.exams;
  s public.exam_start_sessions;
  clean_event_key text;
  submitted_after_start boolean;
  resume_allowed boolean;
  should_auto_submit boolean;
begin
  clean_event_key := left(nullif(trim(coalesce(p_recovery_event_key, '')), ''), 120);
  if clean_event_key is null then
    raise exception 'Recovery event key is required.';
  end if;

  select * into e from public.exams where id = p_exam_id for update;

  if e.id is null
     or not exists (
       select 1
       from public.profiles
       where id = auth.uid()
         and role = 'Student'
         and status = 'Active'
     )
     or not public.student_can_take_exam(p_exam_id) then
    raise exception 'Exam access denied.';
  end if;

  select * into s
  from public.exam_start_sessions
  where exam_id = e.id
    and student_id = auth.uid()
  for update;

  if s.exam_id is null then
    raise exception 'Start this exam through the authorized exam flow.';
  end if;

  select exists (
    select 1
    from public.exam_attempts
    where exam_id = e.id
      and student_id = auth.uid()
      and submitted_at >= s.started_at
  ) into submitted_after_start;

  if submitted_after_start then
    raise exception 'This exam session has already been submitted.';
  end if;

  if not (coalesce(s.recovery_event_keys, '[]'::jsonb) ? clean_event_key) then
    update public.exam_start_sessions
    set interruption_count = interruption_count + 1,
        interruption_limit = coalesce(nullif(interruption_limit, 0), 3),
        recovery_event_keys = (
          select coalesce(jsonb_agg(value), '[]'::jsonb)
          from (
            select value
            from jsonb_array_elements_text(coalesce(recovery_event_keys, '[]'::jsonb) || to_jsonb(clean_event_key)) with ordinality as items(value, item_order)
            order by item_order desc
            limit 8
          ) recent
        ),
        last_recovery_event_key = clean_event_key,
        last_recovery_at = now()
    where exam_id = s.exam_id
      and student_id = s.student_id
    returning * into s;
  end if;

  resume_allowed := s.interruption_count <= s.interruption_limit;
  should_auto_submit := s.interruption_count > s.interruption_limit;

  return jsonb_build_object(
    'interruption_count', s.interruption_count,
    'interruption_limit', s.interruption_limit,
    'resume_allowed', resume_allowed,
    'should_auto_submit', should_auto_submit,
    'started_at', s.started_at,
    'last_recovery_at', s.last_recovery_at
  );
end;
$$;

revoke all on function public.record_exam_interruption_recovery(uuid, text) from public;
revoke all on function public.record_exam_interruption_recovery(uuid, text) from anon;
grant execute on function public.record_exam_interruption_recovery(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
