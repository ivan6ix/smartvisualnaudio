-- profiles_read_authenticated let every signed-in user, students included, read every profile: names,
-- emails, student and employee numbers and roles. Profiles are now readable only where a page needs them:
--   * your own profile;
--   * staff profiles (Admin, Dean, Professor, Cluster Professor), for course professors and messaging;
--   * every profile, for active Admins, Deans and Cluster Professors (accounts, analytics, integrity, reviews);
--   * a student's profile, for that student's professors (enrolled in their course, or with an attempt,
--     alert or assignment on their exam), classmates (the course People tab) and anyone they have messaged.
-- Rules on other tables that look up the caller's own profile keep working: your own row stays readable.

create or replace function public.can_read_all_profiles()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('Admin', 'Dean', 'Cluster Professor')
      and status = 'Active'
  )
$$;

create or replace function public.can_read_student_profile(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with my_exams as (
    select id from public.exams where professor_id = auth.uid() or created_by = auth.uid()
  )
  select
    exists (
      select 1
      from public.course_enrollments e
      join public.courses c on c.id = e.course_id
      where e.student_id = target_id
        and c.professor_id = auth.uid()
    )
    or exists (
      select 1
      from public.course_enrollments mine
      join public.course_enrollments theirs on theirs.course_id = mine.course_id
      where mine.student_id = auth.uid()
        and theirs.student_id = target_id
    )
    or exists (select 1 from public.exam_attempts a where a.student_id = target_id and a.exam_id in (select id from my_exams))
    or exists (select 1 from public.violations v where v.student_id = target_id and v.exam_id in (select id from my_exams))
    or exists (select 1 from public.exam_student_assignments s where s.student_id = target_id and s.exam_id in (select id from my_exams))
    or exists (
      select 1
      from public.messages m
      where (m.sender_id = auth.uid() and m.receiver_id = target_id)
         or (m.sender_id = target_id and m.receiver_id = auth.uid())
    )
$$;

revoke all on function public.can_read_all_profiles() from public, anon, authenticated;
revoke all on function public.can_read_student_profile(uuid) from public, anon, authenticated;
grant execute on function public.can_read_all_profiles() to authenticated;
grant execute on function public.can_read_student_profile(uuid) to authenticated;

-- Lookups by student (the existing indexes start with course or exam).
create index if not exists course_enrollments_student_course_idx on public.course_enrollments(student_id, course_id);
create index if not exists exam_attempts_student_exam_idx on public.exam_attempts(student_id, exam_id);
create index if not exists violations_student_exam_idx on public.violations(student_id, exam_id);
create index if not exists courses_professor_id_idx on public.courses(professor_id);
create index if not exists exams_professor_id_idx on public.exams(professor_id);
create index if not exists exams_created_by_idx on public.exams(created_by);
create index if not exists messages_sender_receiver_idx on public.messages(sender_id, receiver_id);
create index if not exists messages_receiver_sender_idx on public.messages(receiver_id, sender_id);

drop policy if exists "profiles_read_authenticated" on public.profiles;
drop policy if exists "profiles_read_related" on public.profiles;
create policy "profiles_read_related" on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or role <> 'Student'
  or (select public.can_read_all_profiles())
  or public.can_read_student_profile(id)
);
