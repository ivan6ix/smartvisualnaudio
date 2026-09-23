-- Reconcile hosted exam lifecycle logic without replaying older duplicate-version migrations.
-- This intentionally leaves already-verified program schema, guard_exam_changes(),
-- and delete_archived_exam() untouched.
begin;

create or replace function public.save_exam(p_id uuid, p_exam jsonb, p_questions jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  eid uuid;
  old_exam public.exams;
  q jsonb;
  starts timestamptz;
  ends timestamptz;
  is_draft boolean;
  exam_title text;
  course_uuid uuid;
  requested_status text;
  write_status text;
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'Professor'
      and status = 'Active'
  ) then
    raise exception 'Professor access required.';
  end if;

  requested_status := coalesce(p_exam->>'status', 'Draft');
  is_draft := requested_status = 'Draft';
  course_uuid := nullif(p_exam->>'course_id', '')::uuid;

  if course_uuid is null
     or not exists (
       select 1
       from public.courses
       where id = course_uuid
         and professor_id = auth.uid()
         and not archived
     ) then
    raise exception 'Select an assigned active course.';
  end if;

  exam_title := case
    when length(trim(coalesce(p_exam->>'title', ''))) > 0 then trim(p_exam->>'title')
    else 'Untitled Draft'
  end;

  if (not is_draft and length(trim(coalesce(p_exam->>'title', ''))) = 0)
     or length(exam_title) > 200 then
    raise exception 'Exam title is required and must be 200 characters or fewer.';
  end if;

  if length(coalesce(p_exam->'exam_settings'->>'description', '')) > 1000 then
    raise exception 'Description must be 1000 characters or fewer.';
  end if;

  if length(coalesce(p_exam->'exam_settings'->>'instructions', '')) > 5000 then
    raise exception 'Instructions must be 5000 characters or fewer.';
  end if;

  if nullif(p_exam->>'duration', '')::integer is not null
     and nullif(p_exam->>'duration', '')::integer not between 1 and 1440 then
    raise exception 'Duration must be 1 to 1440 minutes.';
  end if;

  if requested_status not in ('Draft', 'Pending Review', 'Published', 'Unpublished') then
    raise exception 'Unsupported exam status.';
  end if;

  write_status := case when requested_status = 'Published' then 'Unpublished' else requested_status end;
  starts := nullif(p_exam->'exam_settings'->>'startsAt', '')::timestamptz;
  ends := nullif(p_exam->'exam_settings'->>'deadline', '')::timestamptz;

  if ends <= starts then
    raise exception 'Deadline must be after the start.';
  end if;

  if (not is_draft and jsonb_array_length(p_questions) < 1)
     or jsonb_array_length(p_questions) > 500 then
    raise exception 'Add between 1 and 500 questions.';
  end if;

  for q in select value from jsonb_array_elements(p_questions) loop
    if length(trim(coalesce(q->>'question_text', ''))) = 0
       or length(q->>'question_text') > 5000
       or nullif(q->>'points', '')::numeric not between 0.01 and 1000 then
      raise exception 'Each question requires text (up to 5000 characters) and points from 0.01 to 1000.';
    end if;
  end loop;

  if p_id is not null then
    select *
    into old_exam
    from public.exams
    where id = p_id
      and (professor_id = auth.uid() or created_by = auth.uid())
    for update;

    if old_exam.id is null then
      raise exception 'Exam access denied.';
    end if;

    if lower(old_exam.status) not in ('draft', 'rejected', 'revision needed', 'unpublished') then
      raise exception 'Only drafts, rejected or unpublished exams can be edited.';
    end if;

    update public.exams
    set title = exam_title,
        exam_title = exam_title,
        course_id = course_uuid,
        description = p_exam->>'description',
        semester = p_exam->>'semester',
        exam_type = p_exam->>'exam_type',
        course = p_exam->>'course',
        exam_settings = p_exam->'exam_settings',
        duration = nullif(p_exam->>'duration', '')::integer,
        time_limit = nullif(p_exam->>'duration', '')::integer,
        questions_count = jsonb_array_length(p_questions),
        status = write_status,
        approved_at = case
          when old_exam.approved_at is not null and requested_status in ('Unpublished', 'Published') then old_exam.approved_at
          else null
        end,
        rejected_at = null,
        submitted_at = case when requested_status = 'Pending Review' then now() else old_exam.submitted_at end
    where id = p_id
    returning id into eid;

    delete from public.exam_questions where exam_id = eid;
  else
    insert into public.exams (
      course_id,
      title,
      exam_title,
      description,
      semester,
      exam_type,
      course,
      exam_settings,
      duration,
      time_limit,
      questions_count,
      status,
      created_by,
      professor_id,
      submitted_at,
      approved_at,
      rejected_at
    )
    values (
      course_uuid,
      exam_title,
      exam_title,
      p_exam->>'description',
      p_exam->>'semester',
      p_exam->>'exam_type',
      p_exam->>'course',
      p_exam->'exam_settings',
      nullif(p_exam->>'duration', '')::integer,
      nullif(p_exam->>'duration', '')::integer,
      jsonb_array_length(p_questions),
      write_status,
      auth.uid(),
      auth.uid(),
      case when requested_status = 'Pending Review' then now() else null end,
      null,
      null
    )
    returning id into eid;
  end if;

  insert into public.exam_questions (
    id,
    exam_id,
    question_text,
    question_type,
    choices,
    correct_answer,
    correct_answers,
    question_config,
    manual_grading,
    points
  )
  select
    coalesce(x.id, gen_random_uuid()),
    eid,
    x.question_text,
    x.question_type,
    x.choices,
    x.correct_answer,
    x.correct_answers,
    x.question_config,
    x.manual_grading,
    x.points
  from jsonb_to_recordset(p_questions) as x(
    id uuid,
    question_text text,
    question_type text,
    choices jsonb,
    correct_answer text,
    correct_answers jsonb,
    question_config jsonb,
    manual_grading boolean,
    points numeric
  );

  if requested_status = 'Published' then
    update public.exams set status = 'Published' where id = eid;
  end if;

  return eid;
