-- Restore exam_attempt_answers.file_url for File Upload answers.
-- 20260928190000 changed the answer insert to read result->>'fileUrl', which grade_exam_answer never
-- returns, so file_url stayed null. exam_submissions_professor_read matches objects through file_url,
-- so professors could not open any uploaded submission.
-- Only a path in the submitting student's own exam/question folder that exists in storage is recorded,
-- because the answer JSON is student-supplied and file_url grants professor read access.

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
  has_deadline_exception boolean := false;
  answer_value jsonb;
  result jsonb;
  has_manual boolean := false;
  earned_total numeric := 0;
  max_total numeric := 0;
  submit_reason text := 'student';
  q public.exam_questions;
  submitted_path text;
begin
  select * into e from public.exams where id = p_exam_id for update;

  if e.id is null or not public.student_can_take_exam(p_exam_id) then
    raise exception 'Exam is not available for your account.';
  end if;

  has_deadline_exception := public.student_has_exam_deadline_exception(p_exam_id);

  if nullif(e.exam_settings->>'startsAt', '')::timestamptz > now() then
    raise exception 'This exam is scheduled and has not started.';
  end if;

  select started_at into started
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
     and not has_deadline_exception
     and (is_reopened
          or started > nullif(e.exam_settings->>'deadline', '')::timestamptz
          or (latest_submitted is not null and latest_submitted >= started)) then
    raise exception 'This exam has expired.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(coalesce(p_violations, '[]'::jsonb)) = 'array' then coalesce(p_violations, '[]'::jsonb) else '[]'::jsonb end) item
    where item->>'submissionReason' = 'violation_limit'
  ) then
    submit_reason := 'violation_limit';
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
        submission_reason = submit_reason,
        started_at = started,
        submitted_at = now(),
        submission_session_started_at = started
    where id = v_attempt_id;
  else
    insert into public.exam_attempts (
      exam_id, student_id, score, earned_points, max_points, status, violations, submission_reason, started_at, submitted_at, submission_session_started_at
    )
    values (
      e.id,
      auth.uid(),
      case when has_manual then null when max_total > 0 then round((earned_total / max_total) * 100, 2) else 0 end,
      earned_total,
      max_total,
      case when has_manual then 'Pending Manual Grading' else 'Submitted' end,
      coalesce(p_violations, '[]'::jsonb),
      submit_reason,
      started,
      now(),
      started
    )
    returning id into v_attempt_id;
  end if;

  delete from public.exam_attempt_answers where attempt_id = v_attempt_id;

  for q in select * from public.exam_questions where exam_id = e.id order by id loop
    answer_value := coalesce(p_answers->(q.id::text), 'null'::jsonb);
    result := public.grade_exam_answer(q, answer_value);

    -- Record the upload path only for File Upload answers stored under student/exam/question in exam-submissions.
    submitted_path := case when q.question_type = 'File Upload' and jsonb_typeof(answer_value) = 'object' then nullif(answer_value->>'path', '') end;
    if submitted_path is not null and not (
      starts_with(submitted_path, auth.uid()::text || '/' || e.id::text || '/' || q.id::text || '/')
      and exists (select 1 from storage.objects o where o.bucket_id = 'exam-submissions' and o.name = submitted_path)
    ) then
      submitted_path := null;
    end if;

    insert into public.exam_attempt_answers (
      attempt_id, question_id, answer, earned_points, max_points, is_correct, needs_manual_grading, file_url
    )
    values (
      v_attempt_id,
      q.id,
      answer_value,
      (result->>'earnedPoints')::numeric,
      (result->>'maxPoints')::numeric,
      coalesce((result->>'correct')::boolean, false),
      coalesce((result->>'manual')::boolean, false),
      submitted_path
    );
  end loop;

  return v_attempt_id;
end;
$$;

revoke all on function public.submit_exam_attempt(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.submit_exam_attempt(uuid, jsonb, jsonb) to authenticated;

-- Backfill answers submitted since the regression, with the same folder and existence checks.
-- Only file_url changes, so audit_manual_grading_changes (earned_points/needs_manual_grading/graded_by) does not fire.
update public.exam_attempt_answers aa
set file_url = aa.answer->>'path'
from public.exam_attempts a, public.exam_questions q
where a.id = aa.attempt_id
  and q.id = aa.question_id
  and q.exam_id = a.exam_id
  and q.question_type = 'File Upload'
  and nullif(aa.file_url, '') is null
  and jsonb_typeof(aa.answer) = 'object'
  and nullif(aa.answer->>'path', '') is not null
  and starts_with(aa.answer->>'path', a.student_id::text || '/' || a.exam_id::text || '/' || q.id::text || '/')
  and exists (select 1 from storage.objects o where o.bucket_id = 'exam-submissions' and o.name = aa.answer->>'path');

notify pgrst, 'reload schema';
