-- Targeted postcheck after applying the interruption-limit release to hosted Supabase.
select
  'exam_start_sessions_interruption_columns' as check_name,
  case when count(*) = 5 then 'PASS' else 'FAIL' end as status,
  count(*)::text as found_columns
from information_schema.columns
where table_schema = 'public'
  and table_name = 'exam_start_sessions'
  and column_name in ('interruption_count', 'interruption_limit', 'recovery_event_keys', 'last_recovery_event_key', 'last_recovery_at');

select
  'record_exam_interruption_recovery_exists' as check_name,
  case when count(*) = 1 then 'PASS' else 'FAIL' end as status,
  count(*)::text as matching_functions
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'record_exam_interruption_recovery'
  and pg_get_function_identity_arguments(p.oid) = 'p_exam_id uuid, p_recovery_event_key text';

select
  'public_cannot_execute_interruption_rpc' as check_name,
  case when not has_function_privilege('public', 'public.record_exam_interruption_recovery(uuid,text)', 'execute') then 'PASS' else 'FAIL' end as status;

select
  'authenticated_can_execute_interruption_rpc' as check_name,
  case when has_function_privilege('authenticated', 'public.record_exam_interruption_recovery(uuid,text)', 'execute') then 'PASS' else 'FAIL' end as status;

select
  'anon_cannot_execute_interruption_rpc' as check_name,
  case when not has_function_privilege('anon', 'public.record_exam_interruption_recovery(uuid,text)', 'execute') then 'PASS' else 'FAIL' end as status;
