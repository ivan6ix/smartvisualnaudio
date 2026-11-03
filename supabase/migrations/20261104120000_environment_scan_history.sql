-- Environment scan history: every checked scan step (room sweep or desk check) is saved with its result and the
-- photos that were checked, so the exam's professor can review them later from Monitoring.
--   * A student saves rows and photos only for themself, and only for exams they may take.
--   * The student, the exam's professor, and active Admins and Deans can read them. Nobody edits or deletes them
--     through the app, so the history cannot be cleaned up after the fact.
-- Photos live in the private environment-scans bucket at <student id>/<exam id>/<scan id>/<step>-<n>.jpg and are
-- opened through short-lived signed links.

create table if not exists public.environment_scan_steps (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  scan_id uuid not null,
  step text not null check (step in ('sweep', 'desk')),
  outcome text not null check (outcome in ('clear', 'risk_detected', 'rescan_required', 'technical_error')),
  findings jsonb not null default '[]'::jsonb,
  photo_paths text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists environment_scan_steps_exam_student_idx
  on public.environment_scan_steps(exam_id, student_id, created_at);
create index if not exists environment_scan_steps_student_idx
  on public.environment_scan_steps(student_id, created_at);

alter table public.environment_scan_steps enable row level security;

drop policy if exists "environment_scan_steps_student_insert" on public.environment_scan_steps;
drop policy if exists "environment_scan_steps_student_read" on public.environment_scan_steps;
drop policy if exists "environment_scan_steps_professor_read" on public.environment_scan_steps;
drop policy if exists "environment_scan_steps_audit_read" on public.environment_scan_steps;

create policy "environment_scan_steps_student_insert" on public.environment_scan_steps
for insert to authenticated
with check (student_id = (select auth.uid()) and public.student_can_take_exam(exam_id));

create policy "environment_scan_steps_student_read" on public.environment_scan_steps
for select to authenticated
using (student_id = (select auth.uid()));

create policy "environment_scan_steps_professor_read" on public.environment_scan_steps
for select to authenticated
using (public.professor_owns_exam(exam_id));

create policy "environment_scan_steps_audit_read" on public.environment_scan_steps
for select to authenticated
using ((select public.is_audit_role()));

grant select, insert on public.environment_scan_steps to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('environment-scans', 'environment-scans', false, 1048576, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

drop policy if exists "environment_scans_student_upload" on storage.objects;
drop policy if exists "environment_scans_student_read" on storage.objects;
drop policy if exists "environment_scans_professor_read" on storage.objects;
drop policy if exists "environment_scans_audit_read" on storage.objects;

-- The second folder is the exam id; a path that is not a uuid is refused rather than read.
create policy "environment_scans_student_upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'environment-scans'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.student_can_take_exam(((storage.foldername(name))[2])::uuid)
);

create policy "environment_scans_student_read" on storage.objects
for select to authenticated
using (bucket_id = 'environment-scans' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "environment_scans_professor_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'environment-scans'
  and (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.professor_owns_exam(((storage.foldername(name))[2])::uuid)
);

create policy "environment_scans_audit_read" on storage.objects
for select to authenticated
using (bucket_id = 'environment-scans' and (select public.is_audit_role()));
