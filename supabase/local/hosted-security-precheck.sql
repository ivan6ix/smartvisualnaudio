-- Hosted security hardening precheck.
-- Read-only: run manually against hosted Supabase before any deployment SQL.

select '01_required_tables' as section, expected.table_name, (t.table_name is not null) as present
from (
  values
    ('profiles'), ('courses'), ('course_enrollments'), ('exams'), ('exam_questions'),
    ('exam_attempts'), ('exam_attempt_answers'), ('violations'), ('notifications'),
    ('messages'), ('logs'), ('exam_reviews'), ('exam_approval_logs'),
    ('exam_rejection_logs'), ('exam_start_sessions')
) as expected(table_name)
left join information_schema.tables t
  on t.table_schema = 'public'
 and t.table_name = expected.table_name
order by expected.table_name;

select
  '02_required_columns' as section,
  expected.table_name,
  expected.column_name,
  expected.requirement,
  case
    when c.column_name is not null then expected.requirement || '_PRESENT'
    when expected.requirement = 'CREATED_BY_SECURITY_MIGRATION' then 'COLUMN_MISSING_EXPECTED_PREDEPLOYMENT'
    else expected.requirement || '_MISSING'
  end as status,
  c.data_type,
  c.udt_name
from (
  values
    ('profiles','id','REQUIRED'), ('profiles','role','REQUIRED'), ('profiles','status','REQUIRED'), ('profiles','email','REQUIRED'), ('profiles','student_number','REQUIRED'), ('profiles','employee_number','REQUIRED'), ('profiles','created_at','REQUIRED'),
    ('courses','id','REQUIRED'), ('courses','professor_id','REQUIRED'), ('courses','joining_code','REQUIRED'), ('courses','archived','REQUIRED'), ('courses','program_id','REQUIRED'), ('courses','year_level','REQUIRED'), ('courses','section','REQUIRED'), ('courses','semester','REQUIRED'), ('courses','academic_year','REQUIRED'),
    ('course_enrollments','course_id','REQUIRED'), ('course_enrollments','student_id','REQUIRED'),
    ('exams','id','REQUIRED'), ('exams','course_id','REQUIRED'), ('exams','professor_id','REQUIRED'), ('exams','created_by','REQUIRED'), ('exams','status','REQUIRED'), ('exams','exam_settings','REQUIRED'),
    ('exam_questions','id','REQUIRED'), ('exam_questions','exam_id','REQUIRED'), ('exam_questions','question_text','REQUIRED'), ('exam_questions','question_type','REQUIRED'), ('exam_questions','choices','REQUIRED'), ('exam_questions','correct_answer','REQUIRED'), ('exam_questions','correct_answers','REQUIRED'), ('exam_questions','question_config','REQUIRED'), ('exam_questions','manual_grading','REQUIRED'), ('exam_questions','points','REQUIRED'),
    ('exam_attempts','id','REQUIRED'), ('exam_attempts','exam_id','REQUIRED'), ('exam_attempts','student_id','REQUIRED'), ('exam_attempts','score','REQUIRED'), ('exam_attempts','violations','REQUIRED'), ('exam_attempts','status','REQUIRED'), ('exam_attempts','started_at','REQUIRED'), ('exam_attempts','submitted_at','REQUIRED'), ('exam_attempts','submission_session_started_at','CREATED_BY_SECURITY_MIGRATION'),
    ('exam_attempt_answers','attempt_id','REQUIRED'), ('exam_attempt_answers','question_id','REQUIRED'), ('exam_attempt_answers','answer','REQUIRED'), ('exam_attempt_answers','file_url','REQUIRED'), ('exam_attempt_answers','earned_points','REQUIRED'), ('exam_attempt_answers','max_points','REQUIRED'), ('exam_attempt_answers','is_correct','REQUIRED'), ('exam_attempt_answers','needs_manual_grading','REQUIRED'),
    ('violations','id','REQUIRED'), ('violations','student_id','REQUIRED'), ('violations','exam_id','REQUIRED'), ('violations','course_id','REQUIRED'), ('violations','professor_id','REQUIRED'), ('violations','violation_type','REQUIRED'), ('violations','severity','REQUIRED'), ('violations','created_at','REQUIRED'), ('violations','screenshot_url','REQUIRED'), ('violations','evidence_url','REQUIRED'), ('violations','evidence_type','REQUIRED'), ('violations','audio_level','REQUIRED'),
    ('notifications','id','REQUIRED'), ('notifications','user_id','REQUIRED'), ('notifications','title','REQUIRED'), ('notifications','message','REQUIRED'), ('notifications','type','REQUIRED'), ('notifications','is_read','REQUIRED')
) as expected(table_name, column_name, requirement)
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = expected.table_name
 and c.column_name = expected.column_name
