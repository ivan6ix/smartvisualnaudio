-- Hosted security hardening postcheck.
-- Read-only: run manually after reviewed deployment SQL has been applied.

with
expected_functions(proname, args, requirement) as (
  values
    ('create_notification','p_workflow text, p_recipient_id uuid, p_title text, p_message text, p_type text, p_context_id uuid','client_rpc'),
    ('current_profile_role','','helper'),
    ('get_student_exam_questions','p_exam_id uuid','client_rpc'),
    ('grade_exam_answer','p_question exam_questions, p_answer jsonb','internal_helper'),
    ('is_audit_role','','helper'),
    ('is_student_enrolled_in_course','target_course_id uuid','helper'),
    ('join_course_by_code','p_joining_code text','client_rpc'),
    ('protect_profile_privileged_fields','','trigger_function'),
    ('protect_student_violation_updates','','trigger_function'),
    ('sanitize_student_question_config','p_question exam_questions, p_seed text','helper'),
    ('student_can_take_exam','p_exam_id uuid','helper'),
    ('submit_exam_attempt','p_exam_id uuid, p_answers jsonb, p_violations jsonb','client_rpc'),
    ('authorize_exam_start','p_exam_id uuid','lifecycle'),
    ('exam_attempt_limit','p_settings jsonb','lifecycle'),
    ('guard_exam_attempt_limit','','lifecycle'),
    ('save_exam','p_id uuid, p_exam jsonb, p_questions jsonb','lifecycle')
),
expected_triggers(table_name, trigger_name, function_name) as (
  values
    ('profiles','protect_profile_privileged_fields','protect_profile_privileged_fields'),
    ('violations','protect_student_violation_updates','protect_student_violation_updates'),
    ('exam_attempts','guard_exam_attempt_limit','guard_exam_attempt_limit')
),
removed_policies(table_name, policy_name) as (
  values
    ('exam_questions','exam_questions_student_read_available'),
    ('exam_attempts','attempts_student_insert'),
    ('exam_attempts','attempts_student_delete_own'),
    ('exam_attempt_answers','attempt_answers_student_insert'),
    ('notifications','notifications_authenticated_insert'),
    ('courses','courses_read_authenticated'),
    ('exams','exams_read_authenticated'),
    ('exams','exams_cluster_review_update'),
    ('exam_approval_logs','exam_approval_logs_read_authenticated'),
    ('exam_rejection_logs','exam_rejection_logs_read_authenticated')
),
expected_policies(table_name, policy_name, cmd, using_like, check_like) as (
  values
    ('profiles','profiles_self_update','update','auth.uid() = id','auth.uid() = id'),
    ('courses','courses_admin_dean_read','select','is_audit_role',null),
    ('courses','courses_cluster_read','select','Cluster Professor',null),
    ('courses','courses_professor_read_own','select','professor_id = auth.uid()',null),
    ('courses','courses_student_read_enrolled','select','is_student_enrolled_in_course',null),
    ('exams','exams_admin_dean_read','select','is_audit_role',null),
    ('exams','exams_cluster_review_read','select','Cluster Professor',null),
    ('exams','exams_student_read_available','select','student_can_take_exam',null),
    ('exam_approval_logs','exam_approval_logs_reviewer_read','select','is_audit_role',null),
    ('exam_rejection_logs','exam_rejection_logs_reviewer_read','select','is_audit_role',null),
    ('violations','violations_student_insert','insert',null,'student_can_take_exam')
),
protected_tables(table_name) as (
  values
    ('profiles'), ('courses'), ('course_enrollments'), ('exams'), ('exam_questions'),
    ('exam_attempts'), ('exam_attempt_answers'), ('violations'), ('notifications'),
    ('messages'), ('logs'), ('exam_reviews'), ('exam_approval_logs'), ('exam_rejection_logs')
),
function_checks as (
  select
    'functions' as section,
    ef.proname || '(' || ef.args || ')' as check_name,
    case when p.oid is null then 'FAIL' else 'PASS' end as status,
    case
      when p.oid is null then 'Expected ' || ef.requirement || ' function is missing.'
      else 'Function exists; security_definer=' || p.prosecdef::text || ', volatility=' || p.provolatile::text
    end as details
  from expected_functions ef
  left join pg_proc p
    on p.pronamespace = 'public'::regnamespace
   and p.proname = ef.proname
   and pg_get_function_identity_arguments(p.oid) = ef.args
),
column_checks as (
  select
    'column_index' as section,
    'exam_attempts.submission_session_started_at' as check_name,
    case when c.column_name is not null and c.udt_name = 'timestamptz' then 'PASS' else 'FAIL' end as status,
    coalesce('Column exists: data_type=' || c.data_type || ', udt_name=' || c.udt_name || ', nullable=' || c.is_nullable, 'Expected timestamptz column is missing.') as details
  from (values (1)) v(x)
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = 'exam_attempts'
   and c.column_name = 'submission_session_started_at'
),
index_checks as (
  select
    'column_index' as section,
    'exam_attempts_one_submission_per_start_session' as check_name,
    case
      when i.indexdef ilike '%unique%'
       and i.indexdef ilike '%exam_id%'
       and i.indexdef ilike '%student_id%'
       and i.indexdef ilike '%submission_session_started_at%'
       and i.indexdef ilike '%where%'
       and i.indexdef ilike '%submission_session_started_at is not null%'
      then 'PASS'
      else 'FAIL'
    end as status,
    coalesce(i.indexdef, 'Expected unique partial submission-session index is missing.') as details
  from (values (1)) v(x)
  left join pg_indexes i
    on i.schemaname = 'public'
   and i.indexname = 'exam_attempts_one_submission_per_start_session'
),
trigger_checks as (
  select
    'triggers' as section,
    et.table_name || '.' || et.trigger_name as check_name,
    case when t.oid is not null and pg_get_triggerdef(t.oid, true) ilike '%' || et.function_name || '%' then 'PASS' else 'FAIL' end as status,
    coalesce(pg_get_triggerdef(t.oid, true), 'Expected trigger is missing or targets the wrong function.') as details
  from expected_triggers et
  left join pg_class c
    on c.relnamespace = 'public'::regnamespace
   and c.relname = et.table_name
  left join pg_trigger t
    on t.tgrelid = c.oid
   and t.tgname = et.trigger_name
   and not t.tgisinternal
),
removed_policy_checks as (
  select
    'removed_permissive_policies' as section,
    rp.table_name || '.' || rp.policy_name as check_name,
    case when p.policyname is null then 'PASS' else 'FAIL' end as status,
    case when p.policyname is null then 'Policy is absent.' else 'Policy still exists and should have been removed.' end as details
  from removed_policies rp
  left join pg_policies p
    on p.schemaname = 'public'
   and p.tablename = rp.table_name
   and p.policyname = rp.policy_name
),
expected_policy_checks as (
  select
    'hardened_policies' as section,
    ep.table_name || '.' || ep.policy_name as check_name,
    case
      when p.policyname is null then 'FAIL'
      when lower(p.cmd::text) <> ep.cmd then 'FAIL'
      when ep.using_like is not null and coalesce(p.qual, '') not ilike '%' || ep.using_like || '%' then 'FAIL'
      when ep.check_like is not null and coalesce(p.with_check, '') not ilike '%' || ep.check_like || '%' then 'FAIL'
      else 'PASS'
    end as status,
    coalesce('cmd=' || p.cmd::text || '; using=' || coalesce(p.qual::text, '<null>') || '; with_check=' || coalesce(p.with_check::text, '<null>'), 'Expected hardened policy is missing.') as details
  from expected_policies ep
  left join pg_policies p
    on p.schemaname = 'public'
   and p.tablename = ep.table_name
   and p.policyname = ep.policy_name
),
rls_checks as (
  select
    'rls' as section,
    pt.table_name as check_name,
    case when c.oid is not null and c.relrowsecurity then 'PASS' else 'FAIL' end as status,
    case when c.oid is null then 'Protected table missing.' else 'rls_enabled=' || c.relrowsecurity::text || ', force_rls=' || c.relforcerowsecurity::text end as details
  from protected_tables pt
  left join pg_class c
    on c.relnamespace = 'public'::regnamespace
   and c.relkind = 'r'
   and c.relname = pt.table_name
),
grant_checks as (
  select
    'function_privileges' as section,
    ef.proname || '(' || ef.args || ')' as check_name,
    case
      when p.oid is null then 'FAIL'
      when ef.requirement = 'client_rpc'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and not has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'PASS'
      when ef.requirement = 'helper'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and not has_function_privilege('anon', p.oid, 'EXECUTE')
      then 'PASS'
      when ef.requirement in ('internal_helper','trigger_function')
       and not has_function_privilege('anon', p.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      then 'PASS'
      when ef.requirement = 'lifecycle' then 'PASS'
      else 'FAIL'
    end as status,
    case
      when p.oid is null then 'Function missing.'
      else 'anon_execute=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
        || ', authenticated_execute=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
        || ', public_execute=' || has_function_privilege('public', p.oid, 'EXECUTE')::text
        || ', requirement=' || ef.requirement
    end as details
  from expected_functions ef
  left join pg_proc p
    on p.pronamespace = 'public'::regnamespace
   and p.proname = ef.proname
   and pg_get_function_identity_arguments(p.oid) = ef.args
),
duplicate_checks as (
  select
    'submission_idempotency' as section,
    'duplicate_non_null_submission_sessions' as check_name,
    case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
    case when count(*) = 0 then 'No duplicate non-null submission-session keys.' else count(*)::text || ' duplicate group(s) found.' end as details
  from (
    select exam_id, student_id, submission_session_started_at, count(*)
    from public.exam_attempts
    where submission_session_started_at is not null
    group by exam_id, student_id, submission_session_started_at
    having count(*) > 1
  ) duplicates
),
profile_security_checks as (
  select
    'profile_security' as section,
    'privileged_profile_field_protection' as check_name,
    case
      when exists (
        select 1 from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname = 'protect_profile_privileged_fields'
      )
      and exists (
        select 1
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        where c.relnamespace = 'public'::regnamespace
          and c.relname = 'profiles'
          and t.tgname = 'protect_profile_privileged_fields'
          and not t.tgisinternal
      )
      then 'PASS'
      else 'FAIL'
    end as status,
    'Profile protection function and trigger must both exist.' as details
),
student_exam_security_checks as (
  select 'student_exam_security' as section, 'direct_attempt_insert_policy_removed' as check_name,
    case when not exists (select 1 from pg_policies where schemaname='public' and tablename='exam_attempts' and policyname='attempts_student_insert') then 'PASS' else 'FAIL' end as status,
    'Students should submit through submit_exam_attempt, not direct attempt writes.' as details
  union all
  select 'student_exam_security', 'direct_attempt_delete_policy_removed',
    case when not exists (select 1 from pg_policies where schemaname='public' and tablename='exam_attempts' and policyname='attempts_student_delete_own') then 'PASS' else 'FAIL' end,
    'Students should not delete attempts to reset limits.'
  union all
  select 'student_exam_security', 'direct_attempt_answer_insert_policy_removed',
    case when not exists (select 1 from pg_policies where schemaname='public' and tablename='exam_attempt_answers' and policyname='attempt_answers_student_insert') then 'PASS' else 'FAIL' end,
    'Students should not directly write answers.'
  union all
  select 'student_exam_security', 'answer_key_policy_removed',
    case when not exists (select 1 from pg_policies where schemaname='public' and tablename='exam_questions' and policyname='exam_questions_student_read_available') then 'PASS' else 'FAIL' end,
    'Students should retrieve sanitized questions through get_student_exam_questions.'
),
notification_security_checks as (
  select
    'notification_security' as section,
    'arbitrary_authenticated_notification_insert_removed' as check_name,
    case when not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='notifications_authenticated_insert') then 'PASS' else 'FAIL' end as status,
    'Notifications should be created through create_notification.' as details
),
cluster_security_checks as (
  select
    'cluster_professor_security' as section,
    'unrestricted_cluster_exam_update_removed' as check_name,
    case when not exists (select 1 from pg_policies where schemaname='public' and tablename='exams' and policyname='exams_cluster_review_update') then 'PASS' else 'FAIL' end as status,
    'Cluster Professor access should be limited to review workflow policies.' as details
),
violation_security_checks as (
  select
    'violation_security' as section,
    'trusted_violation_field_protection' as check_name,
    case
      when exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='protect_student_violation_updates')
       and exists (
         select 1
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         where c.relnamespace='public'::regnamespace
           and c.relname='violations'
           and t.tgname='protect_student_violation_updates'
           and not t.tgisinternal
       )
       and exists (select 1 from pg_policies where schemaname='public' and tablename='violations' and policyname='violations_student_insert')
      then 'PASS'
      else 'FAIL'
    end as status,
    'Violation insert policy plus trusted-field update trigger must be installed.' as details
),
visibility_checks as (
  select 'course_exam_visibility' as section, 'broad_courses_read_removed' as check_name,
    case when not exists (select 1 from pg_policies where schemaname='public' and tablename='courses' and policyname='courses_read_authenticated') then 'PASS' else 'FAIL' end as status,
    'Broad authenticated course read policy should be absent.' as details
  union all
  select 'course_exam_visibility', 'broad_exams_read_removed',
    case when not exists (select 1 from pg_policies where schemaname='public' and tablename='exams' and policyname='exams_read_authenticated') then 'PASS' else 'FAIL' end,
    'Broad authenticated exam read policy should be absent.'
),
all_checks as (
  select * from function_checks
  union all select * from column_checks
  union all select * from index_checks
  union all select * from trigger_checks
  union all select * from removed_policy_checks
  union all select * from expected_policy_checks
  union all select * from rls_checks
  union all select * from grant_checks
  union all select * from duplicate_checks
  union all select * from profile_security_checks
  union all select * from student_exam_security_checks
  union all select * from notification_security_checks
  union all select * from cluster_security_checks
  union all select * from violation_security_checks
  union all select * from visibility_checks
),
readiness as (
  select
    'deployment_readiness' as section,
    'hosted_security_postcheck' as check_name,
    case when count(*) filter (where status = 'FAIL') = 0 then 'PASS' else 'FAIL' end as status,
    case
      when count(*) filter (where status = 'FAIL') = 0 then 'Zero blocking FAIL rows.'
      else count(*) filter (where status = 'FAIL') || ' blocking FAIL row(s): ' || string_agg(check_name, ', ' order by section, check_name) filter (where status = 'FAIL')
    end as details
  from all_checks
)
select section, check_name, status, details
from all_checks
union all
select section, check_name, status, details
from readiness
order by section, check_name;
