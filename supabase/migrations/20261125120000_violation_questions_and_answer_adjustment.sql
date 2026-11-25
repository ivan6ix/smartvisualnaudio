-- Violations record the question that was on screen, and professors can adjust an answer's points with a note.
-- Safe to re-run: columns, index and function are created only when missing or replaced in place.
begin;

-- question_number is the question's position in the professor's order (by sort_order), not the student's page.
alter table public.violations
  add column if not exists question_id uuid references public.exam_questions(id) on delete set null,
  add column if not exists question_number integer check (question_number is null or question_number > 0);
create index if not exists violations_attempt_question_idx on public.violations (exam_id, student_id, question_id);

alter table public.exam_attempt_answers add column if not exists grading_note text
  check (grading_note is null or char_length(grading_note) <= 300);

-- Same checks as grade_exam_attempt_answer, for any question type, with a required note explaining the change.
create or replace function public.adjust_exam_attempt_answer(p_answer_id uuid, p_earned_points numeric, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  answer_row public.exam_attempt_answers;
  attempt_row public.exam_attempts;
  exam_row public.exams;
  clean_points numeric;
  clean_note text;
  totals jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'Professor'
      and status = 'Active'
  ) then
    raise exception 'Only active professors can adjust exam answers.';
  end if;

  select * into answer_row
  from public.exam_attempt_answers
  where id = p_answer_id
  for update;

  if answer_row.id is null then
    raise exception 'Answer not found.';
  end if;

  select * into attempt_row
  from public.exam_attempts
  where id = answer_row.attempt_id
  for update;

  select * into exam_row
  from public.exams
  where id = attempt_row.exam_id;

  if exam_row.id is null
     or (exam_row.professor_id is distinct from auth.uid() and exam_row.created_by is distinct from auth.uid()) then
    raise exception 'Answer adjustment denied.';
  end if;

  if answer_row.max_points is null then
    raise exception 'Answer max points snapshot is missing.';
  end if;

  clean_points := round(p_earned_points, 2);
  if clean_points is null or clean_points < 0 or clean_points > answer_row.max_points then
    raise exception 'Earned points must be between 0 and %.', answer_row.max_points;
  end if;

  clean_note := btrim(coalesce(p_note, ''));
  if char_length(clean_note) not between 1 and 300 then
    raise exception 'A note of 1 to 300 characters is required.';
  end if;

  update public.exam_attempt_answers
  set earned_points = clean_points,
      is_correct = clean_points >= answer_row.max_points,
      needs_manual_grading = false,
      graded_at = now(),
      graded_by = auth.uid(),
      grading_note = clean_note
  where id = answer_row.id;

  totals := public.recalculate_exam_attempt_score(answer_row.attempt_id);
  return totals || jsonb_build_object('answer_id', answer_row.id, 'earned_points', clean_points, 'grading_note', clean_note);
end;
$$;

revoke all on function public.adjust_exam_attempt_answer(uuid, numeric, text) from public;
revoke all on function public.adjust_exam_attempt_answer(uuid, numeric, text) from anon;
grant execute on function public.adjust_exam_attempt_answer(uuid, numeric, text) to authenticated;

-- Ongoing Exams lists each student's violations from this function; it now includes the question number.
-- Copied from 20260929125004_fix_latest_attempt_uuid_selection.sql with only the 'question_number' key added.
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
  latest_attempts as (
    select
      exam_id,
      student_id,
      id as latest_attempt_id
    from attempt_ranked
    where attempt_number_desc = 1
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
      ) order by ar.attempt_number desc) as attempts
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
        'question_number', v.question_number,
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
      la.latest_attempt_id,
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
    left join latest_attempts la
      on la.exam_id = p.exam_id
     and la.student_id = p.student_id
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
          'latestAttemptId', s.latest_attempt_id,
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

revoke all on function public.get_professor_ongoing_exams() from public, anon;
grant execute on function public.get_professor_ongoing_exams() to authenticated;

-- Students may update their own violations only to attach evidence (violations_student_update_own). The question
-- columns are trusted like the type and time, so the latest trigger function (20260922103000) is redefined with
-- them; the trigger itself already calls this function and is unchanged.
create or replace function public.protect_student_violation_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if auth.uid() = old.student_id then
    if new.id is distinct from old.id
       or new.student_id is distinct from old.student_id
       or new.exam_id is distinct from old.exam_id
       or new.course_id is distinct from old.course_id
       or new.professor_id is distinct from old.professor_id
       or new.violation_type is distinct from old.violation_type
       or new.severity is distinct from old.severity
       or new.created_at is distinct from old.created_at
       or new.question_id is distinct from old.question_id
       or new.question_number is distinct from old.question_number then
      raise exception 'Trusted violation fields cannot be changed by students.';
    end if;

    if old.screenshot_url is not null and new.screenshot_url is distinct from old.screenshot_url then
      raise exception 'Violation screenshot evidence cannot be changed after it is attached.';
    end if;
    if old.evidence_url is not null and new.evidence_url is distinct from old.evidence_url then
      raise exception 'Violation evidence cannot be changed after it is attached.';
    end if;
    if old.evidence_type is not null and new.evidence_type is distinct from old.evidence_type then
      raise exception 'Violation evidence type cannot be changed after it is attached.';
    end if;
    if old.audio_level is not null and new.audio_level is distinct from old.audio_level then
      raise exception 'Violation audio level cannot be changed after it is attached.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_student_violation_updates() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