order by expected.table_name, expected.column_name;

select '03_foreign_keys' as section, tc.table_name, tc.constraint_name, kcu.column_name, ccu.table_name as target_table, ccu.column_name as target_column
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_schema = tc.constraint_schema
 and kcu.constraint_name = tc.constraint_name
join information_schema.constraint_column_usage ccu
  on ccu.constraint_schema = tc.constraint_schema
 and ccu.constraint_name = tc.constraint_name
where tc.table_schema = 'public'
  and tc.constraint_type = 'FOREIGN KEY'
  and tc.table_name in ('courses','course_enrollments','exams','exam_questions','exam_attempts','exam_attempt_answers','violations','notifications','exam_reviews','exam_approval_logs','exam_rejection_logs','exam_start_sessions')
order by tc.table_name, tc.constraint_name, kcu.ordinal_position;

select '04_rls_state' as section, n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('profiles','courses','course_enrollments','exams','exam_questions','exam_attempts','exam_attempt_answers','violations','notifications','messages','logs','exam_reviews','exam_approval_logs','exam_rejection_logs','exam_start_sessions')
order by c.relname;

select '05_current_policies' as section, schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles','courses','course_enrollments','exams','exam_questions','exam_attempts','exam_attempt_answers','violations','notifications','messages','logs','exam_reviews','exam_approval_logs','exam_rejection_logs')
order by tablename, policyname;

select
  '06_relevant_functions' as section,
  expected.proname,
  expected.requirement,
  case
    when p.oid is not null then expected.requirement || '_PRESENT'
    when expected.requirement = 'CREATED_BY_SECURITY_MIGRATION' then 'MISSING_EXPECTED_PREDEPLOYMENT'
    else expected.requirement || '_MISSING'
  end as status,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as security_definer,
  p.provolatile as volatility
from (
  values
    ('save_exam','REQUIRED'),
    ('exam_attempt_limit','REQUIRED'),
    ('authorize_exam_start','REQUIRED'),
    ('guard_exam_attempt_limit','REQUIRED'),
    ('is_audit_role','CREATED_BY_SECURITY_MIGRATION'),
    ('current_profile_role','CREATED_BY_SECURITY_MIGRATION'),
    ('is_student_enrolled_in_course','CREATED_BY_SECURITY_MIGRATION'),
    ('create_notification','CREATED_BY_SECURITY_MIGRATION'),
    ('protect_profile_privileged_fields','CREATED_BY_SECURITY_MIGRATION'),
    ('sanitize_student_question_config','CREATED_BY_SECURITY_MIGRATION'),
    ('student_can_take_exam','CREATED_BY_SECURITY_MIGRATION'),
    ('get_student_exam_questions','CREATED_BY_SECURITY_MIGRATION'),
    ('grade_exam_answer','CREATED_BY_SECURITY_MIGRATION'),
    ('submit_exam_attempt','CREATED_BY_SECURITY_MIGRATION'),
    ('join_course_by_code','CREATED_BY_SECURITY_MIGRATION'),
    ('protect_student_violation_updates','CREATED_BY_SECURITY_MIGRATION')
) as expected(proname, requirement)
left join pg_proc p
  on p.pronamespace = 'public'::regnamespace
 and p.proname = expected.proname
