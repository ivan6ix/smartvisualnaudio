create table if not exists public.student_resource_folders (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  course_id uuid references public.courses(id) on delete set null,
  course_label text not null default 'Personal folder',
  folder_type text not null default 'Personal folder',
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.student_resource_files (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.student_resource_folders(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  file_name text not null,
  file_path text,
  file_size bigint,
  mime_type text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists student_resource_folders_student_idx
  on public.student_resource_folders(student_id, archived, created_at);
create index if not exists student_resource_files_student_idx
  on public.student_resource_files(student_id, folder_id, archived, created_at);

create or replace function public.delete_student_resource_storage_object()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if old.file_path is not null then
    delete from storage.objects
    where bucket_id = 'student-resources'
    and name = old.file_path;
  end if;

  return old;
end;
$$;

drop trigger if exists delete_student_resource_storage_object on public.student_resource_files;
create trigger delete_student_resource_storage_object
after delete on public.student_resource_files
for each row execute function public.delete_student_resource_storage_object();

alter table public.student_resource_folders enable row level security;
alter table public.student_resource_files enable row level security;

drop policy if exists "student_resource_folders_owner_manage" on public.student_resource_folders;
drop policy if exists "student_resource_files_owner_manage" on public.student_resource_files;

create policy "student_resource_folders_owner_manage" on public.student_resource_folders
for all to authenticated
using (student_id = auth.uid())
with check (student_id = auth.uid());

create policy "student_resource_files_owner_manage" on public.student_resource_files
for all to authenticated
using (student_id = auth.uid())
with check (
  student_id = auth.uid()
  and exists (
    select 1 from public.student_resource_folders
    where student_resource_folders.id = student_resource_files.folder_id
    and student_resource_folders.student_id = auth.uid()
  )
);

insert into storage.buckets (id, name, public, file_size_limit)
values (
  'student-resources',
  'student-resources',
  false,
  26214400
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "student_resources_owner_select" on storage.objects;
drop policy if exists "student_resources_owner_insert" on storage.objects;
drop policy if exists "student_resources_owner_update" on storage.objects;
drop policy if exists "student_resources_owner_delete" on storage.objects;

create policy "student_resources_owner_select" on storage.objects
for select to authenticated
using (
  bucket_id = 'student-resources'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "student_resources_owner_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'student-resources'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "student_resources_owner_update" on storage.objects
for update to authenticated
using (
  bucket_id = 'student-resources'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'student-resources'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "student_resources_owner_delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'student-resources'
  and (storage.foldername(name))[1] = auth.uid()::text
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = 'student_resource_folders'
  ) then
    alter publication supabase_realtime add table public.student_resource_folders;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = 'student_resource_files'
  ) then
    alter publication supabase_realtime add table public.student_resource_files;
  end if;
end $$;
