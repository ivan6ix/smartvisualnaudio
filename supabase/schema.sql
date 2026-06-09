do $$
begin
  create type public.user_role as enum ('Admin', 'Professor', 'Dean', 'Cluster Professor', 'Student');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.account_status as enum ('Active', 'Pending', 'Deactivated');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.violation_type as enum ('MULTIPLE_FACE', 'NO_FACE', 'BACKGROUND_VOICE', 'TAB_SWITCH', 'COPY_ATTEMPT', 'FULLSCREEN_EXIT', 'LOOKING_AWAY', 'PHONE_DETECTED', 'GADGET_DETECTED');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.violation_severity as enum ('Low', 'Medium', 'High');
exception when duplicate_object then null;
end $$;

alter type public.violation_type add value if not exists 'PHONE_DETECTED';
alter type public.violation_type add value if not exists 'GADGET_DETECTED';
alter type public.violation_type add value if not exists 'LOUD_NOISE_DETECTED';
alter type public.violation_type add value if not exists 'AUDIO_DETECTED';
alter type public.violation_type add value if not exists 'LOUD_AUDIO';

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'Student',
  full_name text not null,
  email text not null unique,
  employee_number text unique,
  student_number text unique,
  avatar_url text,
  status public.account_status not null default 'Active',
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_url text;

create table if not exists public.cluster_professors (
  id uuid primary key references public.profiles(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role text not null default 'Cluster Professor',
  account_status text not null default 'Active',
  created_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  course_name text not null,
  course_code text not null,
  section text not null,
  joining_code text not null unique,
  professor_id uuid references public.profiles(id),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id),
  receiver_id uuid not null references public.profiles(id),
  message text not null,
  attachment_url text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  title text not null,
  message text not null,
  type text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  action text not null,
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  title text not null,
  exam_title text,
  description text,
  course text,
  professor_id uuid references public.profiles(id),
  time_limit integer,
  passing_score numeric(5,2),
  exam_type text,
  semester text,
  exam_settings jsonb not null default '{}'::jsonb,
  questions_count integer not null default 0,
  duration integer,
  created_by uuid not null references public.profiles(id),
  status text not null default 'Draft',
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.exams add column if not exists semester text;
alter table public.exams add column if not exists exam_settings jsonb not null default '{}'::jsonb;
alter table public.exams alter column duration drop not null;

create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  question_text text not null,
  question_type text not null,
  choices jsonb not null default '[]'::jsonb,
  correct_answer text not null default '',
  correct_answers jsonb not null default '[]'::jsonb,
  question_config jsonb not null default '{}'::jsonb,
  manual_grading boolean not null default false,
  points numeric(6,2) not null default 1
);

create table if not exists public.exam_reviews (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  cluster_professor_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('Approved', 'Rejected', 'Revision Needed')),
  remarks text,
  review_date timestamptz not null default now()
);

create table if not exists public.exam_approval_logs (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  approved_by uuid not null references public.profiles(id),
  approval_date timestamptz not null default now()
);

create table if not exists public.exam_rejection_logs (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  rejected_by uuid not null references public.profiles(id),
  reason text not null,
  rejection_date timestamptz not null default now()
);

create table if not exists public.violations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  exam_id uuid not null references public.exams(id) on delete cascade,
  professor_id uuid references public.profiles(id),
  course_id uuid references public.courses(id),
  violation_type public.violation_type not null,
  description text,
  severity public.violation_severity not null default 'Low',
  screenshot_url text,
  evidence_url text,
  evidence_type text,
  audio_level integer,
  created_at timestamptz not null default now()
);

alter table public.violations add column if not exists professor_id uuid references public.profiles(id);
alter table public.violations add column if not exists course_id uuid references public.courses(id);
alter table public.violations add column if not exists description text;
alter table public.violations add column if not exists evidence_url text;
alter table public.violations add column if not exists evidence_type text;
alter table public.violations add column if not exists audio_level integer;

create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id),
  student_id uuid not null references public.profiles(id),
  score numeric(6,2),
  earned_points numeric(8,2),
  max_points numeric(8,2),
  status text not null default 'Submitted',
  violations jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  submitted_at timestamptz
);

