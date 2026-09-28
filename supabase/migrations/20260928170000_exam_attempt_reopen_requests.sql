begin;

create table if not exists public.exam_attempt_reopen_requests (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),
  reason text not null,
  status text not null default 'Pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  reopened_started_at timestamptz,
  original_submitted_at timestamptz,
  original_score numeric(6,2),
  original_earned_points numeric(8,2),
  original_max_points numeric(8,2),
  original_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_attempt_reopen_requests_one_per_attempt unique (attempt_id),
  constraint exam_attempt_reopen_requests_status_check check (status in ('Pending', 'Approved', 'Rejected')),
  constraint exam_attempt_reopen_requests_reason_check check (length(btrim(reason)) between 1 and 500),
  constraint exam_attempt_reopen_requests_review_check check (
    (status = 'Pending' and reviewed_by is null and reviewed_at is null)
    or (status in ('Approved', 'Rejected') and reviewed_by is not null and reviewed_at is not null)
  )
);

create index if not exists idx_exam_attempt_reopen_requests_exam_status
on public.exam_attempt_reopen_requests (exam_id, status, created_at desc);

create index if not exists idx_exam_attempt_reopen_requests_student_created
on public.exam_attempt_reopen_requests (student_id, created_at desc);

alter table public.exam_attempt_reopen_requests enable row level security;

drop policy if exists "reopen_requests_student_read" on public.exam_attempt_reopen_requests;
drop policy if exists "reopen_requests_professor_read" on public.exam_attempt_reopen_requests;

create policy "reopen_requests_student_read" on public.exam_attempt_reopen_requests
for select to authenticated
using (student_id = auth.uid() or requested_by = auth.uid());

create policy "reopen_requests_professor_read" on public.exam_attempt_reopen_requests
for select to authenticated
using (
  exists (
    select 1
    from public.exams e
    where e.id = exam_attempt_reopen_requests.exam_id
      and (e.professor_id = auth.uid() or e.created_by = auth.uid())
  )
);

create or replace function public.request_exam_attempt_reopen(p_attempt_id uuid, p_reason text)
returns public.exam_attempt_reopen_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_reason text := btrim(coalesce(p_reason, ''));
  profile_row public.profiles;
  attempt_row public.exam_attempts;
  exam_row public.exams;
  max_attempts integer;
  request_row public.exam_attempt_reopen_requests;
begin
  if length(clean_reason) = 0 then
    raise exception 'Reason is required.';
  end if;

  if length(clean_reason) > 500 then
    raise exception 'Reason must be 500 characters or fewer.';
  end if;

  select * into profile_row from public.profiles where id = auth.uid();
  if profile_row.id is null or profile_row.role <> 'Student' or profile_row.status <> 'Active' then
    raise exception 'Only active students can request reopening.';
  end if;

  select * into attempt_row
  from public.exam_attempts
  where id = p_attempt_id
  for update;

  if attempt_row.id is null or attempt_row.student_id <> auth.uid() then
    raise exception 'Attempt not found.';
  end if;

  if attempt_row.status = 'Reopened' then
    raise exception 'This attempt is already reopened.';
  end if;

  if attempt_row.submitted_at is null then
    raise exception 'Only submitted attempts can be reopened.';
  end if;

  if attempt_row.status not in ('Submitted', 'Pending Manual Grading', 'Manually Graded') then
    raise exception 'This attempt is not eligible for reopening.';
  end if;

  select * into exam_row from public.exams where id = attempt_row.exam_id for update;
  if exam_row.id is null then
    raise exception 'Exam not found.';
  end if;

  max_attempts := public.exam_attempt_limit(exam_row.exam_settings);
  if max_attempts is distinct from 1 then
    raise exception 'Only one-attempt exams can be reopened.';
  end if;

  if nullif(exam_row.exam_settings->>'deadline', '')::timestamptz <= now() then
    raise exception 'The exam deadline has passed. Reopening is no longer available.';
  end if;

  if not exists (
    select 1
    from public.course_enrollments ce
    join public.courses c on c.id = ce.course_id
    where ce.course_id = exam_row.course_id
      and ce.student_id = auth.uid()
      and not c.archived
  ) then
    raise exception 'Exam access denied.';
  end if;

  insert into public.exam_attempt_reopen_requests (
    attempt_id, exam_id, student_id, requested_by, reason,
    original_submitted_at, original_score, original_earned_points, original_max_points, original_status
  )
  values (
    attempt_row.id, attempt_row.exam_id, attempt_row.student_id, auth.uid(), clean_reason,
    attempt_row.submitted_at, attempt_row.score, attempt_row.earned_points, attempt_row.max_points, attempt_row.status
  )
  returning * into request_row;

  insert into public.logs (user_id, action, description)
  values (auth.uid(), 'Attempt Reopen Requested', 'A student requested reopening for an exam attempt.');

  insert into public.notifications (user_id, title, message, type, is_read)
  select
    coalesce(e.professor_id, e.created_by),
    'Attempt Reopen Request',
    coalesce(profile_row.full_name, profile_row.email, 'A student') || ' requested an attempt reopening.',
    'Attempt Reopen',
    false
  from public.exams e
  where e.id = attempt_row.exam_id
    and coalesce(e.professor_id, e.created_by) is not null;

  return request_row;
