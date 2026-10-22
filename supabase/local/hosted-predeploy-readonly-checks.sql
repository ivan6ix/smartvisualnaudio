-- Read-only pre-deployment checks for the hosted project (PR #2). Safe to run in the SQL Editor:
-- it only reads catalogs and tables, and the first statement makes the transaction read-only, so any
-- write would fail. Run the whole file as one query; the final SELECT is the result.
-- Returns one row per check: section, item, status (ok | missing | review), detail.
set transaction read only;

with expected_migrations(version) as (
  values ('20261010142803'), ('20261020120000'), ('20261020150000'),
         ('20261020170000'), ('20261020190000'), ('20261021120000')
),
expected_functions(name) as (
  values ('publish_exam_group'), ('save_exam_group'), ('transition_exam_group'), ('review_exam_group'),
         ('get_exam_group'), ('get_student_exam_questions'), ('get_cluster_review_history'), ('submit_exam_attempt')
),
expected_enum(label) as (
  values ('MICROPHONE_UNAVAILABLE'), ('MICROPHONE_DISCONNECTED'), ('MICROPHONE_MUTED'), ('MICROPHONE_ACCESS_LOST')
),
-- The CLI's history table is absent when migrations were applied by hand; read it only if it exists.
applied(version) as (
  select (xpath('/row/version/text()', row_xml))[1]::text
  from unnest(xpath('//row', case
    when to_regclass('supabase_migrations.schema_migrations') is not null
      then query_to_xml('select version from supabase_migrations.schema_migrations', false, false, '')
    else '<table/>'::xml end)) as row_xml
),
checks as (
  -- 1. Applied migrations (CLI history); section 2 confirms the objects either way
  select 'migrations' as section, 'latest applied' as item, 'review' as status,
         case when to_regclass('supabase_migrations.schema_migrations') is null
           then 'no CLI migration history table: migrations were applied manually'
           else coalesce(max(version), 'none') end as detail
  from applied
  union all
  select 'migrations', e.version,
         case when m.version is null then 'missing' else 'ok' end,
         case when m.version is null then 'not in CLI history' else 'applied' end
  from expected_migrations e
  left join applied m on m.version = e.version

  -- 2. Objects the new frontend and Edge Functions depend on
  union all
  select 'objects', 'table ' || t.name,
         case when to_regclass('public.' || t.name) is null then 'missing' else 'ok' end, ''
  from (values ('exam_publish_groups'), ('exam_publish_group_members')) as t(name)
  union all
  select 'objects', 'function ' || f.name,
         case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and p.proname = f.name) then 'ok' else 'missing' end, ''
  from expected_functions f
  union all
  select 'objects', 'enum violation_type ' || e.label,
         case when exists (select 1 from pg_enum v join pg_type ty on ty.oid = v.enumtypid
                           where ty.typname = 'violation_type' and v.enumlabel = e.label) then 'ok' else 'missing' end, ''
  from expected_enum e

  -- 3. RLS: public tables without row level security
  union all
  select 'rls', 'table without RLS: ' || c.relname, 'review', ''
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

  -- 4. RLS: permissive policies that read everything (baseline profiles/exams policies)
  union all
  select 'rls', 'broad policy: ' || p.tablename || '.' || p.policyname, 'review',
         'roles=' || array_to_string(p.roles, ',') || ' cmd=' || p.cmd || ' using=' || coalesce(p.qual, '')
  from pg_policies p
  where p.schemaname = 'public'
    and p.cmd in ('SELECT', 'ALL')
    and (coalesce(p.qual, '') in ('true', '(true)') or 'anon' = any (p.roles))

  -- 5. SECURITY DEFINER functions: callable by anon, or without a fixed search_path
  union all
  select 'definer', 'anon can execute: ' || p.proname, 'review', pg_get_function_identity_arguments(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'execute')
  union all
  select 'definer', 'no search_path: ' || p.proname, 'review', pg_get_function_identity_arguments(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')

  -- 6. Storage buckets and policies
  union all
  select 'storage', 'bucket ' || b.id, case when b.public then 'review' else 'ok' end,
         case when b.public then 'PUBLIC bucket' else 'private' end
  from storage.buckets b
  union all
  select 'storage', 'policy count', 'review', count(*)::text || ' policies on storage.objects'
  from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'
  union all
  select 'storage', 'open policy ' || p.policyname, 'review',
         'cmd=' || p.cmd || ' roles=' || array_to_string(p.roles, ',')
  from pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects'
    and ('anon' = any (p.roles) or 'public' = any (p.roles))
  union all
  select 'storage', 'exam-submissions professor read', case when count(*) = 0 then 'missing' else 'ok' end, ''
  from pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'exam_submissions_professor_read'

  -- 7. Rows the file_url backfill in 20261020190000 would update (same conditions as the migration)
  union all
  select 'data', 'file_url backfill rows (only file_url changes)', 'review', count(*)::text
  from public.exam_attempt_answers aa
  join public.exam_attempts a on a.id = aa.attempt_id
  join public.exam_questions q on q.id = aa.question_id and q.exam_id = a.exam_id
  where q.question_type = 'File Upload'
    and nullif(aa.file_url, '') is null
    and jsonb_typeof(aa.answer) = 'object'
    and nullif(aa.answer->>'path', '') is not null
    and starts_with(aa.answer->>'path', a.student_id::text || '/' || a.exam_id::text || '/' || q.id::text || '/')
    and exists (select 1 from storage.objects o where o.bucket_id = 'exam-submissions' and o.name = aa.answer->>'path')
)
select * from checks order by section, status desc, item;