end;
$$;

revoke all on function public.save_exam(uuid, jsonb, jsonb) from public;
grant execute on function public.save_exam(uuid, jsonb, jsonb) to authenticated;

create or replace function public.exam_attempt_limit(p_settings jsonb)
returns integer
language sql
immutable
as $$
  select case
    when lower(coalesce(p_settings->>'attemptLimit', p_settings->>'attempts', 'Unlimited')) like '%unlimited%' then null
    when substring(coalesce(p_settings->>'attemptLimit', p_settings->>'attempts', '') from '\d+') is null then null
    else substring(coalesce(p_settings->>'attemptLimit', p_settings->>'attempts', '') from '\d+')::integer
  end
$$;

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

  if started is not null and (latest_submitted is null or latest_submitted < started) then
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

  insert into public.exam_start_sessions (exam_id, student_id)
  values (e.id, auth.uid())
  on conflict (exam_id, student_id) do update set started_at = excluded.started_at
  returning started_at into started;

  return started;
end;
$$;

revoke all on function public.authorize_exam_start(uuid) from public;
grant execute on function public.authorize_exam_start(uuid) to authenticated;

create or replace function public.guard_exam_attempt_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.exams;
  used_attempts integer;
  max_attempts integer;
  started timestamptz;
  latest_submitted timestamptz;
begin
  select * into e from public.exams where id = new.exam_id for update;

  if e.id is null then
    raise exception 'Exam not found.';
  end if;

  if new.student_id <> auth.uid() then
    raise exception 'Exam attempt access denied.';
  end if;

  if lower(e.status) not in ('published', 'active')
     or coalesce((e.exam_settings->>'archived')::boolean, false) then
    raise exception 'Exam is not available for your account.';
  end if;

  if not exists (
    select 1
    from public.course_enrollments ce
    join public.courses c on c.id = ce.course_id
    where ce.course_id = e.course_id
      and ce.student_id = new.student_id
      and not c.archived
  ) then
    raise exception 'Exam is not available for your account.';
  end if;

  if nullif(e.exam_settings->>'startsAt', '')::timestamptz > now() then
    raise exception 'This exam is scheduled and has not started.';
  end if;

  select started_at
  into started
  from public.exam_start_sessions
  where exam_id = e.id
    and student_id = new.student_id;

  select max(submitted_at)
  into latest_submitted
  from public.exam_attempts
  where exam_id = e.id
    and student_id = new.student_id;

  if nullif(e.exam_settings->>'deadline', '')::timestamptz <= now()
     and (
       started is null
       or started > nullif(e.exam_settings->>'deadline', '')::timestamptz
       or (latest_submitted is not null and latest_submitted >= started)
     ) then
    raise exception 'This exam has expired.';
  end if;

  select count(*)::integer
  into used_attempts
  from public.exam_attempts
  where exam_id = new.exam_id
    and student_id = new.student_id;

  max_attempts := public.exam_attempt_limit(e.exam_settings);

  if max_attempts is not null and used_attempts >= max_attempts then
    raise exception 'You have used all available attempts for this exam.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_exam_attempt_limit on public.exam_attempts;
create trigger guard_exam_attempt_limit
before insert on public.exam_attempts
for each row execute function public.guard_exam_attempt_limit();

notify pgrst, 'reload schema';

commit;
