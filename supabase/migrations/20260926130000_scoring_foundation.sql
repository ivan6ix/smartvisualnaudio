begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_questions_points_range'
      and conrelid = 'public.exam_questions'::regclass
  ) then
    alter table public.exam_questions
      add constraint exam_questions_points_range
      check (points >= 0.01 and points <= 1000.00) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_attempt_answers_max_points_nonnegative'
      and conrelid = 'public.exam_attempt_answers'::regclass
  ) then
    alter table public.exam_attempt_answers
      add constraint exam_attempt_answers_max_points_nonnegative
      check (max_points is null or max_points >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_attempt_answers_earned_points_nonnegative'
      and conrelid = 'public.exam_attempt_answers'::regclass
  ) then
    alter table public.exam_attempt_answers
      add constraint exam_attempt_answers_earned_points_nonnegative
      check (earned_points is null or earned_points >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_attempt_answers_earned_points_lte_max'
      and conrelid = 'public.exam_attempt_answers'::regclass
  ) then
    alter table public.exam_attempt_answers
      add constraint exam_attempt_answers_earned_points_lte_max
      check (earned_points is null or max_points is null or earned_points <= max_points) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_attempts_earned_points_nonnegative'
      and conrelid = 'public.exam_attempts'::regclass
  ) then
    alter table public.exam_attempts
      add constraint exam_attempts_earned_points_nonnegative
      check (earned_points is null or earned_points >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_attempts_max_points_nonnegative'
      and conrelid = 'public.exam_attempts'::regclass
  ) then
    alter table public.exam_attempts
      add constraint exam_attempts_max_points_nonnegative
      check (max_points is null or max_points >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_attempts_earned_points_lte_max'
      and conrelid = 'public.exam_attempts'::regclass
  ) then
    alter table public.exam_attempts
      add constraint exam_attempts_earned_points_lte_max
      check (earned_points is null or max_points is null or earned_points <= max_points) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_attempts_score_percent_range'
      and conrelid = 'public.exam_attempts'::regclass
  ) then
    alter table public.exam_attempts
      add constraint exam_attempts_score_percent_range
      check (score is null or (score >= 0 and score <= 100)) not valid;
  end if;
end $$;

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
  expected text[];
  submitted text[];
  pair_count integer;
  correct_count integer;
  earned numeric;
