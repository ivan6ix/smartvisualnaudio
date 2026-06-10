drop policy if exists "enrollments_students_read_course_members" on public.course_enrollments;

create or replace function public.is_student_enrolled_in_course(target_course_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.course_enrollments
    where course_id = target_course_id
    and student_id = auth.uid()
  );
$$;

create policy "enrollments_students_read_course_members" on public.course_enrollments
for select to authenticated
using (public.is_student_enrolled_in_course(course_id));