exception
  when unique_violation then
    raise exception 'A reopening request already exists for this attempt.';
end;
$$;

create or replace function public.review_exam_attempt_reopen_request(p_request_id uuid, p_decision text)
returns public.exam_attempt_reopen_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_decision text := initcap(lower(btrim(coalesce(p_decision, ''))));
  request_row public.exam_attempt_reopen_requests;
  attempt_row public.exam_attempts;
  exam_row public.exams;
  reviewer public.profiles;
begin
  if clean_decision not in ('Approved', 'Rejected') then
    raise exception 'Decision must be Approved or Rejected.';
  end if;

  select * into reviewer from public.profiles where id = auth.uid();
  if reviewer.id is null or reviewer.role <> 'Professor' or reviewer.status <> 'Active' then
    raise exception 'Only authorized professors can review reopening requests.';
  end if;

  select * into request_row
  from public.exam_attempt_reopen_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Reopening request not found.';
  end if;

  if request_row.status <> 'Pending' then
    raise exception 'This reopening request has already been reviewed.';
  end if;

  select * into attempt_row from public.exam_attempts where id = request_row.attempt_id for update;
  select * into exam_row from public.exams where id = request_row.exam_id for update;

  if exam_row.id is null
     or attempt_row.id is null
     or attempt_row.exam_id <> request_row.exam_id
     or attempt_row.student_id <> request_row.student_id then
    raise exception 'Reopening request is no longer valid.';
  end if;

  if not (exam_row.professor_id = auth.uid() or exam_row.created_by = auth.uid()) then
    raise exception 'You are not authorized to review this request.';
  end if;

  if clean_decision = 'Approved' then
    if public.exam_attempt_limit(exam_row.exam_settings) is distinct from 1 then
      raise exception 'Only one-attempt exams can be reopened.';
    end if;

    if nullif(exam_row.exam_settings->>'deadline', '')::timestamptz <= now() then
      raise exception 'The exam deadline has passed. This request can no longer be approved.';
    end if;

    update public.exam_attempts
    set status = 'Reopened',
        score = null,
        earned_points = null,
        max_points = null,
        submitted_at = null
    where id = attempt_row.id;
  end if;

  update public.exam_attempt_reopen_requests
  set status = clean_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  insert into public.logs (user_id, action, description)
  values (
    auth.uid(),
    case when clean_decision = 'Approved' then 'Attempt Reopen Approved' else 'Attempt Reopen Rejected' end,
    'A professor reviewed an attempt reopening request.'
  );

  insert into public.notifications (user_id, title, message, type, is_read)
  values (
    request_row.student_id,
    case when clean_decision = 'Approved' then 'Attempt Reopened' else 'Attempt Reopen Rejected' end,
    case when clean_decision = 'Approved'
      then 'Your reopening request was approved. You may reopen the exam before the deadline.'
      else 'Your reopening request was rejected.'
    end,
    'Attempt Reopen',
    false
  );

  return request_row;
