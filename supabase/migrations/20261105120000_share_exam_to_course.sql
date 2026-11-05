-- Share an exam to another course or section in one step.
-- The old browser code created the copy as Published and then tried to copy the
-- questions, which guard_exam_changes refuses for published exams. Every click
-- left an empty exam behind. This function copies the exam as Unpublished,
-- copies the questions, then gives the copy the source's status. Each copy
-- remembers its original in exam_settings.sharedFromExamId, so the same exam
-- can only be shared once to a course.
begin;

create or replace function public.share_exam_to_course(p_exam_id uuid, p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  source public.exams;
  target public.courses;
  root_id uuid;
  new_id uuid;
  question_total integer;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'Professor' and status = 'Active'
  ) then
    raise exception 'Professor access required.';
  end if;

  select * into source
  from public.exams
  where id = p_exam_id
    and (professor_id = auth.uid() or created_by = auth.uid());

  if source.id is null then
    raise exception 'Exam access denied.';
  end if;

  select * into target
  from public.courses
  where id = p_course_id
    and professor_id = auth.uid()
    and not coalesce(archived, false);

  if target.id is null then
    raise exception 'Select one of your active courses.';
  end if;

  if target.id = source.course_id then
    raise exception 'This exam is already in that course.';
  end if;

  root_id := coalesce(nullif(source.exam_settings->>'sharedFromExamId', '')::uuid, source.id);

  -- Repeated clicks wait here, then see the copy the first click made.
  perform pg_advisory_xact_lock(hashtext('share_exam:' || root_id::text || ':' || target.id::text));

  if exists (
    select 1 from public.exams e
    where e.course_id = target.id
      and not coalesce((e.exam_settings->>'archived')::boolean, false)
      and (e.id = root_id or e.exam_settings->>'sharedFromExamId' = root_id::text)
  ) then
    raise exception 'This exam is already shared to %.', target.course_code || ' - ' || target.section;
  end if;

  select count(*) into question_total from public.exam_questions where exam_id = source.id;
  if question_total = 0 then
    raise exception 'Add at least one question before sharing this exam.';
  end if;

  insert into public.exams (
    course_id, title, exam_title, description, semester, course,
    professor_id, created_by, exam_type, duration, time_limit, passing_score,
    exam_settings, assignment_mode, questions_count, status
  )
  values (
    target.id, source.title, coalesce(source.exam_title, source.title), source.description, source.semester,
    target.course_code || ' - ' || target.section,
    auth.uid(), auth.uid(), source.exam_type,
    coalesce(source.time_limit, source.duration), coalesce(source.time_limit, source.duration), source.passing_score,
    (coalesce(source.exam_settings, '{}'::jsonb) - 'archived') || jsonb_build_object('sharedFromExamId', root_id::text),
    'entire_course', question_total, 'Unpublished'
  )
  returning id into new_id;

  insert into public.exam_questions (
    exam_id, question_text, question_type, choices, correct_answer, correct_answers,
    question_config, manual_grading, points, sort_order
  )
  select new_id, q.question_text, q.question_type, q.choices, q.correct_answer, q.correct_answers,
    q.question_config, q.manual_grading, q.points, q.sort_order
  from public.exam_questions q
  where q.exam_id = source.id
  order by q.sort_order nulls last, q.id;

  -- A published exam is shared as published. Anything else is shared as Unpublished.
  if lower(source.status) in ('published', 'active') then
    update public.exams
    set status = 'Published', approved_at = source.approved_at, submitted_at = source.submitted_at
    where id = new_id;
  end if;

  return new_id;
end;
$$;

revoke all on function public.share_exam_to_course(uuid, uuid) from public, anon;
grant execute on function public.share_exam_to_course(uuid, uuid) to authenticated;

-- Sharing to a student again only refreshes the access. The student gets one notification.
create or replace function public.grant_exam_student_exception(
  p_exam_id uuid,
  p_student_id uuid,
  p_allow_after_deadline boolean default true,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  exam_row public.exams;
  already_shared boolean;
begin
  select * into exam_row
  from public.exams
  where id = p_exam_id
    and (professor_id = auth.uid() or created_by = auth.uid())
  for update;

  if exam_row.id is null then
    raise exception 'Exam access denied.';
  end if;

  if not exists (
    select 1
    from public.course_enrollments ce
    join public.profiles p on p.id = ce.student_id
    where ce.course_id = exam_row.course_id
      and ce.student_id = p_student_id
      and p.role = 'Student'
      and p.status = 'Active'
  ) then
    raise exception 'Shared student must be an active enrolled student.';
  end if;

  select exists (
    select 1 from public.exam_student_access_exceptions
    where exam_id = p_exam_id and student_id = p_student_id
  ) into already_shared;

  insert into public.exam_student_access_exceptions (
    exam_id, student_id, granted_by, allow_after_deadline, reason
  )
  values (
    p_exam_id, p_student_id, auth.uid(), coalesce(p_allow_after_deadline, true), nullif(btrim(coalesce(p_reason, '')), '')
  )
  on conflict (exam_id, student_id) do update set
    granted_by = excluded.granted_by,
    granted_at = now(),
    allow_after_deadline = excluded.allow_after_deadline,
    reason = excluded.reason;

  if not already_shared then
    insert into public.notifications (user_id, title, message, type, is_read, entity_type, entity_id, action_path)
    values (
      p_student_id,
      'Exam Shared',
      coalesce(exam_row.exam_title, exam_row.title, 'An exam') || ' was shared with you.',
      'Exam',
      false,
      'exam',
      p_exam_id,
      '/student/courses/' || exam_row.course_id::text || '/assessments'
    );
  end if;

  return p_exam_id;
end;
$$;

revoke all on function public.grant_exam_student_exception(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.grant_exam_student_exception(uuid, uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
commit;
