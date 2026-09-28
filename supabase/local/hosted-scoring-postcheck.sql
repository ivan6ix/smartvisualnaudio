-- Feature #1 scoring foundation hosted postcheck.

select
  'scoring_constraints_valid' as check_name,
  case when count(*) = 8 and bool_and(convalidated) then 'PASS' else 'FAIL' end as status,
  count(*)::text as found_constraints
from pg_constraint
where conrelid in ('public.exam_questions'::regclass, 'public.exam_attempt_answers'::regclass, 'public.exam_attempts'::regclass)
  and conname in (
    'exam_questions_points_range',
    'exam_attempt_answers_max_points_nonnegative',
    'exam_attempt_answers_earned_points_nonnegative',
    'exam_attempt_answers_earned_points_lte_max',
    'exam_attempts_earned_points_nonnegative',
    'exam_attempts_max_points_nonnegative',
    'exam_attempts_earned_points_lte_max',
    'exam_attempts_score_percent_range'
  );

select
  'grade_exam_attempt_answer_exists' as check_name,
  case when count(*) = 1 then 'PASS' else 'FAIL' end as status
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'grade_exam_attempt_answer'
  and pg_get_function_identity_arguments(p.oid) = 'p_answer_id uuid, p_earned_points numeric';

select
  'scoring_rpc_permissions' as check_name,
  case when not has_function_privilege('public', 'public.grade_exam_attempt_answer(uuid,numeric)', 'execute')
      and not has_function_privilege('anon', 'public.grade_exam_attempt_answer(uuid,numeric)', 'execute')
      and has_function_privilege('authenticated', 'public.grade_exam_attempt_answer(uuid,numeric)', 'execute')
      and not has_function_privilege('authenticated', 'public.recalculate_exam_attempt_score(uuid)', 'execute')
    then 'PASS' else 'FAIL' end as status;

select
  'rls_still_enabled' as check_name,
  case when bool_and(relrowsecurity) then 'PASS' else 'FAIL' end as status
from pg_class
where oid in ('public.exam_questions'::regclass, 'public.exam_attempt_answers'::regclass, 'public.exam_attempts'::regclass);

select
  'attempt_aggregate_consistency_sample' as check_name,
  case when count(*) filter (
    where a.earned_points is not null
      and a.max_points is not null
      and round(a.earned_points, 2) = round(t.earned, 2)
      and round(a.max_points, 2) = round(t.max, 2)
  ) = count(*) then 'PASS' else 'FAIL' end as status,
  count(*)::text as sampled_attempts
from public.exam_attempts a
join (
  select attempt_id, sum(coalesce(earned_points, 0)) as earned, sum(max_points) as max
  from public.exam_attempt_answers
  where max_points is not null
  group by attempt_id
) t on t.attempt_id = a.id
where a.earned_points is not null
limit 100;