alter table public.exam_attempts drop constraint if exists exam_attempts_exam_id_fkey;
alter table public.exam_attempts
  add constraint exam_attempts_exam_id_fkey
  foreign key (exam_id)
  references public.exams(id)
  on delete cascade;

alter table public.exam_attempts add column if not exists started_at timestamptz;
alter table public.exam_attempts add column if not exists submitted_at timestamptz;
alter table public.exam_attempts add column if not exists earned_points numeric(8,2);
alter table public.exam_attempts add column if not exists max_points numeric(8,2);

create table if not exists public.exam_attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  question_id uuid not null references public.exam_questions(id) on delete cascade,
  answer jsonb not null default 'null'::jsonb,
  file_url text,
  earned_points numeric(8,2),
  max_points numeric(8,2),
  is_correct boolean,
  needs_manual_grading boolean not null default false,
  graded_at timestamptz,
  graded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create table if not exists public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (course_id, student_id)
);

create table if not exists public.course_periods (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  professor_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (course_id, professor_id, name)
);

create table if not exists public.course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  professor_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  period text not null default 'No period',
  file_name text,
  file_path text,
  file_size bigint,
  mime_type text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.course_permit_requests (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  professor_id uuid not null references public.profiles(id) on delete cascade,
  deadline timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.course_permit_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.course_permit_requests(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_size bigint,
  mime_type text,
  created_at timestamptz not null default now()
);

alter table public.course_modules add column if not exists file_name text;
alter table public.course_modules add column if not exists file_path text;
alter table public.course_modules add column if not exists file_size bigint;
alter table public.course_modules add column if not exists mime_type text;
alter table public.course_modules add column if not exists archived boolean not null default false;
alter table public.course_modules add column if not exists period text not null default 'No period';

alter table public.profiles enable row level security;
alter table public.cluster_professors enable row level security;
alter table public.courses enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.logs enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_reviews enable row level security;
alter table public.exam_approval_logs enable row level security;
alter table public.exam_rejection_logs enable row level security;
alter table public.violations enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_attempt_answers enable row level security;
alter table public.course_enrollments enable row level security;
alter table public.course_periods enable row level security;
alter table public.course_modules enable row level security;
alter table public.course_permit_requests enable row level security;
alter table public.course_permit_files enable row level security;

drop policy if exists "profiles_read_authenticated" on public.profiles;
drop policy if exists "profiles_self_update" on public.profiles;
drop policy if exists "cluster_professors_self" on public.cluster_professors;
drop policy if exists "courses_read_authenticated" on public.courses;
drop policy if exists "messages_participants" on public.messages;
drop policy if exists "messages_send" on public.messages;
drop policy if exists "messages_receiver_read" on public.messages;
drop policy if exists "notifications_owner" on public.notifications;
drop policy if exists "logs_read_authenticated" on public.logs;
drop policy if exists "exams_read_authenticated" on public.exams;
drop policy if exists "exam_questions_read_authenticated" on public.exam_questions;
drop policy if exists "exam_reviews_cluster_manage" on public.exam_reviews;
drop policy if exists "exam_approval_logs_read_authenticated" on public.exam_approval_logs;
drop policy if exists "exam_rejection_logs_read_authenticated" on public.exam_rejection_logs;
drop policy if exists "violations_read_authenticated" on public.violations;
drop policy if exists "attempts_owner" on public.exam_attempts;
drop policy if exists "attempt_answers_owner_read" on public.exam_attempt_answers;

create policy "profiles_read_authenticated" on public.profiles for select to authenticated using (true);
create policy "profiles_self_update" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "cluster_professors_self" on public.cluster_professors for select to authenticated using (auth.uid() = id);
create policy "courses_read_authenticated" on public.courses for select to authenticated using (true);
create policy "messages_participants" on public.messages for select to authenticated using (auth.uid() = sender_id or auth.uid() = receiver_id);
create policy "messages_send" on public.messages for insert to authenticated with check (auth.uid() = sender_id);
create policy "messages_receiver_read" on public.messages
for update to authenticated
using (auth.uid() = receiver_id)
with check (auth.uid() = receiver_id);
create policy "notifications_owner" on public.notifications for select to authenticated using (auth.uid() = user_id);
drop policy if exists "notifications_owner_update" on public.notifications;
create policy "notifications_owner_update" on public.notifications
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('profile-pictures', 'profile-pictures', true)
on conflict (id) do update set public = true;

drop policy if exists "profile_pictures_read" on storage.objects;
drop policy if exists "profile_pictures_owner_insert" on storage.objects;
drop policy if exists "profile_pictures_owner_update" on storage.objects;

create policy "profile_pictures_read" on storage.objects
for select to authenticated
using (bucket_id = 'profile-pictures');

create policy "profile_pictures_owner_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'profile-pictures'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "profile_pictures_owner_update" on storage.objects
for update to authenticated
using (
  bucket_id = 'profile-pictures'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'profile-pictures'
  and auth.uid()::text = (storage.foldername(name))[1]
);
create policy "logs_read_authenticated" on public.logs for select to authenticated using (true);
create policy "exams_read_authenticated" on public.exams for select to authenticated using (true);
create policy "exam_questions_read_authenticated" on public.exam_questions for select to authenticated using (true);
create policy "exam_reviews_cluster_manage" on public.exam_reviews for all to authenticated using (auth.uid() = cluster_professor_id) with check (auth.uid() = cluster_professor_id);
create policy "exam_approval_logs_read_authenticated" on public.exam_approval_logs for select to authenticated using (true);
create policy "exam_rejection_logs_read_authenticated" on public.exam_rejection_logs for select to authenticated using (true);
create policy "violations_read_authenticated" on public.violations for select to authenticated using (true);
create policy "attempts_owner" on public.exam_attempts for select to authenticated using (auth.uid() = student_id);
create policy "attempt_answers_owner_read" on public.exam_attempt_answers
for select to authenticated
using (
  exists (
    select 1 from public.exam_attempts
    where exam_attempts.id = exam_attempt_answers.attempt_id
    and exam_attempts.student_id = auth.uid()
  )
);

drop policy if exists "courses_admin_manage" on public.courses;
drop policy if exists "exams_professor_manage_own" on public.exams;
drop policy if exists "exams_cluster_review_update" on public.exams;
drop policy if exists "exam_questions_professor_manage_own" on public.exam_questions;
drop policy if exists "exam_reviews_professor_read_own" on public.exam_reviews;
drop policy if exists "attempts_admin_read" on public.exam_attempts;
drop policy if exists "attempts_professor_read" on public.exam_attempts;
drop policy if exists "attempts_professor_update" on public.exam_attempts;
drop policy if exists "attempts_student_insert" on public.exam_attempts;
drop policy if exists "attempts_student_delete_own" on public.exam_attempts;
drop policy if exists "attempt_answers_owner_read" on public.exam_attempt_answers;
drop policy if exists "attempt_answers_student_insert" on public.exam_attempt_answers;
drop policy if exists "attempt_answers_professor_read" on public.exam_attempt_answers;
drop policy if exists "attempt_answers_professor_grade" on public.exam_attempt_answers;
drop policy if exists "enrollments_student_read" on public.course_enrollments;
drop policy if exists "enrollments_student_join" on public.course_enrollments;
drop policy if exists "enrollments_professor_read" on public.course_enrollments;
drop policy if exists "course_periods_professor_manage" on public.course_periods;
drop policy if exists "course_periods_students_read" on public.course_periods;
drop policy if exists "course_periods_admin_read" on public.course_periods;
drop policy if exists "course_modules_professor_manage" on public.course_modules;
drop policy if exists "course_modules_students_read" on public.course_modules;
drop policy if exists "course_modules_admin_read" on public.course_modules;
drop policy if exists "permit_requests_professor_manage" on public.course_permit_requests;
drop policy if exists "permit_requests_students_read" on public.course_permit_requests;
drop policy if exists "permit_files_student_manage_own" on public.course_permit_files;
drop policy if exists "permit_files_professor_read" on public.course_permit_files;
drop policy if exists "notifications_authenticated_insert" on public.notifications;
drop policy if exists "violations_student_insert" on public.violations;

create policy "courses_admin_manage" on public.courses
for all to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('Admin', 'Dean')
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('Admin', 'Dean')
  )
);

