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
  pairs jsonb;
  order_items jsonb;
begin
  config := config - 'correctAnswer' - 'correctAnswers' - 'acceptedAnswers' - 'answerKey';

  if p_question.question_type = 'Matching Type' then
    select coalesce(jsonb_agg(jsonb_build_object('left', left_text) order by left_text), '[]'::jsonb)
    into pairs
    from (
      select pair_item.value->>'left' as left_text  
      from jsonb_array_elements(coalesce(p_question.question_config->'pairs', '[]'::jsonb)) as pair_item(value)
    ) items;

    select coalesce(jsonb_agg(to_jsonb(right_text) order by md5(p_seed || ':right:' || right_text)), '[]'::jsonb)
    into order_items
    from (
      select pair_item.value->>'right' as right_text
      from jsonb_array_elements(coalesce(p_question.question_config->'pairs', '[]'::jsonb)) as pair_item(value)
    ) items;

    return (config - 'pairs') || jsonb_build_object('pairs', pairs, 'matchChoices', order_items);
  end if;

  if p_question.question_type = 'Ordering / Sequencing' then
    select coalesce(jsonb_agg(value order by md5(p_seed || ':order:' || value)), '[]'::jsonb)
    into order_items
    from jsonb_array_elements_text(coalesce(p_question.correct_answers, p_question.question_config->'orderItems', '[]'::jsonb)) as order_values(value);

    return (config - 'orderItems') || jsonb_build_object('orderItems', order_items);
  end if;

  return config;
end;
$$;

notify pgrst, 'reload schema';

commit;