begin
  if p_answer is null or p_answer = 'null'::jsonb then
    return jsonb_build_object('earnedPoints', 0, 'maxPoints', points, 'manual', false, 'isCorrect', false);
  end if;

  if qtype not in ('Multiple Choice', 'Picture Choice', 'Multiple Select', 'Identification', 'Fill in the Blank', 'Matching Type', 'Ordering / Sequencing', 'Enumeration', 'True or False') then
    return jsonb_build_object('earnedPoints', null, 'maxPoints', points, 'manual', true, 'isCorrect', false);
  end if;

  if jsonb_typeof(correct) <> 'array' then
    correct := jsonb_build_array(correct);
  end if;

  if qtype in ('Multiple Choice', 'Picture Choice', 'True or False') then
    earned := case when lower(trim(coalesce(p_answer #>> '{}', ''))) = lower(trim(coalesce(correct->>0, ''))) then points else 0 end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', earned = points);
  end if;

  if qtype = 'Multiple Select' then
    select coalesce(array_agg(lower(trim(value)) order by lower(trim(value))), array[]::text[])
    into expected
    from jsonb_array_elements_text(correct);

    select coalesce(array_agg(lower(trim(value)) order by lower(trim(value))), array[]::text[])
    into submitted
    from jsonb_array_elements_text(case when jsonb_typeof(p_answer) = 'array' then p_answer else '[]'::jsonb end);

    earned := case when submitted = expected then points else 0 end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', submitted = expected);
  end if;

  if qtype in ('Identification', 'Fill in the Blank') then
    select coalesce(array_agg(lower(trim(value))), array[]::text[])
    into expected
    from jsonb_array_elements_text(correct);
    earned := case when lower(trim(coalesce(p_answer #>> '{}', ''))) = any(expected) then points else 0 end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', earned = points);
  end if;

  if qtype = 'Matching Type' then
    select count(*), count(*) filter (where lower(trim(coalesce(p_answer->>(pair->>'left'), ''))) = lower(trim(coalesce(pair->>'right', ''))))
    into pair_count, correct_count
    from jsonb_array_elements(coalesce(config->'pairs', '[]'::jsonb)) as pair;
    earned := case when pair_count > 0 then (correct_count::numeric / pair_count::numeric) * points else 0 end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', round(earned, 2) = points);
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
    earned := case when array_length(expected, 1) > 0 then (correct_count::numeric / array_length(expected, 1)::numeric) * points else 0 end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', round(earned, 2) = points);
  end if;

  if qtype = 'Enumeration' then
    select coalesce(array_agg(lower(trim(value))), array[]::text[])
    into expected
    from jsonb_array_elements_text(correct);
    select coalesce(array_agg(distinct lower(trim(value))), array[]::text[])
    into submitted
    from jsonb_array_elements_text(case when jsonb_typeof(p_answer) = 'array' then p_answer else '[]'::jsonb end)
    where length(trim(value)) > 0;
    select count(*) into correct_count from unnest(submitted) as item where item = any(expected);
    earned := case when array_length(expected, 1) > 0 then (correct_count::numeric / array_length(expected, 1)::numeric) * points else 0 end;
    return jsonb_build_object('earnedPoints', round(earned, 2), 'maxPoints', points, 'manual', false, 'isCorrect', round(earned, 2) = points);
  end if;

  return jsonb_build_object('earnedPoints', 0, 'maxPoints', points, 'manual', false, 'isCorrect', false);
end;
$$;

create or replace function public.recalculate_exam_attempt_score(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  totals record;
  next_score numeric;
  next_status text;
begin
  select
    round(coalesce(sum(coalesce(earned_points, 0)), 0), 2) as earned,
    round(coalesce(sum(coalesce(max_points, 0)), 0), 2) as max,
    bool_or(needs_manual_grading) as pending_manual,
    count(*) as answer_count,
    count(*) filter (where max_points is null) as missing_max
  into totals
  from public.exam_attempt_answers
  where attempt_id = p_attempt_id;

  if coalesce(totals.answer_count, 0) = 0 or coalesce(totals.missing_max, 0) > 0 then
    return jsonb_build_object('updated', false, 'reason', 'insufficient_answer_snapshots');
  end if;

  next_score := case
    when coalesce(totals.pending_manual, false) then null
    when totals.max > 0 then round((totals.earned / totals.max) * 100, 2)
    else 0
  end;
  next_status := case when coalesce(totals.pending_manual, false) then 'Pending Manual Grading' else 'Manually Graded' end;

  update public.exam_attempts
  set earned_points = totals.earned,
      max_points = totals.max,
      score = next_score,
      status = next_status
  where id = p_attempt_id;

  return jsonb_build_object(
    'updated', true,
    'earned_points', totals.earned,
    'max_points', totals.max,
    'score', next_score,
    'status', next_status,
    'pending_manual', coalesce(totals.pending_manual, false)
  );
end;
$$;

create or replace function public.grade_exam_attempt_answer(p_answer_id uuid, p_earned_points numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  answer_row public.exam_attempt_answers;
  attempt_row public.exam_attempts;
  exam_row public.exams;
  clean_points numeric;
  totals jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'Professor'
      and status = 'Active'
  ) then
    raise exception 'Only active professors can grade exam answers.';
  end if;

  select * into answer_row
  from public.exam_attempt_answers
  where id = p_answer_id
  for update;

  if answer_row.id is null then
    raise exception 'Answer not found.';
  end if;

  select * into attempt_row
  from public.exam_attempts
  where id = answer_row.attempt_id
  for update;

  select * into exam_row
  from public.exams
  where id = attempt_row.exam_id;

  if exam_row.id is null
     or (exam_row.professor_id is distinct from auth.uid() and exam_row.created_by is distinct from auth.uid()) then
    raise exception 'Answer grading denied.';
  end if;

  if answer_row.max_points is null then
    raise exception 'Answer max points snapshot is missing.';
  end if;

  clean_points := round(p_earned_points, 2);
  if clean_points is null or clean_points < 0 or clean_points > answer_row.max_points then
    raise exception 'Earned points must be between 0 and %.', answer_row.max_points;
  end if;

  update public.exam_attempt_answers
  set earned_points = clean_points,
      is_correct = clean_points >= answer_row.max_points,
      needs_manual_grading = false,
      graded_at = now(),
      graded_by = auth.uid()
  where id = answer_row.id;

  totals := public.recalculate_exam_attempt_score(answer_row.attempt_id);
  return totals || jsonb_build_object('answer_id', answer_row.id, 'earned_points', clean_points);
end;
$$;

create or replace function public.submit_exam_attempt(p_exam_id uuid, p_answers jsonb, p_violations jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.exams;
  started timestamptz;
  latest_submitted timestamptz;
  used_attempts integer;
  max_attempts integer;
  attempt_id uuid;
  answer_value jsonb;
  result jsonb;
  has_manual boolean := false;
  earned_total numeric := 0;
  max_total numeric := 0;
  q public.exam_questions;
begin
  select * into e from public.exams where id = p_exam_id for update;

  if e.id is null or not public.student_can_take_exam(p_exam_id) then
    raise exception 'Exam is not available for your account.';
  end if;

  if nullif(e.exam_settings->>'startsAt', '')::timestamptz > now() then
    raise exception 'This exam is scheduled and has not started.';
  end if;

  select started_at into started
  from public.exam_start_sessions
  where exam_id = e.id and student_id = auth.uid()
  for update;

  if started is null then
    raise exception 'Start this exam through the authorized exam flow.';
  end if;

  select id into attempt_id
  from public.exam_attempts
  where exam_id = e.id
    and student_id = auth.uid()
    and submission_session_started_at = started
  order by submitted_at desc nulls last
  limit 1;

  if attempt_id is not null then
    return attempt_id;
  end if;

  select count(*)::integer, max(submitted_at)
  into used_attempts, latest_submitted
  from public.exam_attempts
  where exam_id = e.id and student_id = auth.uid();

  max_attempts := public.exam_attempt_limit(e.exam_settings);
  if max_attempts is not null and used_attempts >= max_attempts then
    raise exception 'You have used all available attempts for this exam.';
  end if;

  if nullif(e.exam_settings->>'deadline', '')::timestamptz <= now()
     and (started > nullif(e.exam_settings->>'deadline', '')::timestamptz
          or (latest_submitted is not null and latest_submitted >= started)) then
    raise exception 'This exam has expired.';
  end if;

  for q in select * from public.exam_questions where exam_id = e.id order by id loop
    answer_value := coalesce(p_answers->(q.id::text), 'null'::jsonb);
    result := public.grade_exam_answer(q, answer_value);
    has_manual := has_manual or coalesce((result->>'manual')::boolean, false);
    earned_total := earned_total + coalesce((result->>'earnedPoints')::numeric, 0);
    max_total := max_total + coalesce((result->>'maxPoints')::numeric, 0);
  end loop;

  earned_total := round(earned_total, 2);
  max_total := round(max_total, 2);

  insert into public.exam_attempts (
    exam_id, student_id, score, earned_points, max_points, violations, status,
    started_at, submitted_at, submission_session_started_at
  )
  values (
    e.id,
    auth.uid(),
    case when has_manual then null when max_total > 0 then round((earned_total / max_total) * 100, 2) else 0 end,
    earned_total,
    max_total,
    coalesce(p_violations, '[]'::jsonb),
    case when has_manual then 'Pending Manual Grading' else 'Submitted' end,
    started,
    now(),
    started
  )
  on conflict (exam_id, student_id, submission_session_started_at)
  where submission_session_started_at is not null
  do nothing
  returning id into attempt_id;

  if attempt_id is null then
    select id into attempt_id
    from public.exam_attempts
    where exam_id = e.id
      and student_id = auth.uid()
      and submission_session_started_at = started
    order by submitted_at desc nulls last
    limit 1;

    if attempt_id is null then
      raise exception 'Unable to finalize exam submission.';
    end if;

    return attempt_id;
  end if;

  for q in select * from public.exam_questions where exam_id = e.id order by id loop
    answer_value := coalesce(p_answers->(q.id::text), 'null'::jsonb);
    result := public.grade_exam_answer(q, answer_value);

    insert into public.exam_attempt_answers (
      attempt_id, question_id, answer, file_url, earned_points, max_points,
      is_correct, needs_manual_grading
    )
    values (
      attempt_id,
      q.id,
      answer_value,
      nullif(answer_value->>'path', ''),
      nullif(result->>'earnedPoints', '')::numeric,
      round(nullif(result->>'maxPoints', '')::numeric, 2),
      coalesce((result->>'isCorrect')::boolean, false),
      coalesce((result->>'manual')::boolean, false)
    );
  end loop;

  return attempt_id;
end;
$$;

update public.exam_attempts a
set earned_points = totals.earned,
    max_points = totals.max,
    score = case
      when totals.pending_manual then a.score
      when totals.max > 0 then round((totals.earned / totals.max) * 100, 2)
      else a.score
    end
from (
  select
    attempt_id,
    round(sum(coalesce(earned_points, 0)), 2) as earned,
    round(sum(max_points), 2) as max,
    bool_or(needs_manual_grading) as pending_manual,
    count(*) as answer_count,
    count(*) filter (where max_points is null) as missing_max
  from public.exam_attempt_answers
  group by attempt_id
) totals
where a.id = totals.attempt_id
  and totals.answer_count > 0
  and totals.missing_max = 0
  and (a.earned_points is null or a.max_points is null);

alter table public.exam_questions validate constraint exam_questions_points_range;
alter table public.exam_attempt_answers validate constraint exam_attempt_answers_max_points_nonnegative;
alter table public.exam_attempt_answers validate constraint exam_attempt_answers_earned_points_nonnegative;
alter table public.exam_attempt_answers validate constraint exam_attempt_answers_earned_points_lte_max;
alter table public.exam_attempts validate constraint exam_attempts_earned_points_nonnegative;
alter table public.exam_attempts validate constraint exam_attempts_max_points_nonnegative;
alter table public.exam_attempts validate constraint exam_attempts_earned_points_lte_max;
alter table public.exam_attempts validate constraint exam_attempts_score_percent_range;

revoke all on function public.grade_exam_answer(public.exam_questions, jsonb) from public, anon, authenticated;
revoke all on function public.recalculate_exam_attempt_score(uuid) from public, anon, authenticated;
revoke all on function public.grade_exam_attempt_answer(uuid, numeric) from public;
revoke all on function public.grade_exam_attempt_answer(uuid, numeric) from anon;
grant execute on function public.grade_exam_attempt_answer(uuid, numeric) to authenticated;
revoke all on function public.submit_exam_attempt(uuid, jsonb, jsonb) from public;
revoke all on function public.submit_exam_attempt(uuid, jsonb, jsonb) from anon;
grant execute on function public.submit_exam_attempt(uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
