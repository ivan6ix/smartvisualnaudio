begin;

create or replace function public.sanitize_student_question_config(p_question public.exam_questions, p_seed text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  config jsonb := coalesce(p_question.question_config, '{}'::jsonb);
  left_items jsonb;
  right_items jsonb;
  order_items jsonb;
begin
  config := config
    - 'correctAnswer'
    - 'correctAnswers'
    - 'acceptedAnswers'
    - 'answerKey'
    - 'matchingConnections';

  if p_question.question_type = 'Matching Type' then
    if jsonb_typeof(config->'matchingLeftItems') = 'array' then
      left_items := config->'matchingLeftItems';
    else
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', coalesce(pair_item.value->>'leftId', pair_item.value->>'left', 'left-' || ordinality::text),
        'text', coalesce(pair_item.value->>'leftText', pair_item.value->>'left', '')
      ) order by ordinality), '[]'::jsonb)
      into left_items
      from jsonb_array_elements(coalesce(p_question.question_config->'pairs', '[]'::jsonb)) with ordinality as pair_item(value, ordinality);
    end if;

    if jsonb_typeof(config->'matchingRightItems') = 'array' then
      select coalesce(jsonb_agg(item order by md5(p_seed || ':right:' || coalesce(item->>'id', item->>'text', ''))), '[]'::jsonb)
      into right_items
      from jsonb_array_elements(config->'matchingRightItems') as item;
    else
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', coalesce(pair_item.value->>'rightId', pair_item.value->>'right', 'right-' || ordinality::text),
        'text', coalesce(pair_item.value->>'rightText', pair_item.value->>'right', '')
      ) order by md5(p_seed || ':right:' || coalesce(pair_item.value->>'right', ordinality::text))), '[]'::jsonb)
      into right_items
      from jsonb_array_elements(coalesce(p_question.question_config->'pairs', '[]'::jsonb)) with ordinality as pair_item(value, ordinality);
    end if;

    return (config - 'pairs' - 'matchingConnections')
      || jsonb_build_object('matchingLeftItems', left_items, 'matchingRightItems', right_items);
  end if;

  if p_question.question_type = 'Ordering / Sequencing' then
    select coalesce(jsonb_agg(value order by md5(p_seed || ':order:' || value)), '[]'::jsonb)
    into order_items
    from jsonb_array_elements_text(coalesce(p_question.correct_answers, p_question.question_config->'orderItems', '[]'::jsonb)) as value;

    return (config - 'orderItems') || jsonb_build_object('orderItems', order_items);
  end if;

  return config;
end;
$$;