create policy "exams_professor_manage_own" on public.exams
for all to authenticated
using (
  auth.uid() = professor_id
  or auth.uid() = created_by
  or exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('Admin', 'Dean')
  )
)
with check (
  auth.uid() = professor_id
  or auth.uid() = created_by
  or exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('Admin', 'Dean')
  )
);

create policy "exams_cluster_review_update" on public.exams
for update to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role = 'Cluster Professor'
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role = 'Cluster Professor'
  )
);

create policy "exam_questions_professor_manage_own" on public.exam_questions
for all to authenticated
using (
  exists (
    select 1 from public.exams
    where exams.id = exam_questions.exam_id
    and (exams.professor_id = auth.uid() or exams.created_by = auth.uid())
  )
)
with check (
  exists (
    select 1 from public.exams
    where exams.id = exam_questions.exam_id
    and (exams.professor_id = auth.uid() or exams.created_by = auth.uid())
  )
);

create policy "exam_reviews_professor_read_own" on public.exam_reviews
for select to authenticated
using (
  exists (
    select 1
    from public.exams
    where exams.id = exam_reviews.exam_id
    and (exams.professor_id = auth.uid() or exams.created_by = auth.uid())
  )
);

create policy "attempts_admin_read" on public.exam_attempts
for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('Admin', 'Dean', 'Cluster Professor')
  )
);

