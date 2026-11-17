-- Ongoing Exams shows when students start and submit without a page reload. The page already listens for
-- changes to exam_start_sessions and exam_attempts, but realtime only sends changes for tables in the
-- supabase_realtime publication, and only rows the listener can read under row level security.

-- A professor may read the start sessions (start time and interruption count) of exams they own or created,
-- the same rule as attempts_professor_read on exam_attempts. Students keep reading only their own.
drop policy if exists exam_start_sessions_professor_read on public.exam_start_sessions;
create policy exam_start_sessions_professor_read on public.exam_start_sessions
for select to authenticated
using (
  exists (
    select 1
    from public.exams
    where exams.id = exam_start_sessions.exam_id
      and (exams.professor_id = auth.uid() or exams.created_by = auth.uid())
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'exam_start_sessions'
  ) then
    alter publication supabase_realtime add table public.exam_start_sessions;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'exam_attempts'
  ) then
    alter publication supabase_realtime add table public.exam_attempts;
  end if;
end $$;
