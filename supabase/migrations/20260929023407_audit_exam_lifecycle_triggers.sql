begin;

create or replace function public.audit_exam_lifecycle_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  event_name text;
  action_name text;
  description_text text;
begin
  if actor is null then
    return new;
  end if;

  select role::text into actor_role from public.profiles where id = actor;

  if tg_op = 'INSERT' then
    event_name := case when new.status = 'Pending Review' then 'exam.submitted_for_review' else 'exam.created' end;
    action_name := case when new.status = 'Pending Review' then 'Exam Submitted For Review' else 'Exam Created' end;
    description_text := case when new.status = 'Pending Review' then 'A professor created and submitted an exam for review.' else 'A professor created an exam.' end;
  elsif old.assignment_mode is distinct from new.assignment_mode then
    event_name := 'exam.assignment_changed';
    action_name := 'Exam Assignment Changed';
    description_text := 'A professor changed an exam assignment mode.';
  elsif old.status is distinct from new.status then
    event_name := case
      when new.status = 'Pending Review' then 'exam.submitted_for_review'
      when new.status = 'Published' then 'exam.published'
      when new.status = 'Unpublished' then 'exam.returned'
      when new.status = 'Rejected' then 'exam.rejected'
      else 'exam.status_changed'
    end;
    action_name := case
      when new.status = 'Pending Review' then 'Exam Submitted For Review'
      when new.status = 'Published' then 'Exam Published'
      when new.status = 'Unpublished' then 'Exam Returned'
      when new.status = 'Rejected' then 'Exam Rejected'
      else 'Exam Status Changed'
    end;
    description_text := 'An exam lifecycle status changed.';
  else
    return new;
  end if;

  perform public.write_audit_log(
    actor, actor_role, event_name, action_name, description_text,
    'exam', new.id, coalesce(new.professor_id, new.created_by),
    jsonb_build_object('status', new.status, 'course_id', new.course_id)
  );

  return new;
end;
$$;

drop trigger if exists audit_exam_lifecycle_changes on public.exams;
create trigger audit_exam_lifecycle_changes
after insert or update of status, assignment_mode on public.exams
for each row execute function public.audit_exam_lifecycle_changes();

create or replace function public.audit_exam_access_exception_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
begin
  if actor is null then
    return coalesce(new, old);
  end if;

  select role::text into actor_role from public.profiles where id = actor;
  perform public.write_audit_log(
    actor, actor_role,
    case when tg_op = 'DELETE' then 'exam.access_exception_revoked' else 'exam.access_exception_granted' end,
    case when tg_op = 'DELETE' then 'Exam Access Exception Revoked' else 'Exam Access Exception Granted' end,
    case when tg_op = 'DELETE' then 'A professor revoked specific-student exam access.' else 'A professor granted specific-student exam access.' end,
    'exam', coalesce(new.exam_id, old.exam_id), coalesce(new.student_id, old.student_id),
    jsonb_build_object('allow_after_deadline', coalesce(new.allow_after_deadline, old.allow_after_deadline))
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_exam_access_exception_changes on public.exam_student_access_exceptions;
create trigger audit_exam_access_exception_changes
after insert or update or delete on public.exam_student_access_exceptions
for each row execute function public.audit_exam_access_exception_changes();

create or replace function public.audit_manual_grading_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  attempt_exam_id uuid;
  attempt_student_id uuid;
begin
  if actor is null or new.graded_by is null or new.graded_by is distinct from actor then
    return new;
  end if;

  if old.earned_points is not distinct from new.earned_points
     and old.needs_manual_grading is not distinct from new.needs_manual_grading then
    return new;
  end if;

  select role::text into actor_role from public.profiles where id = actor;
  select exam_id, student_id into attempt_exam_id, attempt_student_id
  from public.exam_attempts
  where id = new.attempt_id;

  perform public.write_audit_log(
    actor, actor_role, 'grading.manual_updated', 'Manual Grade Updated',
    'A professor updated manual grading for an exam answer.',
    'exam', attempt_exam_id, attempt_student_id,
    jsonb_build_object('attempt_id', new.attempt_id, 'question_id', new.question_id)
  );

  return new;
end;
$$;

drop trigger if exists audit_manual_grading_changes on public.exam_attempt_answers;
create trigger audit_manual_grading_changes
after update of earned_points, needs_manual_grading, graded_by on public.exam_attempt_answers
for each row execute function public.audit_manual_grading_changes();

revoke all on function public.audit_exam_lifecycle_changes() from public, anon, authenticated;
revoke all on function public.audit_exam_access_exception_changes() from public, anon, authenticated;
revoke all on function public.audit_manual_grading_changes() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
