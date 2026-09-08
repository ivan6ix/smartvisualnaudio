-- Allows a student to attach audio evidence metadata only to their own
-- already-created violation row. Existing Dean/authenticated SELECT access is unchanged.
drop policy if exists "violations_student_update_own" on public.violations;

create policy "violations_student_update_own" on public.violations
for update to authenticated
using (auth.uid() = student_id)
with check (auth.uid() = student_id);
