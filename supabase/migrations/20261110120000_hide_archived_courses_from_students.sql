-- An archived course disappears for its students until an admin restores it.
-- is_student_enrolled_in_course() is what lets a student read a course (courses_student_read_enrolled) and its
-- member list (enrollments_students_read_course_members), so it now also requires the course to be active.
-- Exams in archived courses were already hidden (student_can_take_exam) and joining by code already skips them.
create or replace function public.is_student_enrolled_in_course(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.course_enrollments ce
    join public.courses c on c.id = ce.course_id
    where ce.course_id = target_course_id
      and ce.student_id = auth.uid()
      and not c.archived
  )
$$;

revoke all on function public.is_student_enrolled_in_course(uuid) from public, anon;
grant execute on function public.is_student_enrolled_in_course(uuid) to authenticated;