create or replace function public.grade_exam_answer(p_question public.exam_questions, p_answer jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  qtype text := p_question.question_type;
  points numeric := round(coalesce(p_question.points, 0), 2);
  correct jsonb := coalesce(p_question.correct_answers, to_jsonb(p_question.correct_answer), '[]'::jsonb);
  config jsonb := coalesce(p_question.question_config, '{}'::jsonb);
  partial_match boolean := public.exam_question_allows_partial_match(p_question.question_type, coalesce(p_question.question_config, '{}'::jsonb));
  expected text[];
  submitted text[];
  expected_answer text;
  submitted_answer text;
  pair_count integer;
  correct_count integer;
  incorrect_count integer;
  earned numeric;
begin
  if p_answer is null or p_answer = 'null'::jsonb then
    return jsonb_build_object('earnedPoints', 0, 'maxPoints', points, 'manual', false, 'isCorrect', false);
  end if;

  if qtype not in ('Multiple Choice', 'Picture Choice', 'Multiple Select', 'Identification', 'Fill in the Blank', 'Matching Type', 'Ordering / Sequencing', 'Enumeration', 'True or False', 'Drag and Drop') then
    return jsonb_build_object('earnedPoints', null, 'maxPoints', points, 'manual', true, 'isCorrect', false);
  end if;

  if jsonb_typeof(correct) <> 'array' then
    correct := jsonb_build_array(correct);
  end if;

  if qtype in ('Multiple Choice', 'Picture Choice') then
    with choices as (
      select
        coalesce(choice->>'id', choice->>'key') as id,
        lower(trim(coalesce(choice->>'key', ''))) as legacy_key
      from jsonb_array_elements(coalesce(p_question.choices, config->'choices', '[]'::jsonb)) as choice
    )
    select
      coalesce((select id from choices where legacy_key = lower(trim(coalesce(correct->>0, ''))) limit 1), lower(trim(coalesce(correct->>0, '')))),
      coalesce((select id from choices where legacy_key = lower(trim(coalesce(p_answer #>> '{}', ''))) limit 1), lower(trim(coalesce(p_answer #>> '{}', ''))))
    into expected_answer, submitted_answer;
    earned := case when submitted_answer = expected_answer then points else 0 end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', earned = points);
  end if;

  if qtype = 'True or False' then
    earned := case when lower(trim(coalesce(p_answer #>> '{}', ''))) = lower(trim(coalesce(correct->>0, ''))) then points else 0 end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', earned = points);
  end if;

  if qtype = 'Multiple Select' then
    with choices as (
      select coalesce(choice->>'id', choice->>'key') as id, lower(trim(coalesce(choice->>'key', ''))) as legacy_key
      from jsonb_array_elements(coalesce(p_question.choices, config->'choices', '[]'::jsonb)) as choice
    ), expected_values as (
      select distinct coalesce((select id from choices where legacy_key = lower(trim(value)) limit 1), lower(trim(value))) as item
      from jsonb_array_elements_text(correct)
      where length(trim(value)) > 0
    ), submitted_values as (
      select distinct coalesce((select id from choices where legacy_key = lower(trim(value)) limit 1), lower(trim(value))) as item
      from jsonb_array_elements_text(case when jsonb_typeof(p_answer) = 'array' then p_answer else '[]'::jsonb end)
      where length(trim(value)) > 0
    )
    select
      coalesce(array_agg(distinct e.item order by e.item), array[]::text[]),
      coalesce((select array_agg(distinct s.item order by s.item) from submitted_values s), array[]::text[])
    into expected, submitted
    from expected_values e;

    if not partial_match then
      earned := case when submitted = expected then points else 0 end;
      return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', submitted = expected);
    end if;

    select count(*) into correct_count from unnest(submitted) as item where item = any(expected);
    select count(*) into incorrect_count from unnest(submitted) as item where not (item = any(expected));
    earned := case
      when array_length(expected, 1) > 0 then greatest(0, least(1, (correct_count - incorrect_count)::numeric / array_length(expected, 1)::numeric)) * points
      else 0
    end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', submitted = expected);
  end if;

  if qtype = 'Drag and Drop' then
    with choices as (
      select coalesce(choice->>'id', choice->>'key') as id, lower(trim(coalesce(choice->>'key', ''))) as legacy_key
      from jsonb_array_elements(coalesce(p_question.choices, config->'choices', '[]'::jsonb)) as choice
    ), expected_values as (
      select distinct coalesce((select id from choices where legacy_key = lower(trim(value)) limit 1), lower(trim(value))) as item
      from jsonb_array_elements_text(correct)
      where length(trim(value)) > 0
    ), submitted_values as (
      select distinct coalesce((select id from choices where legacy_key = lower(trim(value)) limit 1), lower(trim(value))) as item
      from jsonb_array_elements_text(case when jsonb_typeof(p_answer) = 'array' then p_answer else '[]'::jsonb end)
      where length(trim(value)) > 0
    )
    select
      coalesce(array_agg(distinct e.item order by e.item), array[]::text[]),
      coalesce((select array_agg(distinct s.item order by s.item) from submitted_values s), array[]::text[])
    into expected, submitted
    from expected_values e;

    earned := case when array_length(expected, 1) > 0 and submitted = expected then points else 0 end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', earned = points);
  end if;

  if qtype in ('Identification', 'Fill in the Blank') then
    select coalesce(array_agg(lower(trim(value))), array[]::text[])
    into expected
    from jsonb_array_elements_text(correct);
    earned := case when lower(trim(coalesce(p_answer #>> '{}', ''))) = any(expected) then points else 0 end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', earned = points);
  end if;

  if qtype = 'Matching Type' then
    if jsonb_typeof(config->'matchingConnections') = 'array' then
      select count(*), count(*) filter (where coalesce(p_answer->>(connection->>'leftId'), '') = coalesce(connection->>'rightId', ''))
      into pair_count, correct_count
      from jsonb_array_elements(coalesce(config->'matchingConnections', '[]'::jsonb)) as connection;
    else
      select count(*), count(*) filter (where lower(trim(coalesce(p_answer->>(pair->>'left'), ''))) = lower(trim(coalesce(pair->>'right', ''))))
      into pair_count, correct_count
      from jsonb_array_elements(coalesce(config->'pairs', '[]'::jsonb)) as pair;
    end if;

    earned := case
      when pair_count <= 0 then 0
      when partial_match then (correct_count::numeric / pair_count::numeric) * points
      when correct_count = pair_count then points
      else 0
    end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', pair_count > 0 and correct_count = pair_count);
  end if;

  if qtype = 'Ordering / Sequencing' then
    select coalesce(array_agg(lower(trim(value)) order by ordinality), array[]::text[])
    into expected
    from jsonb_array_elements_text(correct) with ordinality;
    select coalesce(array_agg(lower(trim(value)) order by ordinality), array[]::text[])
    into submitted
    from jsonb_array_elements_text(case when jsonb_typeof(p_answer) = 'array' then p_answer else '[]'::jsonb end) with ordinality;
    select count(*) filter (where expected[i] = submitted[i])
    into correct_count
    from generate_subscripts(expected, 1) as i;
    earned := case
      when array_length(expected, 1) is null then 0
      when partial_match then (correct_count::numeric / array_length(expected, 1)::numeric) * points
      when correct_count = array_length(expected, 1) and array_length(submitted, 1) = array_length(expected, 1) then points
      else 0
    end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', coalesce(array_length(expected, 1) > 0 and correct_count = array_length(expected, 1) and array_length(submitted, 1) = array_length(expected, 1), false));
  end if;

  if qtype = 'Enumeration' then
    select coalesce(array_agg(item order by item), array[]::text[])
    into expected
    from (select distinct lower(trim(value)) as item from jsonb_array_elements_text(correct) where length(trim(value)) > 0) normalized;
    select coalesce(array_agg(item order by item), array[]::text[])
    into submitted
    from (
      select distinct lower(trim(value)) as item
      from jsonb_array_elements_text(case when jsonb_typeof(p_answer) = 'array' then p_answer else '[]'::jsonb end)
      where length(trim(value)) > 0
    ) normalized;
    select count(*) into correct_count from unnest(submitted) as item where item = any(expected);
    earned := case
      when array_length(expected, 1) is null then 0
      when partial_match then (correct_count::numeric / array_length(expected, 1)::numeric) * points
      when submitted = expected then points
      else 0
    end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', coalesce(submitted = expected and array_length(expected, 1) > 0, false));
  end if;

  return jsonb_build_object('earnedPoints', 0, 'maxPoints', points, 'manual', false, 'isCorrect', false);
end;
$$;

revoke all on function public.sanitize_student_question_config(public.exam_questions, text) from public, anon, authenticated;
revoke all on function public.grade_exam_answer(public.exam_questions, jsonb) from public, anon, authenticated;
grant execute on function public.sanitize_student_question_config(public.exam_questions, text) to authenticated;

notify pgrst, 'reload schema';

commit;
