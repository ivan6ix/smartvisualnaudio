drop policy if exists "logs_read_authenticated" on public.logs;
drop policy if exists "logs_read_own_or_audit_roles" on public.logs;

create policy "logs_read_own_or_audit_roles" on public.logs
for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('Admin', 'Dean')
  )
);