order by expected.proname, args;

select '07_relevant_triggers' as section, event_object_table as table_name, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in ('profiles','exam_attempts','violations')
order by event_object_table, trigger_name, event_manipulation;

select '08_expected_index' as section, schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'exam_attempts'
  and indexname = 'exam_attempts_one_submission_per_start_session';

select
  '08b_security_created_objects' as section,
  expected.object_type,
  expected.object_name,
  case when actual.object_name is null then 'MISSING_EXPECTED_PREDEPLOYMENT' else 'PRESENT' end as status
from (
  values
    ('COLUMN','exam_attempts.submission_session_started_at'),
    ('INDEX','exam_attempts_one_submission_per_start_session'),
    ('TRIGGER','profiles.protect_profile_privileged_fields'),
    ('TRIGGER','violations.protect_student_violation_updates'),
    ('FUNCTION','is_audit_role'),
    ('FUNCTION','current_profile_role'),
    ('FUNCTION','is_student_enrolled_in_course'),
    ('FUNCTION','create_notification'),
    ('FUNCTION','protect_profile_privileged_fields'),
    ('FUNCTION','sanitize_student_question_config'),
    ('FUNCTION','student_can_take_exam'),
    ('FUNCTION','get_student_exam_questions'),
    ('FUNCTION','grade_exam_answer'),
    ('FUNCTION','submit_exam_attempt'),
    ('FUNCTION','join_course_by_code'),
    ('FUNCTION','protect_student_violation_updates')
) as expected(object_type, object_name)
left join (
  select 'COLUMN' as object_type, table_name || '.' || column_name as object_name
  from information_schema.columns
  where table_schema = 'public'
  union all
  select 'INDEX', indexname
  from pg_indexes
  where schemaname = 'public'
  union all
  select 'TRIGGER', event_object_table || '.' || trigger_name
  from information_schema.triggers
  where trigger_schema = 'public'
  union all
  select 'FUNCTION', proname
  from pg_proc
  where pronamespace = 'public'::regnamespace
) actual
  on actual.object_type = expected.object_type
 and actual.object_name = expected.object_name
order by expected.object_type, expected.object_name;

select
  '09_submission_session_column_status' as section,
  'exam_attempts.submission_session_started_at' as object_name,
  case
    when exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'exam_attempts'
        and column_name = 'submission_session_started_at'
    ) then 'COLUMN_PRESENT'
    else 'COLUMN_MISSING_EXPECTED_PREDEPLOYMENT'
  end as status;

select
  '09_submission_session_duplicates' as section,
  exam_id,
  student_id,
  to_jsonb(a)->>'submission_session_started_at' as submission_session_started_at,
  count(*) as duplicate_count
from public.exam_attempts a
where to_jsonb(a)->>'submission_session_started_at' is not null
group by exam_id, student_id, to_jsonb(a)->>'submission_session_started_at'
having count(*) > 1
order by duplicate_count desc, exam_id, student_id;

select '10_exam_settings_parse_risks' as section, id as exam_id, status, exam_settings
from public.exams
where (exam_settings ? 'archived' and lower(exam_settings->>'archived') not in ('true','false'))
   or (nullif(exam_settings->>'startsAt', '') is not null and not (exam_settings->>'startsAt' ~ '^\d{4}-\d{2}-\d{2}'))
   or (nullif(exam_settings->>'deadline', '') is not null and not (exam_settings->>'deadline' ~ '^\d{4}-\d{2}-\d{2}'))
order by id;

select '11_profile_role_values' as section, role::text as role, count(*) as profile_count
from public.profiles
group by role
order by role::text;