create policy "attempts_student_insert" on public.exam_attempts
for insert to authenticated
with check (auth.uid() = student_id);

create policy "attempts_student_delete_own" on public.exam_attempts
for delete to authenticated
using (auth.uid() = student_id);

create policy "attempt_answers_owner_read" on public.exam_attempt_answers
for select to authenticated
using (
  exists (
    select 1 from public.exam_attempts
    where exam_attempts.id = exam_attempt_answers.attempt_id
    and exam_attempts.student_id = auth.uid()
  )
);

create policy "attempts_professor_read" on public.exam_attempts
for select to authenticated
using (
  exists (
    select 1
    from public.exams
    where exams.id = exam_attempts.exam_id
    and (exams.professor_id = auth.uid() or exams.created_by = auth.uid())
  )
);

create policy "attempts_professor_update" on public.exam_attempts
for update to authenticated
using (
  exists (
    select 1
    from public.exams
    where exams.id = exam_attempts.exam_id
    and (exams.professor_id = auth.uid() or exams.created_by = auth.uid())
  )
);

create policy "attempt_answers_student_insert" on public.exam_attempt_answers
for insert to authenticated
with check (
  exists (
    select 1 from public.exam_attempts
    where exam_attempts.id = exam_attempt_answers.attempt_id
    and exam_attempts.student_id = auth.uid()
  )
);

create policy "attempt_answers_professor_read" on public.exam_attempt_answers
for select to authenticated
using (
  exists (
    select 1
    from public.exam_attempts
    join public.exams on exams.id = exam_attempts.exam_id
    where exam_attempts.id = exam_attempt_answers.attempt_id
    and (exams.professor_id = auth.uid() or exams.created_by = auth.uid())
  )
);

create policy "attempt_answers_professor_grade" on public.exam_attempt_answers
for update to authenticated
using (
  exists (
    select 1
    from public.exam_attempts
    join public.exams on exams.id = exam_attempts.exam_id
    where exam_attempts.id = exam_attempt_answers.attempt_id
    and (exams.professor_id = auth.uid() or exams.created_by = auth.uid())
  )
);

create policy "enrollments_student_read" on public.course_enrollments
for select to authenticated
using (auth.uid() = student_id);

create policy "enrollments_student_join" on public.course_enrollments
for insert to authenticated
with check (auth.uid() = student_id);

create policy "enrollments_professor_read" on public.course_enrollments
for select to authenticated
using (
  exists (
    select 1 from public.courses
    where courses.id = course_enrollments.course_id
    and courses.professor_id = auth.uid()
  )
);

