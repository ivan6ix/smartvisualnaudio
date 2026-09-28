-- Enforce finite attempt limits while allowing explicit Unlimited attempts.
begin;

create or replace function public.exam_attempt_limit(p_settings jsonb) returns integer
language sql immutable as $$
  select case
    when lower(coalesce(p_settings->>'attemptLimit', p_settings->>'attempts', 'Unlimited')) like '%unlimited%' then null
    when substring(coalesce(p_settings->>'attemptLimit', p_settings->>'attempts', '') from '\d+') is null then null
    else substring(coalesce(p_settings->>'attemptLimit', p_settings->>'attempts', '') from '\d+')::integer
  end
$$;

create or replace function public.authorize_exam_start(p_exam_id uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  e public.exams;
  started timestamptz;
  latest_submitted timestamptz;
  used_attempts integer;
  max_attempts integer;
begin
 select * into e from public.exams where id = p_exam_id for update;
 if e.id is null or not exists (select 1 from public.profiles where id=auth.uid() and role='Student' and status='Active') then raise exception 'Exam access denied.'; end if;

 select count(*)::integer, max(submitted_at) into used_attempts, latest_submitted
 from public.exam_attempts
 where exam_id=e.id and student_id=auth.uid();

 max_attempts := public.exam_attempt_limit(e.exam_settings);
 if max_attempts is not null and used_attempts >= max_attempts then
   raise exception 'You have used all available attempts for this exam.';
 end if;

 select started_at into started from public.exam_start_sessions where exam_id=e.id and student_id=auth.uid();
 if started is not null and (latest_submitted is null or latest_submitted < started) then return started; end if;

 if lower(e.status) not in ('published','active') or coalesce((e.exam_settings->>'archived')::boolean,false) or not exists (select 1 from public.course_enrollments ce join public.courses c on c.id=ce.course_id where ce.course_id=e.course_id and ce.student_id=auth.uid() and not c.archived) then raise exception 'Exam is not available for your account.'; end if;
 if nullif(e.exam_settings->>'startsAt','')::timestamptz > now() then raise exception 'This exam is scheduled and has not started.'; end if;
 if nullif(e.exam_settings->>'deadline','')::timestamptz <= now() then raise exception 'This exam has expired.'; end if;

 insert into public.exam_start_sessions(exam_id,student_id)
 values(e.id,auth.uid())
 on conflict (exam_id, student_id) do update set started_at=excluded.started_at
 returning started_at into started;
 return started;
end $$;

revoke all on function public.authorize_exam_start(uuid) from public;
grant execute on function public.authorize_exam_start(uuid) to authenticated;

create or replace function public.guard_exam_attempt_limit() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  e public.exams;
  used_attempts integer;
  max_attempts integer;
  started timestamptz;
  latest_submitted timestamptz;
begin
  select * into e from public.exams where id = new.exam_id for update;
  if e.id is null then raise exception 'Exam not found.'; end if;
  if new.student_id <> auth.uid() then raise exception 'Exam attempt access denied.'; end if;
  if lower(e.status) not in ('published','active') or coalesce((e.exam_settings->>'archived')::boolean,false) then raise exception 'Exam is not available for your account.'; end if;
  if not exists (select 1 from public.course_enrollments ce join public.courses c on c.id=ce.course_id where ce.course_id=e.course_id and ce.student_id=new.student_id and not c.archived) then raise exception 'Exam is not available for your account.'; end if;
  if nullif(e.exam_settings->>'startsAt','')::timestamptz > now() then raise exception 'This exam is scheduled and has not started.'; end if;

  select started_at into started from public.exam_start_sessions where exam_id=e.id and student_id=new.student_id;
  select max(submitted_at) into latest_submitted from public.exam_attempts where exam_id=e.id and student_id=new.student_id;
  if nullif(e.exam_settings->>'deadline','')::timestamptz <= now()
     and (started is null or started > nullif(e.exam_settings->>'deadline','')::timestamptz or (latest_submitted is not null and latest_submitted >= started)) then
    raise exception 'This exam has expired.';
  end if;

  select count(*)::integer into used_attempts
  from public.exam_attempts
  where exam_id = new.exam_id and student_id = new.student_id;

  max_attempts := public.exam_attempt_limit(e.exam_settings);
  if max_attempts is not null and used_attempts >= max_attempts then
    raise exception 'You have used all available attempts for this exam.';
  end if;

  return new;
end $$;

drop trigger if exists guard_exam_attempt_limit on public.exam_attempts;
create trigger guard_exam_attempt_limit
before insert on public.exam_attempts
for each row execute function public.guard_exam_attempt_limit();

notify pgrst, 'reload schema';
commit;
