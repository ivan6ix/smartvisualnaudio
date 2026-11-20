-- Every staff account (Professor, Dean, Cluster Professor) can belong to one academic program.
-- Cluster Professors keep their review program in cluster_professors.program_id, which the review rules use;
-- profiles.program_id holds the program of every staff account and is filled for existing Cluster Professors.
-- Staff accounts no longer get an employee number (the column stays nullable for existing rows).
begin;

alter table public.profiles
  add column if not exists program_id uuid references public.programs(id) on delete set null;

create index if not exists profiles_program_id_idx on public.profiles(program_id);

update public.profiles p
set program_id = c.program_id
from public.cluster_professors c
where c.id = p.id
  and c.program_id is not null
  and p.program_id is null;

-- Users may still edit their own name, avatar, and theme, but not their program.
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if auth.uid() = old.id
     and (
       new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.email is distinct from old.email
       or new.student_number is distinct from old.student_number
       or new.employee_number is distinct from old.employee_number
       or new.program_id is distinct from old.program_id
       or new.created_at is distinct from old.created_at
     ) then
    raise exception 'Profile role, status, identity, program, and account fields cannot be self-updated.';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_profile_privileged_fields() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