end;
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
  reopened_attempt public.exam_attempts;
  reopen_request public.exam_attempt_reopen_requests;
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

  select * into reopened_attempt
  from public.exam_attempts
  where exam_id = e.id
    and student_id = auth.uid()
    and status = 'Reopened'
  order by submitted_at desc nulls last, id desc
  limit 1
  for update;

  if reopened_attempt.id is not null then
    max_attempts := public.exam_attempt_limit(e.exam_settings);
    if max_attempts is distinct from 1 then
      raise exception 'Only one-attempt exams can be reopened.';
    end if;

    if not public.student_can_take_exam(p_exam_id) then
      raise exception 'Exam is not available for your account.';
    end if;

    select * into reopen_request
    from public.exam_attempt_reopen_requests
    where attempt_id = reopened_attempt.id
      and exam_id = e.id
      and student_id = auth.uid()
      and status = 'Approved'
    for update;

    if reopen_request.id is null then
      raise exception 'Reopened attempt is missing approval.';
    end if;

    if nullif(e.exam_settings->>'startsAt', '')::timestamptz > now() then
      raise exception 'This exam is scheduled and has not started.';
    end if;

    if nullif(e.exam_settings->>'deadline', '')::timestamptz <= now() then
      raise exception 'Exam is not available for reopening.';
    end if;

    if reopen_request.reopened_started_at is null then
      started := clock_timestamp();

      insert into public.exam_start_sessions (
        exam_id, student_id, started_at, interruption_count, interruption_limit,
        recovery_event_keys, last_recovery_event_key, last_recovery_at
      )
      values (e.id, auth.uid(), started, 0, 3, '[]'::jsonb, null, null)
      on conflict (exam_id, student_id) do update set
        started_at = excluded.started_at,
        interruption_count = 0,
        interruption_limit = 3,
        recovery_event_keys = '[]'::jsonb,
        last_recovery_event_key = null,
        last_recovery_at = null;

      update public.exam_attempts
      set started_at = started,
          submission_session_started_at = started
      where id = reopened_attempt.id;

      update public.exam_attempt_reopen_requests
      set reopened_started_at = started,
          updated_at = now()
      where id = reopen_request.id;

      return started;
    end if;

    return reopen_request.reopened_started_at;
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
    exam_id, student_id, started_at, interruption_count, interruption_limit,
    recovery_event_keys, last_recovery_event_key, last_recovery_at
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

create or replace function public.submit_exam_attempt(p_exam_id uuid, p_answers jsonb, p_violations jsonb default '[]'::jsonb)
returns uuid
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
  v_attempt_id uuid;
  attempt_status text;
  approved_reopen_exists boolean := false;
  is_reopened boolean := false;
  answer_value jsonb;
  result jsonb;
  has_manual boolean := false;
  earned_total numeric := 0;
  max_total numeric := 0;
  q public.exam_questions;