create policy "course_periods_professor_manage" on public.course_periods
for all to authenticated
using (
  professor_id = auth.uid()
  and exists (
    select 1 from public.courses
    where courses.id = course_periods.course_id
    and courses.professor_id = auth.uid()
  )
)
with check (
  professor_id = auth.uid()
  and exists (
    select 1 from public.courses
    where courses.id = course_periods.course_id
    and courses.professor_id = auth.uid()
  )
);

create policy "course_periods_students_read" on public.course_periods
for select to authenticated
using (
  exists (
    select 1 from public.course_enrollments
    where course_enrollments.course_id = course_periods.course_id
    and course_enrollments.student_id = auth.uid()
  )
);

create policy "course_periods_admin_read" on public.course_periods
for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('Admin', 'Dean', 'Cluster Professor')
  )
);

create policy "course_modules_professor_manage" on public.course_modules
for all to authenticated
using (
  professor_id = auth.uid()
  and exists (
    select 1 from public.courses
    where courses.id = course_modules.course_id
    and courses.professor_id = auth.uid()
  )
)
with check (
  professor_id = auth.uid()
  and exists (
    select 1 from public.courses
    where courses.id = course_modules.course_id
    and courses.professor_id = auth.uid()
  )
);

create policy "course_modules_students_read" on public.course_modules
for select to authenticated
using (
  exists (
    select 1 from public.course_enrollments
    where course_enrollments.course_id = course_modules.course_id
    and course_enrollments.student_id = auth.uid()
  )
);

create policy "course_modules_admin_read" on public.course_modules
for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('Admin', 'Dean', 'Cluster Professor')
  )
);

create policy "permit_requests_professor_manage" on public.course_permit_requests
for all to authenticated
using (
  exists (
    select 1 from public.courses
    where courses.id = course_permit_requests.course_id
    and courses.professor_id = auth.uid()
  )
)
with check (
  professor_id = auth.uid()
  and exists (
    select 1 from public.courses
    where courses.id = course_permit_requests.course_id
    and courses.professor_id = auth.uid()
  )
);

create policy "permit_requests_students_read" on public.course_permit_requests
for select to authenticated
using (
  exists (
    select 1 from public.course_enrollments
    where course_enrollments.course_id = course_permit_requests.course_id
    and course_enrollments.student_id = auth.uid()
  )
);

create policy "permit_files_student_manage_own" on public.course_permit_files
for all to authenticated
using (student_id = auth.uid())
with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.course_enrollments
    where course_enrollments.course_id = course_permit_files.course_id
    and course_enrollments.student_id = auth.uid()
  )
);

create policy "permit_files_professor_read" on public.course_permit_files
for select to authenticated
using (
  exists (
    select 1 from public.courses
    where courses.id = course_permit_files.course_id
    and courses.professor_id = auth.uid()
  )
);

create policy "notifications_authenticated_insert" on public.notifications
for insert to authenticated
with check (true);

create policy "violations_student_insert" on public.violations
for insert to authenticated
with check (auth.uid() = student_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exam-submissions',
  'exam-submissions',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'proctor-snapshots',
  'proctor-snapshots',
  false,
  5242880,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio-violations',
  'audio-violations',
  false,
  15728640,
  array['audio/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-modules',
  'course-modules',
  false,
  26214400,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'course-permits',
  'course-permits',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "exam_submissions_student_upload" on storage.objects;
drop policy if exists "exam_submissions_owner_read" on storage.objects;
drop policy if exists "exam_submissions_professor_read" on storage.objects;
drop policy if exists "proctor_snapshots_student_upload" on storage.objects;
drop policy if exists "proctor_snapshots_owner_read" on storage.objects;
drop policy if exists "proctor_snapshots_professor_read" on storage.objects;
drop policy if exists "audio_violations_student_upload" on storage.objects;
drop policy if exists "audio_violations_owner_read" on storage.objects;
drop policy if exists "audio_violations_professor_read" on storage.objects;
drop policy if exists "audio_violations_admin_dean_read" on storage.objects;
drop policy if exists "course_modules_professor_upload" on storage.objects;
drop policy if exists "course_modules_professor_read" on storage.objects;
drop policy if exists "course_modules_students_read" on storage.objects;
drop policy if exists "course_permits_student_upload" on storage.objects;
drop policy if exists "course_permits_student_read" on storage.objects;
drop policy if exists "course_permits_professor_read" on storage.objects;
drop policy if exists "proctor_snapshots_admin_dean_read" on storage.objects;

create policy "exam_submissions_student_upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'exam-submissions'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "exam_submissions_owner_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'exam-submissions'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "exam_submissions_professor_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'exam-submissions'
  and exists (
    select 1
    from public.exam_attempt_answers
    join public.exam_attempts on exam_attempts.id = exam_attempt_answers.attempt_id
    join public.exams on exams.id = exam_attempts.exam_id
    where exam_attempt_answers.file_url like '%' || storage.objects.name
    and (exams.professor_id = auth.uid() or exams.created_by = auth.uid())
  )
);

create policy "proctor_snapshots_student_upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'proctor-snapshots'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "proctor_snapshots_owner_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'proctor-snapshots'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "proctor_snapshots_professor_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'proctor-snapshots'
  and exists (
    select 1
    from public.violations
    join public.exams on exams.id = violations.exam_id
    where violations.screenshot_url = storage.objects.name
    and (exams.professor_id = auth.uid() or exams.created_by = auth.uid())
  )
);

