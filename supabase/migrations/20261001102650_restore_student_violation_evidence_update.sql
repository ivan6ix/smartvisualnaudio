drop policy if exists "violations_student_update_own" on public.violations;

create policy "violations_student_update_own"
on public.violations
for update
to authenticated
using ((select auth.uid()) = student_id)
with check ((select auth.uid()) = student_id);
