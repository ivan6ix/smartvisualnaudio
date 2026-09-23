-- Student question-loading diagnostic.
-- Read-only: run manually in hosted Supabase SQL Editor after postcheck passes.

with
expected_columns(table_name, column_name, expected_udt) as (
  values
    ('exams', 'exam_settings', 'jsonb'),
    ('exam_questions', 'choices', 'jsonb'),
    ('exam_questions', 'correct_answer', 'text'),
    ('exam_questions', 'correct_answers', 'jsonb'),
    ('exam_questions', 'question_config', 'jsonb'),
    ('exam_questions', 'question_type', 'text')
),
expected_functions(proname, args) as (
  values
    ('get_student_exam_questions', 'p_exam_id uuid'),
    ('student_can_take_exam', 'p_exam_id uuid'),
    ('sanitize_student_question_config', 'p_question exam_questions, p_seed text'),
    ('authorize_exam_start', 'p_exam_id uuid')
),
risky_expressions(function_name, expression_text) as (
  values
    ('student_can_take_exam', 'e.exam_settings->>''archived'''),
    ('get_student_exam_questions', 'e.exam_settings->>''startsAt'''),
    ('get_student_exam_questions', 'e.exam_settings->>''deadline'''),
    ('authorize_exam_start', 'e.exam_settings->>''startsAt'''),
    ('authorize_exam_start', 'e.exam_settings->>''deadline'''),
    ('sanitize_student_question_config', 'p_question.question_config->''pairs'''),
    ('sanitize_student_question_config', 'pair->>''left'''),
    ('sanitize_student_question_config', 'pair->>''right''')
),
column_checks as (
  select
    'column_types' as section,
    ec.table_name || '.' || ec.column_name as check_name,
    case
      when c.column_name is null then 'CONFLICT'
      when c.udt_name = ec.expected_udt then 'PASS'
      else 'CONFLICT'
    end as status,
    coalesce(
      'expected_udt=' || ec.expected_udt || ', actual_data_type=' || c.data_type || ', actual_udt=' || c.udt_name,
      'Expected column is missing.'
    ) as details
  from expected_columns ec
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = ec.table_name
   and c.column_name = ec.column_name
),
function_checks as (
  select
    'function_signatures' as section,
    ef.proname || '(' || ef.args || ')' as check_name,
    case when p.oid is null then 'CONFLICT' else 'PASS' end as status,
    case
      when p.oid is null then 'Expected function signature is missing.'
      else 'security_definer=' || p.prosecdef::text || ', volatility=' || p.provolatile::text
    end as details
  from expected_functions ef
  left join pg_proc p
    on p.pronamespace = 'public'::regnamespace
   and p.proname = ef.proname
   and pg_get_function_identity_arguments(p.oid) = ef.args
),
expression_checks as (
  select
    'risky_operator_expressions' as section,
    re.function_name || ': ' || re.expression_text as check_name,
    case
      when p.oid is null then 'CONFLICT'
      when position(re.expression_text in pg_get_functiondef(p.oid)) > 0 then 'PRESENT'
      else 'WARNING'
    end as status,
    case
      when p.oid is null then 'Function is missing; cannot inspect expression.'
      when position(re.expression_text in pg_get_functiondef(p.oid)) > 0 then 'Expression exists in deployed function; if its left operand is text, it can raise operator does not exist: text ->> unknown.'
      else 'Expression not found in deployed function text; compare hosted function body with local deployment SQL.'
    end as details
  from risky_expressions re
  left join pg_proc p
    on p.pronamespace = 'public'::regnamespace
   and p.proname = re.function_name
),
exam_shape_checks as (
  select
    'data_shapes' as section,
    'exams.exam_settings_runtime_shape' as check_name,
    case
      when count(*) filter (
        where to_jsonb(e)->'exam_settings' is not null
          and jsonb_typeof(to_jsonb(e)->'exam_settings') <> 'object'
      ) = 0 then 'PASS'
      else 'CONFLICT'
    end as status,
    'non_object_exam_settings_rows=' || count(*) filter (
      where to_jsonb(e)->'exam_settings' is not null
        and jsonb_typeof(to_jsonb(e)->'exam_settings') <> 'object'
    ) || ', published_or_active_exam_rows=' || count(*) filter (
      where lower(to_jsonb(e)->>'status') in ('published', 'active')
    ) as details
  from public.exams e
),
question_shape_checks as (
  select
    'data_shapes' as section,
    'exam_questions.json_runtime_shapes' as check_name,
    case
      when count(*) filter (
        where to_jsonb(q)->'question_config' is not null
          and jsonb_typeof(to_jsonb(q)->'question_config') <> 'object'
      ) = 0
      and count(*) filter (
        where to_jsonb(q)->'choices' is not null
          and jsonb_typeof(to_jsonb(q)->'choices') <> 'array'
      ) = 0
      and count(*) filter (
        where to_jsonb(q)->'correct_answers' is not null
          and jsonb_typeof(to_jsonb(q)->'correct_answers') <> 'array'
      ) = 0 then 'PASS'
      else 'CONFLICT'
    end as status,
    'non_object_question_config_rows=' || count(*) filter (
      where to_jsonb(q)->'question_config' is not null
        and jsonb_typeof(to_jsonb(q)->'question_config') <> 'object'
    ) || ', non_array_choices_rows=' || count(*) filter (
      where to_jsonb(q)->'choices' is not null
        and jsonb_typeof(to_jsonb(q)->'choices') <> 'array'
    ) || ', non_array_correct_answers_rows=' || count(*) filter (
      where to_jsonb(q)->'correct_answers' is not null
        and jsonb_typeof(to_jsonb(q)->'correct_answers') <> 'array'
    ) as details
  from public.exam_questions q
),
matching_pair_checks as (
  select
    'data_shapes' as section,
    'matching_question_pairs_shape' as check_name,
    case
      when count(*) filter (
        where to_jsonb(q)->>'question_type' = 'Matching Type'
          and (
            jsonb_typeof(to_jsonb(q)->'question_config') is distinct from 'object'
            or jsonb_typeof((to_jsonb(q)->'question_config')->'pairs') is distinct from 'array'
          )
      ) = 0
      and count(*) filter (
        where pair_value is not null
          and jsonb_typeof(pair_value) <> 'object'
      ) = 0 then 'PASS'
      else 'CONFLICT'
    end as status,
    'matching_questions_with_non_array_pairs=' || count(*) filter (
      where to_jsonb(q)->>'question_type' = 'Matching Type'
        and (
          jsonb_typeof(to_jsonb(q)->'question_config') is distinct from 'object'
          or jsonb_typeof((to_jsonb(q)->'question_config')->'pairs') is distinct from 'array'
        )
    ) || ', matching_pair_items_not_objects=' || count(*) filter (
      where pair_value is not null
        and jsonb_typeof(pair_value) <> 'object'
    ) as details
  from public.exam_questions q
  left join lateral jsonb_array_elements(
    case
      when to_jsonb(q)->>'question_type' = 'Matching Type'
       and jsonb_typeof(to_jsonb(q)->'question_config') = 'object'
       and jsonb_typeof((to_jsonb(q)->'question_config')->'pairs') = 'array'
      then (to_jsonb(q)->'question_config')->'pairs'
      else '[]'::jsonb
    end
  ) as pair_items(pair_value) on true
),
all_checks as (
  select * from column_checks
  union all select * from function_checks
  union all select * from expression_checks
  union all select * from exam_shape_checks
  union all select * from question_shape_checks
  union all select * from matching_pair_checks
),
readiness as (
  select
    'diagnostic_readiness' as section,
    'student_question_loading_error' as check_name,
    case when count(*) filter (where status = 'CONFLICT') = 0 then 'PASS' else 'CONFLICT' end as status,
    case
      when count(*) filter (where status = 'CONFLICT') = 0 then 'No CONFLICT rows in diagnostic result.'
      else count(*) filter (where status = 'CONFLICT') || ' CONFLICT row(s): review column types, function signatures, and data shapes above.'
    end as details
  from all_checks
)
select section, check_name, status, details
from all_checks
union all
select section, check_name, status, details
from readiness
order by section, check_name;