select '12_orphan_checks' as section, check_name, row_count
from (
  select 'course_enrollments_without_course' as check_name, count(*) as row_count from public.course_enrollments ce left join public.courses c on c.id = ce.course_id where c.id is null
  union all select 'course_enrollments_without_profile', count(*) from public.course_enrollments ce left join public.profiles p on p.id = ce.student_id where p.id is null
  union all select 'exams_without_course', count(*) from public.exams e left join public.courses c on c.id = e.course_id where c.id is null
  union all select 'exam_questions_without_exam', count(*) from public.exam_questions q left join public.exams e on e.id = q.exam_id where e.id is null
  union all select 'attempts_without_exam', count(*) from public.exam_attempts a left join public.exams e on e.id = a.exam_id where e.id is null
  union all select 'attempts_without_profile', count(*) from public.exam_attempts a left join public.profiles p on p.id = a.student_id where p.id is null
  union all select 'answers_without_attempt', count(*) from public.exam_attempt_answers aa left join public.exam_attempts a on a.id = aa.attempt_id where a.id is null
  union all select 'violations_without_exam', count(*) from public.violations v left join public.exams e on e.id = v.exam_id where e.id is null
) checks
order by check_name;

select '13_grants' as section, routine_schema, routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('get_student_exam_questions','submit_exam_attempt','join_course_by_code','create_notification','student_can_take_exam','grade_exam_answer','protect_profile_privileged_fields','protect_student_violation_updates')
order by routine_name, grantee, privilege_type;

