begin;

create table if not exists public.professor_ongoing_exam_dismissals (
  professor_id uuid not null references public.profiles(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (professor_id, exam_id)
);

alter table public.professor_ongoing_exam_dismissals enable row level security;

create index if not exists professor_ongoing_exam_dismissals_exam_idx
  on public.professor_ongoing_exam_dismissals(exam_id, professor_id);

alter table public.exam_attempts
  add column if not exists submission_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_attempts_submission_reason_check'
      and conrelid = 'public.exam_attempts'::regclass
  ) then
    alter table public.exam_attempts
      add constraint exam_attempts_submission_reason_check
      check (submission_reason is null or submission_reason in ('student', 'violation_limit'));
  end if;
end $$;

create index if not exists exam_attempts_exam_student_session_idx
  on public.exam_attempts(exam_id, student_id, submission_session_started_at desc nulls last, submitted_at desc nulls last);

create index if not exists exam_attempt_answers_attempt_question_idx
  on public.exam_attempt_answers(attempt_id, question_id);

create index if not exists violations_exam_student_created_idx
  on public.violations(exam_id, student_id, created_at desc);

drop policy if exists "professor_ongoing_dismissals_read_own" on public.professor_ongoing_exam_dismissals;
drop policy if exists "professor_ongoing_dismissals_manage_own" on public.professor_ongoing_exam_dismissals;

create policy "professor_ongoing_dismissals_read_own"
on public.professor_ongoing_exam_dismissals
for select to authenticated
using (professor_id = auth.uid());

create policy "professor_ongoing_dismissals_manage_own"
on public.professor_ongoing_exam_dismissals
for all to authenticated
using (
  professor_id = auth.uid()
  and exists (
    select 1 from public.exams e
    where e.id = professor_ongoing_exam_dismissals.exam_id
      and (e.professor_id = auth.uid() or e.created_by = auth.uid())
  )
)
with check (
  professor_id = auth.uid()
  and exists (
    select 1 from public.exams e
    where e.id = professor_ongoing_exam_dismissals.exam_id
      and (e.professor_id = auth.uid() or e.created_by = auth.uid())
  )
);

create or replace function public.dismiss_professor_ongoing_exam(p_exam_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'Professor'
      and status = 'Active'
  ) then
    raise exception 'Only active professors can dismiss ongoing exams.';
  end if;

  if not exists (
    select 1
    from public.exams e
    where e.id = p_exam_id
      and (e.professor_id = auth.uid() or e.created_by = auth.uid())
  ) then
    raise exception 'Exam access denied.';
  end if;

  insert into public.professor_ongoing_exam_dismissals (professor_id, exam_id)
  values (auth.uid(), p_exam_id)
  on conflict (professor_id, exam_id) do update set dismissed_at = excluded.dismissed_at;

  return p_exam_id;
end;
$$;

