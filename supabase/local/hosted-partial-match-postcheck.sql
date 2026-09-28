select
  'partial_match_helper_exists' as check_name,
  case when to_regprocedure('public.exam_question_allows_partial_match(text,jsonb)') is not null then 'PASS' else 'FAIL' end as status,
  'Compatibility helper exists.' as details
union all
select
  'grade_exam_answer_exists',
  case when to_regprocedure('public.grade_exam_answer(public.exam_questions,jsonb)') is not null then 'PASS' else 'FAIL' end,
  'Authoritative grading function exists with expected signature.'
union all
select
  'rpc_grants_restricted',
  case when not has_function_privilege('public', 'public.exam_question_allows_partial_match(text,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.exam_question_allows_partial_match(text,jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.exam_question_allows_partial_match(text,jsonb)', 'execute')
      and not has_function_privilege('public', 'public.grade_exam_answer(public.exam_questions,jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.recalculate_exam_attempt_score(uuid)', 'execute')
    then 'PASS' else 'FAIL' end,
  'Internal helpers are not exposed broadly.'
union all
select
  'rls_enabled',
  case when bool_and(relrowsecurity) then 'PASS' else 'FAIL' end,
  'RLS remains enabled on relevant scoring tables.'
from pg_class
where oid in ('public.exam_questions'::regclass, 'public.exam_attempts'::regclass, 'public.exam_attempt_answers'::regclass)
union all
select
  'legacy_compatibility_helper',
  case when public.exam_question_allows_partial_match('Multiple Select', '{}'::jsonb) = false
      and public.exam_question_allows_partial_match('Matching Type', '{}'::jsonb) = true
      and public.exam_question_allows_partial_match('Ordering / Sequencing', '{}'::jsonb) = true
      and public.exam_question_allows_partial_match('Enumeration', '{}'::jsonb) = true
    then 'PASS' else 'FAIL' end,
  'Absent partialMatch preserves legacy behavior.'
union all
select
  'no_invalid_scoring_rows',
  case when not exists (
    select 1 from public.exam_attempt_answers
    where (earned_points is not null and earned_points < 0)
       or (max_points is not null and max_points < 0)
       or (earned_points is not null and max_points is not null and earned_points > max_points)
  ) then 'PASS' else 'FAIL' end,
  'No answer scoring rows exceed valid point bounds.';
