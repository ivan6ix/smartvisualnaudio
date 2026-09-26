-- Targeted precheck before applying the interruption-limit release to hosted Supabase.
select
  'exam_start_sessions_exists' as check_name,
  case when to_regclass('public.exam_start_sessions') is not null then 'PASS' else 'FAIL' end as status;

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'exam_start_sessions'
  and column_name in ('interruption_count', 'interruption_limit', 'recovery_event_keys', 'last_recovery_event_key', 'last_recovery_at')
order by column_name;

select
  'record_exam_interruption_recovery_absent_or_replaceable' as check_name,
  case when count(*) <= 1 then 'PASS' else 'FAIL' end as status,
  count(*)::text as matching_functions
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'record_exam_interruption_recovery';