create or replace function public.get_professor_ongoing_exams()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'Professor'
      and status = 'Active'
  ) then
    raise exception 'Only active professors can view ongoing exams.';
  end if;

  with owned_exams as (
    select
      e.id,
      coalesce(e.exam_title, e.title, 'Untitled exam') as title,
      e.exam_type,
      e.status,
      e.exam_settings,
      e.assignment_mode,
      e.course_id,
      c.course_code,
      c.course_name,
      c.section,
      nullif(e.exam_settings->>'startsAt', '')::timestamptz as starts_at,
      nullif(e.exam_settings->>'deadline', '')::timestamptz as deadline_at,
      (d.exam_id is not null) as dismissed
    from public.exams e
    left join public.courses c on c.id = e.course_id
    left join public.professor_ongoing_exam_dismissals d
      on d.exam_id = e.id
     and d.professor_id = auth.uid()
    where (e.professor_id = auth.uid() or e.created_by = auth.uid())
      and lower(e.status) in ('published', 'active')
      and not coalesce((e.exam_settings->>'archived')::boolean, false)
      and (
        nullif(e.exam_settings->>'startsAt', '') is null
        or nullif(e.exam_settings->>'startsAt', '')::timestamptz <= now()
        or nullif(e.exam_settings->>'startsAt', '')::timestamptz > now()
      )
  ),
  visible_exams as (
    select *,
      case
        when starts_at is not null and starts_at > now() then 'upcoming'
        when deadline_at is not null and deadline_at <= now() then 'finished'
        else 'active'
      end as phase
    from owned_exams
    where not dismissed
  ),
  populations as (
    select distinct e.id as exam_id, ce.student_id
    from visible_exams e
    join public.course_enrollments ce on ce.course_id = e.course_id
    where e.assignment_mode = 'entire_course'
    union
    select distinct e.id, a.student_id
    from visible_exams e
    join public.exam_student_assignments a on a.exam_id = e.id
    where e.assignment_mode = 'selected_students'
    union
    select distinct e.id, x.student_id
    from visible_exams e
    join public.exam_student_access_exceptions x on x.exam_id = e.id
  ),
  question_counts as (
    select exam_id, count(*)::integer as question_count
    from public.exam_questions
    where exam_id in (select id from visible_exams)
    group by exam_id
  ),
  attempt_ranked as (
    select
      a.*,
      row_number() over (
        partition by a.exam_id, a.student_id
        order by coalesce(a.submission_session_started_at, a.started_at, a.submitted_at) desc nulls last, a.submitted_at desc nulls last, a.id desc
      ) as attempt_number_desc,
      row_number() over (
        partition by a.exam_id, a.student_id
        order by coalesce(a.submission_session_started_at, a.started_at, a.submitted_at) asc nulls last, a.submitted_at asc nulls last, a.id asc
      ) as attempt_number
    from public.exam_attempts a
    where a.exam_id in (select id from visible_exams)
  ),
  attempt_progress as (
    select
      ar.id as attempt_id,
      count(aa.id) filter (
        where (
          q.question_type = 'File Upload'
          and nullif(aa.file_url, '') is not null
        ) or (
          q.question_type is distinct from 'File Upload'
          and aa.answer is not null
          and aa.answer <> 'null'::jsonb
        )
      )::integer as answered_count
    from attempt_ranked ar
    left join public.exam_attempt_answers aa on aa.attempt_id = ar.id
    left join public.exam_questions q on q.id = aa.question_id
    group by ar.id
  ),
  attempts_json as (
    select
      ar.exam_id,
      ar.student_id,
      jsonb_agg(jsonb_build_object(
        'id', ar.id,
        'attemptNumber', ar.attempt_number,
        'status', ar.status,
        'started_at', ar.started_at,
        'submitted_at', ar.submitted_at,
        'submission_session_started_at', ar.submission_session_started_at,
        'submission_reason', ar.submission_reason,
        'answeredCount', coalesce(ap.answered_count, 0),
        'questionCount', coalesce(qc.question_count, 0),
        'violationCount', coalesce(jsonb_array_length(ar.violations), 0)
      ) order by ar.attempt_number desc) as attempts,
      max(ar.id) filter (where ar.attempt_number_desc = 1) as latest_attempt_id
    from attempt_ranked ar
    left join attempt_progress ap on ap.attempt_id = ar.id
    left join question_counts qc on qc.exam_id = ar.exam_id
    group by ar.exam_id, ar.student_id
  ),
  violation_json as (
    select
      v.exam_id,
      v.student_id,
      count(*)::integer as violation_count,
      jsonb_agg(jsonb_build_object(
        'id', v.id,
        'violation_type', v.violation_type,
        'severity', v.severity,
        'description', v.description,
        'evidence_type', v.evidence_type,
        'evidence_url', v.evidence_url,
        'screenshot_url', v.screenshot_url,
        'audio_level', v.audio_level,
        'created_at', v.created_at
      ) order by v.created_at desc) as violations
    from public.violations v
    where v.exam_id in (select id from visible_exams)
    group by v.exam_id, v.student_id
  ),
  students as (
    select
      p.exam_id,
      p.student_id,
      coalesce(pr.full_name, pr.email, 'Unknown student') as student_name,
      pr.student_number,
      pr.email,
      ess.started_at as session_started_at,
      ess.interruption_count,
      ess.interruption_limit,
      coalesce(aj.attempts, '[]'::jsonb) as attempts,
      coalesce(vj.violation_count, 0) as violation_count,
      coalesce(vj.violations, '[]'::jsonb) as violations,
      coalesce(qc.question_count, 0) as question_count
    from populations p
    left join public.profiles pr on pr.id = p.student_id
    left join public.exam_start_sessions ess
      on ess.exam_id = p.exam_id
     and ess.student_id = p.student_id
    left join attempts_json aj
      on aj.exam_id = p.exam_id
     and aj.student_id = p.student_id
    left join violation_json vj
      on vj.exam_id = p.exam_id
     and vj.student_id = p.student_id
    left join question_counts qc on qc.exam_id = p.exam_id
  ),
  exam_json as (
    select
      e.phase,
      jsonb_build_object(
        'id', e.id,
        'title', e.title,
        'courseCode', e.course_code,
        'courseName', e.course_name,
        'section', e.section,
        'examType', e.exam_type,
        'status', e.status,
        'startsAt', e.starts_at,
        'deadline', e.deadline_at,
        'phase', e.phase,
        'students', coalesce(jsonb_agg(jsonb_build_object(
          'studentId', s.student_id,
          'studentName', s.student_name,
          'studentNumber', s.student_number,
          'email', s.email,
          'start', case when s.session_started_at is null then null else jsonb_build_object(
            'started_at', s.session_started_at,
            'interruption_count', s.interruption_count,
            'interruption_limit', s.interruption_limit
          ) end,
          'attempts', s.attempts,
          'questionCount', s.question_count,
          'violationCount', s.violation_count,
          'violations', s.violations
        ) order by s.student_name) filter (where s.student_id is not null), '[]'::jsonb)
      ) as exam
    from visible_exams e
    left join students s on s.exam_id = e.id
    group by e.id, e.title, e.course_code, e.course_name, e.section, e.exam_type, e.status, e.starts_at, e.deadline_at, e.phase
  )
  select jsonb_build_object(
    'serverNow', now(),
    'active', coalesce(jsonb_agg(exam order by exam->>'deadline') filter (where phase = 'active'), '[]'::jsonb),
    'finished', coalesce(jsonb_agg(exam order by exam->>'deadline' desc) filter (where phase = 'finished'), '[]'::jsonb),
    'upcoming', coalesce(jsonb_agg(exam order by exam->>'startsAt') filter (where phase = 'upcoming'), '[]'::jsonb)
  )
  into result
  from exam_json;

  return coalesce(result, jsonb_build_object('serverNow', now(), 'active', '[]'::jsonb, 'finished', '[]'::jsonb, 'upcoming', '[]'::jsonb));
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
  has_deadline_exception boolean := false;
  answer_value jsonb;
  result jsonb;
  has_manual boolean := false;
  earned_total numeric := 0;
  max_total numeric := 0;
  submit_reason text := 'student';
  q public.exam_questions;
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
      nullif(result->>'fileUrl', '')
    );
  end loop;

  return v_attempt_id;
end;
$$;

revoke all on function public.get_professor_ongoing_exams() from public, anon;
revoke all on function public.dismiss_professor_ongoing_exam(uuid) from public, anon;
revoke all on function public.submit_exam_attempt(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.get_professor_ongoing_exams() to authenticated;
grant execute on function public.dismiss_professor_ongoing_exam(uuid) to authenticated;
grant execute on function public.submit_exam_attempt(uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