begin
  select * into e from public.exams where id = p_exam_id for update;

  if e.id is null or not public.student_can_take_exam(p_exam_id) then
    raise exception 'Exam is not available for your account.';
  end if;

  if nullif(e.exam_settings->>'startsAt', '')::timestamptz > now() then
    raise exception 'This exam is scheduled and has not started.';
  end if;

  select started_at
  into started
  from public.exam_start_sessions
  where exam_id = e.id
    and student_id = auth.uid()
  for update;

  if started is null then
    raise exception 'Start this exam through the authorized exam flow.';
  end if;

  select id, status
  into v_attempt_id, attempt_status
  from public.exam_attempts
  where exam_id = e.id
    and student_id = auth.uid()
    and submission_session_started_at = started
  order by submitted_at desc nulls last
  limit 1
  for update;

  is_reopened := v_attempt_id is not null and attempt_status = 'Reopened';

  if is_reopened then
    max_attempts := public.exam_attempt_limit(e.exam_settings);
    select exists (
      select 1
      from public.exam_attempt_reopen_requests r
      where r.attempt_id = v_attempt_id
        and r.exam_id = e.id
        and r.student_id = auth.uid()
        and r.status = 'Approved'
    ) into approved_reopen_exists;

    is_reopened := approved_reopen_exists and max_attempts is not distinct from 1;

    if not is_reopened then
      raise exception 'Reopened attempt is not authorized.';
    end if;
  end if;

  if v_attempt_id is not null and not is_reopened then
    return v_attempt_id;
  end if;

  select count(*)::integer, max(submitted_at)
  into used_attempts, latest_submitted
  from public.exam_attempts
  where exam_id = e.id and student_id = auth.uid();

  max_attempts := public.exam_attempt_limit(e.exam_settings);
  if not is_reopened and max_attempts is not null and used_attempts >= max_attempts then
    raise exception 'You have used all available attempts for this exam.';
  end if;

  if nullif(e.exam_settings->>'deadline', '')::timestamptz <= now()
     and (is_reopened
          or started > nullif(e.exam_settings->>'deadline', '')::timestamptz
          or (latest_submitted is not null and latest_submitted >= started)) then
    raise exception 'This exam has expired.';
  end if;

  for q in select * from public.exam_questions where exam_id = e.id order by id loop
    answer_value := coalesce(p_answers->(q.id::text), 'null'::jsonb);
    result := public.grade_exam_answer(q, answer_value);
    has_manual := has_manual or coalesce((result->>'manual')::boolean, false);
    earned_total := earned_total + coalesce((result->>'earnedPoints')::numeric, 0);
    max_total := max_total + coalesce((result->>'maxPoints')::numeric, 0);
  end loop;

  earned_total := round(earned_total, 2);
  max_total := round(max_total, 2);

  if is_reopened then
    update public.exam_attempts
    set score = case when has_manual then null when max_total > 0 then round((earned_total / max_total) * 100, 2) else 0 end,
        earned_points = earned_total,
        max_points = max_total,
        violations = coalesce(p_violations, '[]'::jsonb),
        status = case when has_manual then 'Pending Manual Grading' else 'Submitted' end,
        started_at = started,
        submitted_at = now(),
        submission_session_started_at = started
    where id = v_attempt_id;

    delete from public.exam_attempt_answers where exam_attempt_answers.attempt_id = v_attempt_id;
  else
    insert into public.exam_attempts (
      exam_id, student_id, score, earned_points, max_points, violations, status,
      started_at, submitted_at, submission_session_started_at
    )
    values (
      e.id,
      auth.uid(),
      case when has_manual then null when max_total > 0 then round((earned_total / max_total) * 100, 2) else 0 end,
      earned_total,
      max_total,
      coalesce(p_violations, '[]'::jsonb),
      case when has_manual then 'Pending Manual Grading' else 'Submitted' end,
      started,
      now(),
      started
    )
    on conflict (exam_id, student_id, submission_session_started_at)
    where submission_session_started_at is not null
    do nothing
    returning id into v_attempt_id;

    if v_attempt_id is null then
      select id into v_attempt_id
      from public.exam_attempts
      where exam_id = e.id
        and student_id = auth.uid()
        and submission_session_started_at = started
      order by submitted_at desc nulls last
      limit 1;

      if v_attempt_id is null then
        raise exception 'Unable to finalize exam submission.';
      end if;

      return v_attempt_id;
    end if;
  end if;

  for q in select * from public.exam_questions where exam_id = e.id order by id loop
    answer_value := coalesce(p_answers->(q.id::text), 'null'::jsonb);
    result := public.grade_exam_answer(q, answer_value);

    insert into public.exam_attempt_answers (
      attempt_id, question_id, answer, file_url, earned_points, max_points,
      is_correct, needs_manual_grading
    )
    values (
      v_attempt_id,
      q.id,
      answer_value,
      nullif(answer_value->>'path', ''),
      nullif(result->>'earnedPoints', '')::numeric,
      round(nullif(result->>'maxPoints', '')::numeric, 2),
      coalesce((result->>'isCorrect')::boolean, false),
      coalesce((result->>'manual')::boolean, false)
    )
    on conflict (attempt_id, question_id) do update set
      answer = excluded.answer,
      file_url = excluded.file_url,
      earned_points = excluded.earned_points,
      max_points = excluded.max_points,
      is_correct = excluded.is_correct,
      needs_manual_grading = excluded.needs_manual_grading,
      graded_at = null,
      graded_by = null;
  end loop;

  if is_reopened then
    insert into public.logs (user_id, action, description)
    values (auth.uid(), 'Reopened Attempt Resubmitted', 'A reopened exam attempt was resubmitted.');
  end if;

  return v_attempt_id;
end;
$$;

revoke all on function public.request_exam_attempt_reopen(uuid, text) from public, anon;
grant execute on function public.request_exam_attempt_reopen(uuid, text) to authenticated;
revoke all on function public.review_exam_attempt_reopen_request(uuid, text) from public, anon;
grant execute on function public.review_exam_attempt_reopen_request(uuid, text) to authenticated;
revoke all on function public.authorize_exam_start(uuid) from public, anon;
grant execute on function public.authorize_exam_start(uuid) to authenticated;
revoke all on function public.submit_exam_attempt(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.submit_exam_attempt(uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
