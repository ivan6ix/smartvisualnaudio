drop policy if exists "exam_questions_read_authenticated" on public.exam_questions;
drop policy if exists "violations_read_authenticated" on public.violations;

drop policy if exists "exam_questions_student_read_available" on public.exam_questions;
drop policy if exists "exam_questions_audit_read" on public.exam_questions;
drop policy if exists "violations_student_read_own" on public.violations;
drop policy if exists "violations_professor_read_own" on public.violations;
drop policy if exists "violations_audit_read" on public.violations;

create policy "exam_questions_student_read_available" on public.exam_questions
for select to authenticated
using (
  exists (
    select 1
    from public.exams
    join public.courses on courses.id = exams.course_id
    join public.course_enrollments on course_enrollments.course_id = exams.course_id
    where exams.id = exam_questions.exam_id
    and course_enrollments.student_id = auth.uid()
    and courses.archived = false
    and lower(exams.status) in ('published', 'active')
    and coalesce((exams.exam_settings->>'archived')::boolean, false) = false
  )
);

create policy "exam_questions_audit_read" on public.exam_questions
for select to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('Admin', 'Dean', 'Cluster Professor')
  )
);

create policy "violations_student_read_own" on public.violations
for select to authenticated
using (auth.uid() = student_id);

create policy "violations_professor_read_own" on public.violations
for select to authenticated
using (
  professor_id = auth.uid()
  or exists (
    select 1
    from public.exams
    where exams.id = violations.exam_id
    and (exams.professor_id = auth.uid() or exams.created_by = auth.uid())
  )
);

create policy "violations_audit_read" on public.violations
for select to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('Admin', 'Dean', 'Cluster Professor')
  )
);
