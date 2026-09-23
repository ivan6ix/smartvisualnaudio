-- Hosted security object snapshot.
-- Read-only: run manually before hosted-security-deployment.sql.

with
affected_tables(table_name) as (
  values
    ('profiles'), ('courses'), ('course_enrollments'), ('exams'), ('exam_questions'),
    ('exam_attempts'), ('exam_attempt_answers'), ('violations'), ('notifications'),
    ('messages'), ('logs'), ('exam_reviews'), ('exam_approval_logs'), ('exam_rejection_logs')
),
affected_functions(function_name) as (
  values
    ('is_audit_role'), ('current_profile_role'), ('is_student_enrolled_in_course'),
    ('create_notification'), ('protect_profile_privileged_fields'),
    ('sanitize_student_question_config'), ('student_can_take_exam'),
    ('get_student_exam_questions'), ('grade_exam_answer'), ('submit_exam_attempt'),
    ('join_course_by_code'), ('protect_student_violation_updates'),
    ('save_exam'), ('exam_attempt_limit'), ('authorize_exam_start'), ('guard_exam_attempt_limit')
),
affected_triggers(table_name, trigger_name) as (
  values
    ('profiles', 'protect_profile_privileged_fields'),
    ('exam_attempts', 'guard_exam_attempt_limit'),
    ('violations', 'protect_student_violation_updates')
),
optional_columns(table_name, column_name) as (
  values ('exam_attempts', 'submission_session_started_at')
),
optional_indexes(index_name) as (
  values ('exam_attempts_one_submission_per_start_session')
),
policy_rows as (
  select
    '01_policy_definitions' as section,
    'policy' as object_type,
    schemaname as schema_name,
    policyname as object_name,
    tablename as parent_object,
    jsonb_pretty(jsonb_build_object(
      'table', tablename,
      'policy', policyname,
      'command', cmd,
      'roles', roles,
      'permissive', permissive,
      'using', qual,
      'with_check', with_check
    )) as definition
  from pg_policies
  where schemaname = 'public'
    and tablename in (select table_name from affected_tables)
),
function_rows as (
  select
    '02_function_definitions' as section,
    'function' as object_type,
    'public' as schema_name,
    af.function_name as object_name,
    coalesce(pg_get_function_identity_arguments(p.oid), 'ABSENT_PREDEPLOYMENT') as parent_object,
    coalesce(pg_get_functiondef(p.oid), 'ABSENT_PREDEPLOYMENT') as definition
  from affected_functions af
  left join pg_proc p
    on p.pronamespace = 'public'::regnamespace
   and p.proname = af.function_name
),
trigger_rows as (
  select
    '03_trigger_definitions' as section,
    'trigger' as object_type,
    'public' as schema_name,
    at.trigger_name as object_name,
    at.table_name as parent_object,
    coalesce(pg_get_triggerdef(t.oid, true), 'ABSENT_PREDEPLOYMENT') as definition
  from affected_triggers at
  left join pg_class c
    on c.relnamespace = 'public'::regnamespace
   and c.relname = at.table_name
  left join pg_trigger t
    on t.tgrelid = c.oid
   and t.tgname = at.trigger_name
   and not t.tgisinternal
),
function_acl_rows as (
  select
    '04_function_acl_state' as section,
    'function_acl' as object_type,
    'public' as schema_name,
    af.function_name as object_name,
    coalesce(pg_get_function_identity_arguments(p.oid), 'ABSENT_PREDEPLOYMENT') as parent_object,
    case
      when p.oid is null then 'ABSENT_PREDEPLOYMENT'
      else jsonb_pretty(jsonb_build_object(
        'owner', pg_get_userbyid(p.proowner),
        'raw_acl', p.proacl::text,
        'acl_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'grantor', acl.grantor::regrole::text,
            'grantee', acl.grantee::regrole::text,
            'privilege_type', acl.privilege_type,
            'is_grantable', acl.is_grantable
          ) order by acl.grantee::regrole::text, acl.privilege_type)
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        ), '[]'::jsonb)
      ))
    end as definition
  from affected_functions af
  left join pg_proc p
    on p.pronamespace = 'public'::regnamespace
   and p.proname = af.function_name
),
table_rls_rows as (
  select
    '05_table_rls_state' as section,
    'table_rls' as object_type,
    n.nspname as schema_name,
    c.relname as object_name,
    null::text as parent_object,
    jsonb_pretty(jsonb_build_object(
      'relrowsecurity', c.relrowsecurity,
      'relforcerowsecurity', c.relforcerowsecurity
    )) as definition
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (select table_name from affected_tables)
),
column_rows as (
  select
    '06_column_state' as section,
    'column' as object_type,
    'public' as schema_name,
    oc.table_name || '.' || oc.column_name as object_name,
    oc.table_name as parent_object,
    coalesce(jsonb_pretty(jsonb_build_object(
      'data_type', c.data_type,
      'udt_name', c.udt_name,
      'is_nullable', c.is_nullable,
      'column_default', c.column_default
    )), 'ABSENT_PREDEPLOYMENT') as definition
  from optional_columns oc
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = oc.table_name
   and c.column_name = oc.column_name
),
index_rows as (
  select
    '07_index_state' as section,
    'index' as object_type,
    'public' as schema_name,
    oi.index_name as object_name,
    coalesce(i.tablename, 'exam_attempts') as parent_object,
    coalesce(i.indexdef, 'ABSENT_PREDEPLOYMENT') as definition
  from optional_indexes oi
  left join pg_indexes i
    on i.schemaname = 'public'
   and i.indexname = oi.index_name
),
related_index_rows as (
  select
    '08_related_index_state' as section,
    'index' as object_type,
    schemaname as schema_name,
    indexname as object_name,
    tablename as parent_object,
    indexdef as definition
  from pg_indexes
  where schemaname = 'public'
    and tablename in ('exam_attempts', 'profiles', 'violations', 'notifications', 'exam_questions', 'exams')
    and indexname not in (select index_name from optional_indexes)
),
related_column_rows as (
  select
    '09_related_column_state' as section,
    'column' as object_type,
    table_schema as schema_name,
    table_name || '.' || column_name as object_name,
    table_name as parent_object,
    jsonb_pretty(jsonb_build_object(
      'data_type', data_type,
      'udt_name', udt_name,
      'is_nullable', is_nullable,
      'column_default', column_default
    )) as definition
  from information_schema.columns
  where table_schema = 'public'
    and (
      (table_name = 'exam_attempts' and column_name in ('id', 'exam_id', 'student_id', 'submitted_at'))
      or (table_name = 'profiles' and column_name in ('id', 'role', 'status', 'email', 'student_number', 'employee_number', 'created_at'))
      or (table_name = 'violations' and column_name in ('id', 'student_id', 'exam_id', 'course_id', 'professor_id', 'violation_type', 'severity', 'created_at', 'screenshot_url', 'evidence_url', 'evidence_type', 'audio_level'))
    )
)
select section, object_type, schema_name, object_name, parent_object, definition
from policy_rows
union all
select section, object_type, schema_name, object_name, parent_object, definition from function_rows
union all
select section, object_type, schema_name, object_name, parent_object, definition from trigger_rows
union all
select section, object_type, schema_name, object_name, parent_object, definition from function_acl_rows
union all
select section, object_type, schema_name, object_name, parent_object, definition from table_rls_rows
union all
select section, object_type, schema_name, object_name, parent_object, definition from column_rows
union all
select section, object_type, schema_name, object_name, parent_object, definition from index_rows
union all
select section, object_type, schema_name, object_name, parent_object, definition from related_index_rows
union all
select section, object_type, schema_name, object_name, parent_object, definition from related_column_rows
order by section, parent_object, object_name;
