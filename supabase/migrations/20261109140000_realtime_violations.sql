-- Professors get a live pop-up when one of their students gets a violation, and Ongoing Exams refreshes its
-- violation counts. Both listen for new rows in public.violations, which needs the table in the realtime
-- publication. Realtime still applies the table's row level security, so each user only receives rows they
-- can already read.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'violations'
  ) then
    alter publication supabase_realtime add table public.violations;
  end if;
end $$;
