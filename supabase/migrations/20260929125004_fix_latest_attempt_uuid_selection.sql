begin;

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

notify pgrst, 'reload schema';

commit;
