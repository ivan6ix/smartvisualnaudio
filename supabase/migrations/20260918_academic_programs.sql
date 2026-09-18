begin;

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid()
);

alter table public.programs add column if not exists program_code text;
alter table public.programs add column if not exists program_name text;
alter table public.programs add column if not exists is_active boolean not null default true;
alter table public.programs add column if not exists created_at timestamptz not null default now();

alter table public.programs alter column program_code set not null;
alter table public.programs alter column program_name set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'programs_code_not_blank'
  ) then
    alter table public.programs
      add constraint programs_code_not_blank check (length(trim(program_code)) between 2 and 24);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'programs_name_not_blank'
  ) then
    alter table public.programs
      add constraint programs_name_not_blank check (length(trim(program_name)) between 3 and 160);
  end if;
end $$;

create unique index if not exists programs_program_code_unique_idx
  on public.programs (upper(trim(program_code)));

alter table public.courses add column if not exists program_id uuid;
alter table public.courses add column if not exists year_level text;
alter table public.courses add column if not exists semester text;
alter table public.courses add column if not exists academic_year text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'courses_program_id_fkey'
  ) then
    alter table public.courses
      add constraint courses_program_id_fkey
      foreign key (program_id)
      references public.programs(id)
      on delete set null;
  end if;
end $$;

create index if not exists courses_program_id_idx on public.courses(program_id);
create index if not exists programs_active_code_idx on public.programs(is_active, upper(program_code));

alter table public.programs enable row level security;

drop policy if exists "programs_read_authenticated" on public.programs;
drop policy if exists "programs_admin_manage" on public.programs;

create policy "programs_read_authenticated" on public.programs
for select to authenticated
using (true);

create policy "programs_admin_manage" on public.programs
for all to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role = 'Admin'
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role = 'Admin'
  )
);

notify pgrst, 'reload schema';

commit;
