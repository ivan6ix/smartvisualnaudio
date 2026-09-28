-- Feature #1 scoring foundation hosted precheck. Read-only.
-- Final statement intentionally returns one consolidated table for Supabase SQL Editor.

with
question_points as (
  select
    count(*) filter (where points is null) as null_points,
    count(*) filter (where points < 0.01) as below_min,
    count(*) filter (where points > 1000.00) as above_max
  from public.exam_questions
),
answer_snapshots as (
  select
    count(*) filter (where max_points is not null and max_points < 0) as negative_max,
    count(*) filter (where earned_points is not null and earned_points < 0) as negative_earned,
    count(*) filter (where earned_points is not null and max_points is not null and earned_points > max_points) as earned_above_max
  from public.exam_attempt_answers
),
attempt_totals as (
  select
    count(*) filter (where earned_points is not null and earned_points < 0) as negative_earned,
    count(*) filter (where max_points is not null and max_points < 0) as negative_max,
    count(*) filter (where earned_points is not null and max_points is not null and earned_points > max_points) as earned_above_max,
    count(*) filter (where score is not null and (score < 0 or score > 100)) as score_out_of_range
  from public.exam_attempts
),
historical_attempts as (
  select
    a.id,
    count(aa.id) as answer_count,
    count(*) filter (where aa.id is not null and aa.max_points is null) as missing_max,
    count(*) filter (where aa.id is not null and aa.earned_points is null) as missing_earned,
    bool_or(a.earned_points is null or a.max_points is null) as missing_attempt_totals
  from public.exam_attempts a
  left join public.exam_attempt_answers aa on aa.attempt_id = a.id
  group by a.id
),
historical_summary as (
  select
    count(*) filter (where missing_attempt_totals) as missing_raw_totals,
    count(*) filter (where answer_count > 0 and missing_max = 0 and missing_earned = 0) as safe_backfill_count,
    count(*) filter (where answer_count = 0 or missing_max > 0 or missing_earned > 0) as unsafe_or_incomplete_count,
    count(*) filter (where answer_count = 0) as no_answer_rows
  from historical_attempts
),
expected_functions(function_name, identity_args, expected_predeploy_state) as (
  values
    ('submit_exam_attempt', 'p_exam_id uuid, p_answers jsonb, p_violations jsonb', 'EXISTS'),
    ('grade_exam_answer', 'p_question exam_questions, p_answer jsonb', 'EXISTS'),
    ('grade_exam_attempt_answer', 'p_answer_id uuid, p_earned_points numeric', 'EXPECTED_ABSENT'),
    ('recalculate_exam_attempt_score', 'p_attempt_id uuid', 'EXPECTED_ABSENT')
),
resolved_functions as (
  select
    ef.function_name,
    ef.identity_args,
    ef.expected_predeploy_state,
    p.oid
  from expected_functions ef
  left join pg_proc p
    on p.proname = ef.function_name
   and pg_get_function_identity_arguments(p.oid) = ef.identity_args
   and p.pronamespace = 'public'::regnamespace
),
rpc_grants as (
  select
    function_name,
    identity_args,
    case when oid is null then 'NOT_DEPLOYED' else has_function_privilege('public', oid, 'execute')::text end as public_execute,
    case when oid is null then 'NOT_DEPLOYED' else has_function_privilege('anon', oid, 'execute')::text end as anon_execute,
    case when oid is null then 'NOT_DEPLOYED' else has_function_privilege('authenticated', oid, 'execute')::text end as authenticated_execute
  from resolved_functions
),
rls_checks as (
  select
    relname,
    relrowsecurity
  from pg_class
  where oid in ('public.exam_questions'::regclass, 'public.exam_attempt_answers'::regclass, 'public.exam_attempts'::regclass)
),
idempotency_index as (
  select
    exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'exam_attempts'
        and indexname = 'exam_attempts_one_submission_per_start_session'
        and indexdef ilike '%unique%'
        and indexdef ilike '%exam_id%'
        and indexdef ilike '%student_id%'
        and indexdef ilike '%submission_session_started_at%'
        and indexdef ilike '%where%'
        and indexdef ilike '%submission_session_started_at is not null%'
    ) as present
),
blocking_failures as (
  select 'question_points_invalid' as check_name
  from question_points
  where null_points + below_min + above_max > 0
  union all
  select 'answer_snapshots_invalid'
  from answer_snapshots
  where negative_max + negative_earned + earned_above_max > 0
  union all
  select 'attempt_totals_invalid'
  from attempt_totals
  where negative_earned + negative_max + earned_above_max + score_out_of_range > 0
  union all
  select 'submit_exam_attempt_signature'
  from resolved_functions
  where function_name = 'submit_exam_attempt' and oid is null
  union all
  select 'rls_' || relname
  from rls_checks
  where not relrowsecurity
  union all
  select 'submission_idempotency_index'
  from idempotency_index
  where not present
),
blocking_summary as (
  select
    count(*) as blocking_count,
    coalesce(string_agg(check_name, '; ' order by check_name), 'none') as blocking_details
  from blocking_failures
),
results(ord, check_name, status, count_or_value, details) as (
  select
    10,
    'question_points_invalid',
    case when null_points + below_min + above_max = 0 then 'PASS' else 'FAIL' end,
    (null_points + below_min + above_max)::text,
    format('null=%s; below_min=%s; above_max=%s', null_points, below_min, above_max)
  from question_points
  union all
  select
    20,
    'answer_snapshots_invalid',
    case when negative_max + negative_earned + earned_above_max = 0 then 'PASS' else 'FAIL' end,
    (negative_max + negative_earned + earned_above_max)::text,
    format('negative_max=%s; negative_earned=%s; earned_above_max=%s', negative_max, negative_earned, earned_above_max)
  from answer_snapshots
  union all
  select
    30,
    'attempt_totals_invalid',
    case when negative_earned + negative_max + earned_above_max + score_out_of_range = 0 then 'PASS' else 'FAIL' end,
    (negative_earned + negative_max + earned_above_max + score_out_of_range)::text,
    format('negative_earned=%s; negative_max=%s; earned_above_max=%s; score_out_of_range=%s', negative_earned, negative_max, earned_above_max, score_out_of_range)
  from attempt_totals
  union all
  select
    40,
    'historical_attempts_missing_raw_totals',
    'INFO',
    missing_raw_totals::text,
    'Historical attempts with null attempt-level earned_points or max_points.'
  from historical_summary
  union all
  select
    50,
    'historical_safe_backfill_count',
    'SAFE',
    safe_backfill_count::text,
    'Attempts with answer rows and complete earned_points/max_points snapshots.'
  from historical_summary
  union all
  select
    60,
    'historical_unsafe_or_incomplete_count',
    'INFO',
    unsafe_or_incomplete_count::text,
    format('Not blocking predeploy; includes no_answer_rows=%s or missing answer snapshots.', no_answer_rows)
  from historical_summary
  union all
  select
    70,
    function_name || '_signature',
    case
      when oid is not null then 'PASS'
      when expected_predeploy_state = 'EXPECTED_ABSENT' then 'EXPECTED_ABSENT'
      else 'FAIL'
    end,
    coalesce(oid::text, 'absent'),
    format('expected=%s; args=%s', expected_predeploy_state, identity_args)
  from resolved_functions
  union all
  select
    80,
    'rpc_grants_' || function_name,
    case when public_execute = 'NOT_DEPLOYED' then 'NOT_DEPLOYED' else 'INFO' end,
    function_name,
    format('args=%s; public=%s; anon=%s; authenticated=%s', identity_args, public_execute, anon_execute, authenticated_execute)
  from rpc_grants
  union all
  select
    90,
    'rls_' || relname,
    case when relrowsecurity then 'PASS' else 'FAIL' end,
    relrowsecurity::text,
    'Row-level security must remain enabled.'
  from rls_checks
  union all
  select
    100,
    'submission_idempotency_index',
    case when present then 'PASS' else 'FAIL' end,
    present::text,
    'Unique partial index on exam_id, student_id, submission_session_started_at where session timestamp is not null.'
  from idempotency_index
  union all
  select
    999,
    'deployment_readiness',
    case when blocking_count = 0 then 'PASS' else 'FAIL' end,
    blocking_count::text,
    'blocking_failures=' || blocking_details
  from blocking_summary
)
select check_name, status, count_or_value, details
from results
order by ord, check_name;