with
required_tables(table_name) as (
  values
    ('profiles'), ('courses'), ('course_enrollments'), ('exams'), ('exam_questions'),
    ('exam_attempts'), ('exam_attempt_answers'), ('violations'), ('notifications'),
    ('messages'), ('logs'), ('exam_reviews'), ('exam_approval_logs'),
    ('exam_rejection_logs'), ('exam_start_sessions')
),
required_columns(table_name, column_name, requirement) as (
  values
    ('profiles','id','REQUIRED'), ('profiles','role','REQUIRED'), ('profiles','status','REQUIRED'), ('profiles','email','REQUIRED'), ('profiles','student_number','REQUIRED'), ('profiles','employee_number','REQUIRED'), ('profiles','created_at','REQUIRED'),
    ('courses','id','REQUIRED'), ('courses','professor_id','REQUIRED'), ('courses','joining_code','REQUIRED'), ('courses','archived','REQUIRED'), ('courses','program_id','REQUIRED'), ('courses','year_level','REQUIRED'), ('courses','section','REQUIRED'), ('courses','semester','REQUIRED'), ('courses','academic_year','REQUIRED'),
    ('course_enrollments','course_id','REQUIRED'), ('course_enrollments','student_id','REQUIRED'),
    ('exams','id','REQUIRED'), ('exams','course_id','REQUIRED'), ('exams','professor_id','REQUIRED'), ('exams','created_by','REQUIRED'), ('exams','status','REQUIRED'), ('exams','exam_settings','REQUIRED'),
    ('exam_questions','id','REQUIRED'), ('exam_questions','exam_id','REQUIRED'), ('exam_questions','question_text','REQUIRED'), ('exam_questions','question_type','REQUIRED'), ('exam_questions','choices','REQUIRED'), ('exam_questions','correct_answer','REQUIRED'), ('exam_questions','correct_answers','REQUIRED'), ('exam_questions','question_config','REQUIRED'), ('exam_questions','manual_grading','REQUIRED'), ('exam_questions','points','REQUIRED'),
    ('exam_attempts','id','REQUIRED'), ('exam_attempts','exam_id','REQUIRED'), ('exam_attempts','student_id','REQUIRED'), ('exam_attempts','score','REQUIRED'), ('exam_attempts','violations','REQUIRED'), ('exam_attempts','status','REQUIRED'), ('exam_attempts','started_at','REQUIRED'), ('exam_attempts','submitted_at','REQUIRED'), ('exam_attempts','submission_session_started_at','CREATED_BY_SECURITY_MIGRATION'),
    ('exam_attempt_answers','attempt_id','REQUIRED'), ('exam_attempt_answers','question_id','REQUIRED'), ('exam_attempt_answers','answer','REQUIRED'), ('exam_attempt_answers','file_url','REQUIRED'), ('exam_attempt_answers','earned_points','REQUIRED'), ('exam_attempt_answers','max_points','REQUIRED'), ('exam_attempt_answers','is_correct','REQUIRED'), ('exam_attempt_answers','needs_manual_grading','REQUIRED'),
    ('violations','id','REQUIRED'), ('violations','student_id','REQUIRED'), ('violations','exam_id','REQUIRED'), ('violations','course_id','REQUIRED'), ('violations','professor_id','REQUIRED'), ('violations','violation_type','REQUIRED'), ('violations','severity','REQUIRED'), ('violations','created_at','REQUIRED'), ('violations','screenshot_url','REQUIRED'), ('violations','evidence_url','REQUIRED'), ('violations','evidence_type','REQUIRED'), ('violations','audio_level','REQUIRED'),
    ('notifications','id','REQUIRED'), ('notifications','user_id','REQUIRED'), ('notifications','title','REQUIRED'), ('notifications','message','REQUIRED'), ('notifications','type','REQUIRED'), ('notifications','is_read','REQUIRED')
),
required_lifecycle_functions(proname) as (
  values ('save_exam'), ('authorize_exam_start'), ('exam_attempt_limit'), ('guard_exam_attempt_limit')
),
security_objects(object_type, object_name) as (
  values
    ('COLUMN','exam_attempts.submission_session_started_at'),
    ('INDEX','exam_attempts_one_submission_per_start_session'),
    ('TRIGGER','profiles.protect_profile_privileged_fields'),
    ('TRIGGER','violations.protect_student_violation_updates'),
    ('FUNCTION','is_audit_role'),
    ('FUNCTION','current_profile_role'),
    ('FUNCTION','is_student_enrolled_in_course'),
    ('FUNCTION','create_notification'),
    ('FUNCTION','protect_profile_privileged_fields'),
    ('FUNCTION','sanitize_student_question_config'),
    ('FUNCTION','student_can_take_exam'),
    ('FUNCTION','get_student_exam_questions'),
    ('FUNCTION','grade_exam_answer'),
    ('FUNCTION','submit_exam_attempt'),
    ('FUNCTION','join_course_by_code'),
    ('FUNCTION','protect_student_violation_updates')
),
important_policies(table_name, policy_name, expectation) as (
  values
    ('profiles','profiles_read_authenticated','CURRENT_OR_BASELINE'),
    ('profiles','profiles_self_update','CURRENT_OR_HARDENED'),
    ('notifications','notifications_owner','CURRENT_REQUIRED'),
    ('notifications','notifications_owner_update','CURRENT_REQUIRED'),
    ('exam_attempts','attempts_owner','CURRENT_REQUIRED'),
    ('exam_attempts','attempts_student_delete_own','REMOVED_BY_SECURITY_MIGRATION'),
    ('exam_attempts','attempts_student_insert','REMOVED_BY_SECURITY_MIGRATION'),
    ('exam_attempt_answers','attempt_answers_student_insert','REMOVED_BY_SECURITY_MIGRATION'),
    ('exam_questions','exam_questions_student_read_available','REMOVED_BY_SECURITY_MIGRATION'),
    ('notifications','notifications_authenticated_insert','REMOVED_BY_SECURITY_MIGRATION'),
    ('exams','exams_read_authenticated','REMOVED_BY_SECURITY_MIGRATION'),
    ('exams','exams_cluster_review_update','REMOVED_BY_SECURITY_MIGRATION')
),
target_rls(table_name) as (
  values
    ('profiles'), ('courses'), ('course_enrollments'), ('exams'), ('exam_questions'),
    ('exam_attempts'), ('exam_attempt_answers'), ('violations'), ('notifications'),
    ('messages'), ('logs'), ('exam_reviews'), ('exam_approval_logs'),
    ('exam_rejection_logs'), ('exam_start_sessions')
),
orphan_counts(check_name, row_count) as (
  select 'course_enrollments_without_course', count(*) from public.course_enrollments ce left join public.courses c on c.id = ce.course_id where c.id is null
  union all select 'course_enrollments_without_profile', count(*) from public.course_enrollments ce left join public.profiles p on p.id = ce.student_id where p.id is null
  union all select 'exams_without_course', count(*) from public.exams e left join public.courses c on c.id = e.course_id where c.id is null
  union all select 'exam_questions_without_exam', count(*) from public.exam_questions q left join public.exams e on e.id = q.exam_id where e.id is null
  union all select 'attempts_without_exam', count(*) from public.exam_attempts a left join public.exams e on e.id = a.exam_id where e.id is null
  union all select 'attempts_without_profile', count(*) from public.exam_attempts a left join public.profiles p on p.id = a.student_id where p.id is null
  union all select 'answers_without_attempt', count(*) from public.exam_attempt_answers aa left join public.exam_attempts a on a.id = aa.attempt_id where a.id is null
  union all select 'violations_without_exam', count(*) from public.violations v left join public.exams e on e.id = v.exam_id where e.id is null
),
summary as (
  select
    'required_tables' as section,
    rt.table_name as check_name,
    case when t.table_name is null then 'REQUIRED_MISSING' else 'PASS' end as status,
    case when t.table_name is null then 'Required table is missing.' else 'Required table is present.' end as details
  from required_tables rt
  left join information_schema.tables t on t.table_schema = 'public' and t.table_name = rt.table_name

  union all
  select
    'required_columns',
    rc.table_name || '.' || rc.column_name,
    case
      when c.column_name is not null then 'PASS'
      when rc.requirement = 'CREATED_BY_SECURITY_MIGRATION' then 'EXPECTED_PREDEPLOYMENT'
      else 'REQUIRED_MISSING'
    end,
    case
      when c.column_name is not null then 'Column is present.'
      when rc.requirement = 'CREATED_BY_SECURITY_MIGRATION' then 'Column is expected to be added by hosted-security-deployment.sql.'
      else 'Required column is missing.'
    end
  from required_columns rc
  left join information_schema.columns c on c.table_schema = 'public' and c.table_name = rc.table_name and c.column_name = rc.column_name

  union all
  select
    'rls_state',
    tr.table_name,
    case when c.oid is null then 'REQUIRED_MISSING' when c.relrowsecurity then 'PASS' else 'CONFLICT' end,
    case when c.oid is null then 'Table missing.' when c.relrowsecurity then 'RLS is enabled.' else 'RLS is not enabled.' end
  from target_rls tr
  left join pg_class c on c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = tr.table_name

  union all
  select
    'lifecycle_functions',
    rlf.proname,
    case when p.oid is null then 'REQUIRED_MISSING' else 'PASS' end,
    case when p.oid is null then 'Required lifecycle function is missing.' else 'Required lifecycle function exists: ' || pg_get_function_identity_arguments(p.oid) end
  from required_lifecycle_functions rlf
  left join pg_proc p on p.pronamespace = 'public'::regnamespace and p.proname = rlf.proname

  union all
  select
    'required_triggers',
    'exam_attempts.guard_exam_attempt_limit',
    case when t.trigger_name is null then 'REQUIRED_MISSING' else 'PASS' end,
    case when t.trigger_name is null then 'Required attempt-limit trigger is missing.' else 'Required attempt-limit trigger is present.' end
  from (values (1)) v(x)
  left join information_schema.triggers t on t.trigger_schema = 'public' and t.event_object_table = 'exam_attempts' and t.trigger_name = 'guard_exam_attempt_limit'

  union all
  select
    'important_policies',
    ip.table_name || '.' || ip.policy_name,
    case
      when p.policyname is not null then 'PASS'
      when ip.expectation = 'REMOVED_BY_SECURITY_MIGRATION' then 'EXPECTED_PREDEPLOYMENT'
      else 'WARNING'
    end,
    case
      when p.policyname is not null then 'Policy currently exists.'
      when ip.expectation = 'REMOVED_BY_SECURITY_MIGRATION' then 'Policy already absent; deployment will keep/ensure hardened state.'
      else 'Important current policy was not found; review detailed policy output.'
    end
  from important_policies ip
  left join pg_policies p on p.schemaname = 'public' and p.tablename = ip.table_name and p.policyname = ip.policy_name

  union all
  select
    'security_created_objects',
    so.object_type || '.' || so.object_name,
    case when actual.object_name is null then 'EXPECTED_PREDEPLOYMENT' else 'PASS' end,
    case when actual.object_name is null then 'Object is expected to be created by hosted-security-deployment.sql.' else 'Object already exists.' end
  from security_objects so
  left join (
    select 'COLUMN' as object_type, table_name || '.' || column_name as object_name from information_schema.columns where table_schema = 'public'
    union all select 'INDEX', indexname from pg_indexes where schemaname = 'public'
    union all select 'TRIGGER', event_object_table || '.' || trigger_name from information_schema.triggers where trigger_schema = 'public'
    union all select 'FUNCTION', proname from pg_proc where pronamespace = 'public'::regnamespace
  ) actual on actual.object_type = so.object_type and actual.object_name = so.object_name

  union all
  select
    'submission_session_duplicate_safety',
    'exam_attempts_one_submission_per_start_session_data',
    case when count(*) = 0 then 'PASS' else 'CONFLICT' end,
    case when count(*) = 0 then 'No duplicate non-null submission sessions found, or column is absent predeployment.' else count(*)::text || ' duplicate group(s) would conflict with the unique index.' end
  from (
    select exam_id, student_id, to_jsonb(a)->>'submission_session_started_at' as started_at, count(*) as row_count
    from public.exam_attempts a
    where to_jsonb(a)->>'submission_session_started_at' is not null
    group by exam_id, student_id, to_jsonb(a)->>'submission_session_started_at'
    having count(*) > 1
  ) duplicates

  union all
  select
    'role_values',
    'profiles.role',
    case when count(*) = 0 then 'PASS' else 'CONFLICT' end,
    case when count(*) = 0 then 'All profile roles are expected values.' else 'Unexpected role value count: ' || count(*)::text end
  from public.profiles
  where role::text not in ('Admin','Professor','Cluster Professor','Student','Dean')

  union all
  select
    'exam_settings_parse_risks',
    'exams.exam_settings',
    case when count(*) = 0 then 'PASS' else 'WARNING' end,
    case when count(*) = 0 then 'No malformed relevant exam settings detected.' else count(*)::text || ' exam(s) have archived/startsAt/deadline values to review.' end
  from public.exams
  where (exam_settings ? 'archived' and lower(exam_settings->>'archived') not in ('true','false'))
     or (nullif(exam_settings->>'startsAt', '') is not null and not (exam_settings->>'startsAt' ~ '^\d{4}-\d{2}-\d{2}'))
     or (nullif(exam_settings->>'deadline', '') is not null and not (exam_settings->>'deadline' ~ '^\d{4}-\d{2}-\d{2}'))

  union all
  select
    'orphan_integrity',
    check_name,
    case when row_count = 0 then 'PASS' else 'CONFLICT' end,
    row_count::text || ' row(s)'
  from orphan_counts
)
select section, check_name, status, details
from summary
union all
select
  'deployment_readiness',
  'blocking_conditions',
  case when count(*) = 0 then 'PASS' else 'CONFLICT' end,
  case when count(*) = 0 then 'No REQUIRED_MISSING or CONFLICT rows in consolidated precheck.' else count(*)::text || ' blocking row(s): review REQUIRED_MISSING and CONFLICT statuses above.' end
from summary
where status in ('REQUIRED_MISSING','CONFLICT')
order by section, check_name;
