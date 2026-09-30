with checks as (
  select
    'notification_security' as section,
    'stale_authenticated_insert_policy_absent' as check_name,
    case when not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'notifications'
        and policyname = 'notifications_authenticated_insert'
    ) then 'PASS' else 'FAIL' end as status
  union all
  select
    'notification_security',
    'authenticated_direct_write_grants_revoked',
    case when not exists (
      select 1
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'notifications'
        and grantee = 'authenticated'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    ) then 'PASS' else 'FAIL' end
  union all
  select
    'notification_security',
    'read_rpcs_present',
    case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'mark_notification_read'
    ) and exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'mark_all_notifications_read'
    ) then 'PASS' else 'FAIL' end
  union all
  select
    'notification_security',
    'preference_owner_policies_present',
    case when (
      select count(*) from pg_policies
      where schemaname = 'public'
        and tablename = 'notification_preferences'
        and policyname in (
          'notification_preferences_owner_select',
          'notification_preferences_owner_insert',
          'notification_preferences_owner_update'
        )
    ) = 3 then 'PASS' else 'FAIL' end
  union all
  select
    'notification_security',
    'notifications_realtime_published',
    case when exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    ) then 'PASS' else 'FAIL' end
  union all
  select
    'notification_security',
    'notification_indexes_present',
    case when (
      select count(*) from pg_indexes
      where schemaname = 'public'
        and tablename = 'notifications'
        and indexname in (
          'idx_notifications_user_created_at',
          'idx_notifications_user_unread_created_at',
          'idx_notifications_user_type_created_at'
        )
    ) = 3 then 'PASS' else 'FAIL' end
)
select *
from checks
order by section, check_name;
