-- Student question-loading runtime diagnostic.
-- Read-only: run manually in hosted Supabase SQL Editor. Does not start sessions or submit attempts.

with
candidate_exams as (
  select
    e.id,
    e.status,
    e.course_id,
    e.questions_count,
    e.exam_settings
  from public.exams e
  where e.title = '123'
     or e.exam_title = '123'
),
candidate_questions as (
  select
    q.id,
    q.exam_id,
    q.question_type,
    q.choices,
    q.correct_answers,
    q.question_config
  from public.exam_questions q
  join candidate_exams e on e.id = q.exam_id
),
expected_functions(proname) as (
  values
    ('get_student_exam_questions'),
    ('student_can_take_exam'),
    ('sanitize_student_question_config'),
    ('authorize_exam_start'),
    ('is_student_enrolled_in_course')
),
function_catalog as (
  select
    p.oid,
    p.proname,
    pg_get_function_identity_arguments(p.oid) as args,
    p.prosecdef,
    p.provolatile,
    p.prosrc,
    pg_get_functiondef(p.oid) as function_def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in (select proname from expected_functions)
),
candidate_exam_checks as (
  select
    'candidate_exam' as section,
    'title_123_match_count' as check_name,
    case when count(*) = 0 then 'CONFLICT' else 'INFO' end as status,
    'candidate_exam_count=' || count(*)::text as details
  from candidate_exams

  union all
  select
    'candidate_exam',
    'exam_id=' || id::text,
    'INFO',
    'status=' || coalesce(status, '<null>')
      || ', course_id=' || coalesce(course_id::text, '<null>')
      || ', questions_count=' || coalesce(questions_count::text, '<null>')
      || ', exam_settings_sql_type=' || pg_typeof(exam_settings)::text
      || ', exam_settings_json_type=' || coalesce(jsonb_typeof(exam_settings), '<null>')
  from candidate_exams
),
candidate_question_checks as (
  select
    'candidate_questions' as section,
    'exam_id=' || exam_id::text || ', question_id=' || id::text as check_name,
    'INFO' as status,
    'question_type=' || coalesce(question_type, '<null>')
      || ', question_config_sql_type=' || pg_typeof(question_config)::text
      || ', question_config_json_type=' || coalesce(jsonb_typeof(question_config), '<null>')
      || ', choices_sql_type=' || pg_typeof(choices)::text
      || ', choices_json_type=' || coalesce(jsonb_typeof(choices), '<null>')
      || ', correct_answers_sql_type=' || pg_typeof(correct_answers)::text
      || ', correct_answers_json_type=' || coalesce(jsonb_typeof(correct_answers), '<null>')
  from candidate_questions
),
matching_pair_type_checks as (
  select
    'matching_pairs' as section,
    'exam_id=' || cq.exam_id::text || ', question_id=' || cq.id::text || ', pair_index=' || pair_items.ordinality::text as check_name,
    case
      when jsonb_typeof(pair_items.pair_value) = 'object'
       and pair_items.pair_value ? 'left'
       and pair_items.pair_value ? 'right'
      then 'PASS'
      else 'CONFLICT'
    end as status,
    'pair_sql_type=' || pg_typeof(pair_items.pair_value)::text
      || ', pair_json_type=' || coalesce(jsonb_typeof(pair_items.pair_value), '<null>')
      || ', left_expr_sql_type=' || pg_typeof(pair_items.pair_value->>'left')::text
      || ', right_expr_sql_type=' || pg_typeof(pair_items.pair_value->>'right')::text
      || ', has_left=' || (pair_items.pair_value ? 'left')::text
      || ', has_right=' || (pair_items.pair_value ? 'right')::text
  from candidate_questions cq
  join lateral jsonb_array_elements(
    case
      when cq.question_type = 'Matching Type'
       and jsonb_typeof(cq.question_config) = 'object'
       and jsonb_typeof(cq.question_config->'pairs') = 'array'
      then cq.question_config->'pairs'
      else '[]'::jsonb
    end
  ) with ordinality as pair_items(pair_value, ordinality) on true
),
matching_summary_checks as (
  select
    'matching_pairs' as section,
    'candidate_matching_pair_summary' as check_name,
    case
      when count(*) filter (
        where cq.question_type = 'Matching Type'
          and (
            jsonb_typeof(cq.question_config) is distinct from 'object'
            or jsonb_typeof(cq.question_config->'pairs') is distinct from 'array'
          )
      ) = 0 then 'PASS'
      else 'CONFLICT'
    end as status,
    'matching_question_count=' || count(*) filter (where cq.question_type = 'Matching Type')
      || ', matching_questions_with_bad_pairs_container=' || count(*) filter (
        where cq.question_type = 'Matching Type'
          and (
            jsonb_typeof(cq.question_config) is distinct from 'object'
            or jsonb_typeof(cq.question_config->'pairs') is distinct from 'array'
          )
      )
  from candidate_questions cq
),
exam_settings_expression_checks as (
  select
    'exam_settings_expressions' as section,
    'exam_id=' || id::text as check_name,
    'PASS' as status,
    'archived_expr_type=' || pg_typeof(exam_settings->>'archived')::text
      || ', startsAt_expr_type=' || pg_typeof(exam_settings->>'startsAt')::text
      || ', deadline_expr_type=' || pg_typeof(exam_settings->>'deadline')::text
      || ', startsAt_present=' || (exam_settings ? 'startsAt')::text
      || ', deadline_present=' || (exam_settings ? 'deadline')::text
  from candidate_exams
),
function_overload_checks as (
  select
    'function_overloads' as section,
    ef.proname as check_name,
    case
      when count(fc.oid) = 0 then 'CONFLICT'
      when ef.proname in ('get_student_exam_questions', 'student_can_take_exam', 'authorize_exam_start') and count(fc.oid) <> 1 then 'CONFLICT'
      else 'PASS'
    end as status,
    'signature_count=' || count(fc.oid)::text
      || ', signatures=' || coalesce(string_agg(fc.proname || '(' || fc.args || ')', '; ' order by fc.args), '<none>')
  from expected_functions ef
  left join function_catalog fc on fc.proname = ef.proname
  group by ef.proname
),
function_body_checks as (
  select
    'function_body' as section,
    proname || '(' || args || ')' as check_name,
    'INFO' as status,
    'security_definer=' || prosecdef::text
      || ', volatility=' || provolatile::text
      || ', search_path_public=' || (function_def ilike '%SET search_path TO public%' or function_def ilike '%set search_path = public%')::text
      || ', has_exam_settings_json_ops=' || (function_def like '%exam_settings->>%')::text
      || ', has_question_config_pair_ops=' || (function_def like '%question_config%pairs%' or function_def like '%pair->>%')::text
      || ', has_array_elements_text=' || (function_def like '%jsonb_array_elements_text%')::text
  from function_catalog
),
sanitizer_expression_checks as (
  select
    'sanitizer_type_flow' as section,
    'matching_pair_alias_expression' as check_name,
    case
      when exists (
        select 1
        from function_catalog
        where proname = 'sanitize_student_question_config'
          and function_def like '%jsonb_array_elements(coalesce(p_question.question_config%pairs%'
          and function_def like '%pair->>%'
      ) then 'PRESENT'
      else 'WARNING'
    end as status,
    'Deployed sanitizer should be checked for pair alias text conversion before pair->>left/right.'
),
safe_rpc_invocation_assessment as (
  select
    'safe_rpc_invocation_assessment' as section,
    'get_student_exam_questions' as check_name,
    case
      when exists (
        select 1
        from function_catalog
        where proname = 'get_student_exam_questions'
          and provolatile::text = 's'
          and function_def not ilike '%insert%'
          and function_def not ilike '%update%'
          and function_def not ilike '%delete%'
      )
      and exists (
        select 1
        from function_catalog
        where proname = 'sanitize_student_question_config'
          and provolatile::text = 's'
          and function_def not ilike '%insert%'
          and function_def not ilike '%update%'
          and function_def not ilike '%delete%'
      )
      and exists (
        select 1
        from function_catalog
        where proname = 'student_can_take_exam'
          and provolatile::text = 's'
          and function_def not ilike '%insert%'
          and function_def not ilike '%update%'
          and function_def not ilike '%delete%'
      )
      then 'SAFE_READ_ONLY'
      else 'DO_NOT_INVOKE'
    end as status,
    'This diagnostic does not invoke the RPC, because a thrown exception would abort the whole result table.'
),
all_checks as (
  select * from candidate_exam_checks
  union all select * from candidate_question_checks
  union all select * from matching_summary_checks
  union all select * from matching_pair_type_checks
  union all select * from exam_settings_expression_checks
  union all select * from function_overload_checks
  union all select * from function_body_checks
  union all select * from sanitizer_expression_checks
  union all select * from safe_rpc_invocation_assessment
),
readiness as (
  select
    'runtime_diagnostic_readiness' as section,
    'student_question_text_operator_error' as check_name,
    case when count(*) filter (where status in ('CONFLICT', 'DO_NOT_INVOKE')) = 0 then 'PASS' else 'CONFLICT' end as status,
    case
      when count(*) filter (where status in ('CONFLICT', 'DO_NOT_INVOKE')) = 0 then 'No blocking diagnostic conflicts.'
      else count(*) filter (where status in ('CONFLICT', 'DO_NOT_INVOKE')) || ' blocking diagnostic row(s): review CONFLICT or DO_NOT_INVOKE statuses.'
    end as details
  from all_checks
)
select section, check_name, status, details
from all_checks
union all
select section, check_name, status, details
from readiness
order by section, check_name;