create policy "audio_violations_student_upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'audio-violations'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "audio_violations_owner_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'audio-violations'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "audio_violations_professor_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'audio-violations'
  and (
    exists (
      select 1
      from public.violations
      join public.exams on exams.id = violations.exam_id
      where (
        violations.evidence_url = storage.objects.name
        or violations.screenshot_url = storage.objects.name
      )
      and (exams.professor_id = auth.uid() or exams.created_by = auth.uid())
    )
    or exists (
      select 1
      from public.exams
      where exams.id = ((storage.foldername(storage.objects.name))[2])::uuid
      and (exams.professor_id = auth.uid() or exams.created_by = auth.uid())
    )
  )
);

create policy "audio_violations_admin_dean_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'audio-violations'
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('Admin', 'Dean')
  )
);

create policy "course_modules_professor_upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'course-modules'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "course_modules_professor_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'course-modules'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "course_modules_students_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'course-modules'
  and exists (
    select 1
    from public.course_modules
    join public.course_enrollments on course_enrollments.course_id = course_modules.course_id
    where course_modules.file_path = storage.objects.name
    and course_enrollments.student_id = auth.uid()
  )
);

create policy "course_permits_student_upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'course-permits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "course_permits_student_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'course-permits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "course_permits_professor_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'course-permits'
  and exists (
    select 1
    from public.course_permit_files
    join public.courses on courses.id = course_permit_files.course_id
    where course_permit_files.file_path = storage.objects.name
    and courses.professor_id = auth.uid()
  )
);

create policy "proctor_snapshots_admin_dean_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'proctor-snapshots'
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('Admin', 'Dean')
  )
);

create or replace function public.request_admin_password_reset_notification(request_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requester record;
begin
  select id, role, full_name, email
  into requester
  from public.profiles
  where lower(email) = lower(trim(request_email))
  and role in ('Professor', 'Cluster Professor', 'Dean')
  limit 1;

  if requester.id is null then
    return;
  end if;

  insert into public.notifications (user_id, title, message, type, is_read)
  select
    profiles.id,
    'Password Reset Request',
    requester.full_name || ' (' || requester.role || ') requested a password reset.',
    'Password Reset',
    false
  from public.profiles
  where profiles.role = 'Admin'
  and profiles.status = 'Active';

  insert into public.logs (user_id, action, description)
  values (
    requester.id,
    'Password Reset Request',
    requester.full_name || ' (' || requester.role || ') requested a password reset.'
  );
end;
$$;

grant execute on function public.request_admin_password_reset_notification(text) to anon, authenticated;

create or replace function public.create_profile_from_auth()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, email, employee_number, student_number, status)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'Student'),
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    new.raw_user_meta_data->>'employee_number',
    new.raw_user_meta_data->>'student_number',
    coalesce((new.raw_user_meta_data->>'status')::public.account_status, 'Active')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.create_profile_from_auth();
