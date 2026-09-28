select
  'grade_exam_answer_exists' as check_name,
  case when to_regprocedure('public.grade_exam_answer(public.exam_questions,jsonb)') is not null then 'PASS' else 'FAIL' end as status,
  'Authoritative grading function must exist before Feature #2 replacement.' as details
union all
select
  'question_config_available',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'exam_questions' and column_name = 'question_config' and data_type = 'jsonb'
  ) then 'PASS' else 'FAIL' end,
  'Partial Match is stored in exam_questions.question_config, not a new column.'
union all
select
  'scoring_tables_rls_enabled',
  case when bool_and(relrowsecurity) then 'PASS' else 'FAIL' end,
  'RLS should remain enabled on exam attempts and answers.'
from pg_class
where oid in ('public.exam_attempts'::regclass, 'public.exam_attempt_answers'::regclass)
union all
select
  'client_rpc_grants_restricted',
  case when not has_function_privilege('public', 'public.grade_exam_answer(public.exam_questions,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.grade_exam_answer(public.exam_questions,jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.grade_exam_answer(public.exam_questions,jsonb)', 'execute')
      and has_function_privilege('authenticated', 'public.submit_exam_attempt(uuid,jsonb,jsonb)', 'execute')
    then 'PASS' else 'FAIL' end,
  'Internal grading stays private; authenticated students submit through submit_exam_attempt.';
