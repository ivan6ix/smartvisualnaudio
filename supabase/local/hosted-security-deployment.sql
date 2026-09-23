-- Hosted security deployment package.
-- CREATE ONLY in this preparation step. DO NOT EXECUTE until hosted-security-precheck.sql output has been reviewed.
-- Harden RLS-sensitive workflows without replaying historical migrations.
-- Protects profile privileges, answer keys, attempt grading, notification writes,
-- course/exam visibility, review updates, approval logs, and violation updates.
begin;

create or replace function public.is_audit_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('Admin', 'Dean')
      and status = 'Active'
  )
$$;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and status = 'Active'
$$;

create or replace function public.is_student_enrolled_in_course(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.course_enrollments
    where course_id = target_course_id
      and student_id = auth.uid()
  )
$$;

create or replace function public.create_notification(
  p_workflow text,
  p_recipient_id uuid,
  p_title text,
  p_message text,
  p_type text,
  p_context_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  notification_id uuid;
begin
  select role
  into caller_role
  from public.profiles
  where id = auth.uid()
    and status = 'Active';

  if caller_role is null then
    raise exception 'Active account required.';
  end if;

  if length(trim(coalesce(p_title, ''))) = 0
     or length(trim(coalesce(p_message, ''))) = 0
     or length(trim(coalesce(p_type, ''))) = 0
     or length(p_title) > 200
     or length(p_message) > 1000
     or length(p_type) > 80 then
    raise exception 'Invalid notification content.';
  end if;

  if p_workflow = 'exam_review_request' then
    if caller_role <> 'Professor'
       or not exists (select 1 from public.profiles where id = p_recipient_id and role = 'Cluster Professor' and status = 'Active')
       or not exists (
         select 1
         from public.exams e
         where e.id = p_context_id
           and (e.professor_id = auth.uid() or e.created_by = auth.uid())
           and lower(e.status) = 'pending review'
       ) then
      raise exception 'Notification not authorized.';
    end if;
  elsif p_workflow = 'exam_shared' then
    if caller_role <> 'Professor'
       or not exists (
         select 1
         from public.exams e
         join public.course_enrollments ce
           on ce.course_id = e.course_id
          and ce.student_id = p_recipient_id
         join public.profiles p on p.id = p_recipient_id
         where e.id = p_context_id
           and (e.professor_id = auth.uid() or e.created_by = auth.uid())
           and p.role = 'Student'
           and p.status = 'Active'
       ) then
      raise exception 'Notification not authorized.';
    end if;
  elsif p_workflow = 'permit_request' then
    if caller_role <> 'Professor'
       or not exists (
         select 1
         from public.courses c
         join public.course_enrollments ce
           on ce.course_id = c.id
          and ce.student_id = p_recipient_id
         join public.profiles p on p.id = p_recipient_id
         where c.id = p_context_id
           and c.professor_id = auth.uid()
           and p.role = 'Student'
           and p.status = 'Active'
       ) then
      raise exception 'Notification not authorized.';
    end if;
  elsif p_workflow = 'cluster_broadcast' then
    if caller_role <> 'Cluster Professor'
       or not exists (select 1 from public.profiles where id = p_recipient_id and role = 'Cluster Professor' and status = 'Active') then
      raise exception 'Notification not authorized.';
    end if;
  else
    raise exception 'Unsupported notification workflow.';
  end if;

  insert into public.notifications (user_id, title, message, type, is_read)
  values (p_recipient_id, trim(p_title), trim(p_message), trim(p_type), false)
  returning id into notification_id;

  return notification_id;
end;
$$;

create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if auth.uid() = old.id
     and (
       new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.email is distinct from old.email
       or new.student_number is distinct from old.student_number
       or new.employee_number is distinct from old.employee_number
       or new.created_at is distinct from old.created_at
     ) then
    raise exception 'Profile role, status, identity, and account fields cannot be self-updated.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_fields on public.profiles;
create trigger protect_profile_privileged_fields
before update on public.profiles
for each row execute function public.protect_profile_privileged_fields();

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

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
    from jsonb_array_elements_text(coalesce(p_question.correct_answers, p_question.question_config->'orderItems', '[]'::jsonb)) as value;

    return (config - 'orderItems') || jsonb_build_object('orderItems', order_items);
  end if;

  return config;
end;
$$;

create or replace function public.student_can_take_exam(p_exam_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.exams e
    join public.course_enrollments ce
      on ce.course_id = e.course_id
     and ce.student_id = auth.uid()
    join public.courses c on c.id = e.course_id
    join public.profiles p on p.id = auth.uid()
    where e.id = p_exam_id
      and p.role = 'Student'
      and p.status = 'Active'
      and lower(e.status) in ('published', 'active')
      and not c.archived
      and not coalesce((e.exam_settings->>'archived')::boolean, false)
  )
$$;

create or replace function public.get_student_exam_questions(p_exam_id uuid)
returns table (
  id uuid,
  exam_id uuid,
  question_text text,
  question_type text,
  choices jsonb,
  question_config jsonb,
  manual_grading boolean,
  points numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    q.id,
    q.exam_id,
    q.question_text,
    q.question_type,
    q.choices,
    public.sanitize_student_question_config(q, auth.uid()::text || ':' || q.exam_id::text || ':' || q.id::text),
    q.manual_grading,
    q.points
  from public.exam_questions q
  join public.exams e on e.id = q.exam_id
  where q.exam_id = p_exam_id
    and public.student_can_take_exam(p_exam_id)
    and (nullif(e.exam_settings->>'startsAt', '')::timestamptz is null or nullif(e.exam_settings->>'startsAt', '')::timestamptz <= now())
    and (nullif(e.exam_settings->>'deadline', '')::timestamptz is null or nullif(e.exam_settings->>'deadline', '')::timestamptz > now())
  order by q.id
$$;

revoke all on function public.get_student_exam_questions(uuid) from public;
grant execute on function public.get_student_exam_questions(uuid) to authenticated;

create or replace function public.grade_exam_answer(p_question public.exam_questions, p_answer jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  qtype text := p_question.question_type;
  points numeric := coalesce(p_question.points, 0);
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
    return jsonb_build_object(
      'earnedPoints', case when lower(trim(coalesce(p_answer #>> '{}', ''))) = lower(trim(coalesce(correct->>0, ''))) then points else 0 end,
      'maxPoints', points,
      'manual', false,
      'isCorrect', lower(trim(coalesce(p_answer #>> '{}', ''))) = lower(trim(coalesce(correct->>0, '')))
    );
  end if;

  if qtype = 'Multiple Select' then
    select coalesce(array_agg(lower(trim(value)) order by lower(trim(value))), array[]::text[])
    into expected
    from jsonb_array_elements_text(correct);

    select coalesce(array_agg(lower(trim(value)) order by lower(trim(value))), array[]::text[])
    into submitted
    from jsonb_array_elements_text(case when jsonb_typeof(p_answer) = 'array' then p_answer else '[]'::jsonb end);

    return jsonb_build_object('earnedPoints', case when submitted = expected then points else 0 end, 'maxPoints', points, 'manual', false, 'isCorrect', submitted = expected);
  end if;

  if qtype in ('Identification', 'Fill in the Blank') then
    select coalesce(array_agg(lower(trim(value))), array[]::text[])
    into expected
    from jsonb_array_elements_text(correct);
    return jsonb_build_object('earnedPoints', case when lower(trim(coalesce(p_answer #>> '{}', ''))) = any(expected) then points else 0 end, 'maxPoints', points, 'manual', false, 'isCorrect', lower(trim(coalesce(p_answer #>> '{}', ''))) = any(expected));
  end if;

  if qtype = 'Matching Type' then
    select count(*), count(*) filter (where lower(trim(coalesce(p_answer->>(pair->>'left'), ''))) = lower(trim(coalesce(pair->>'right', ''))))
    into pair_count, correct_count
    from jsonb_array_elements(coalesce(config->'pairs', '[]'::jsonb)) as pair;
    earned := case when pair_count > 0 then (correct_count::numeric / pair_count::numeric) * points else 0 end;
    return jsonb_build_object('earnedPoints', earned, 'maxPoints', points, 'manual', false, 'isCorrect', earned = points);
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
    return jsonb_build_object('earnedPoints', earned, 'maxPoints', points, 'manual', false, 'isCorrect', earned = points);
  end if;

  if qtype = 'Enumeration' then
    select coalesce(array_agg(lower(trim(value))), array[]::text[])
    into expected
    from jsonb_array_elements_text(correct);
    select coalesce(array_agg(distinct lower(trim(value))), array[]::text[])
    into submitted
    from jsonb_array_elements_text(case when jsonb_typeof(p_answer) = 'array' then p_answer else '[]'::jsonb end)
    where length(trim(value)) > 0;
    select count(*)
    into correct_count
    from unnest(submitted) as item
    where item = any(expected);
    earned := case when array_length(expected, 1) > 0 then (correct_count::numeric / array_length(expected, 1)::numeric) * points else 0 end;
    return jsonb_build_object('earnedPoints', earned, 'maxPoints', points, 'manual', false, 'isCorrect', earned = points);
  end if;

  return jsonb_build_object('earnedPoints', 0, 'maxPoints', points, 'manual', false, 'isCorrect', false);
end;
$$;

alter table public.exam_attempts
  add column if not exists submission_session_started_at timestamptz;

create unique index if not exists exam_attempts_one_submission_per_start_session
  on public.exam_attempts (exam_id, student_id, submission_session_started_at)
  where submission_session_started_at is not null;

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

  select started_at
  into started
  from public.exam_start_sessions
  where exam_id = e.id
    and student_id = auth.uid()
  for update;

  if started is null then
    raise exception 'Start this exam through the authorized exam flow.';
  end if;

  select id
  into attempt_id
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
  where exam_id = e.id
    and student_id = auth.uid();

  max_attempts := public.exam_attempt_limit(e.exam_settings);
  if max_attempts is not null and used_attempts >= max_attempts then
    raise exception 'You have used all available attempts for this exam.';
  end if;

  if nullif(e.exam_settings->>'deadline', '')::timestamptz <= now()
     and (
       started > nullif(e.exam_settings->>'deadline', '')::timestamptz
       or (latest_submitted is not null and latest_submitted >= started)
     ) then
    raise exception 'This exam has expired.';
  end if;

  for q in select * from public.exam_questions where exam_id = e.id order by id loop
    answer_value := coalesce(p_answers->(q.id::text), 'null'::jsonb);
    result := public.grade_exam_answer(q, answer_value);
    has_manual := has_manual or coalesce((result->>'manual')::boolean, false);
    earned_total := earned_total + coalesce((result->>'earnedPoints')::numeric, 0);
    max_total := max_total + coalesce((result->>'maxPoints')::numeric, 0);
  end loop;

  insert into public.exam_attempts (
    exam_id,
    student_id,
    score,
    violations,
    status,
    started_at,
    submitted_at,
    submission_session_started_at
  )
  values (
    e.id,
    auth.uid(),
    case when has_manual then null else round((earned_total / nullif(max_total, 0)) * 100, 2) end,
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
    select id
    into attempt_id
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
      attempt_id,
      question_id,
      answer,
      file_url,
      earned_points,
      max_points,
      is_correct,
      needs_manual_grading
    )
    values (
      attempt_id,
      q.id,
      answer_value,
      nullif(answer_value->>'path', ''),
      nullif(result->>'earnedPoints', '')::numeric,
      nullif(result->>'maxPoints', '')::numeric,
      coalesce((result->>'isCorrect')::boolean, false),
      coalesce((result->>'manual')::boolean, false)
    );
  end loop;

  return attempt_id;
end;
$$;

revoke all on function public.submit_exam_attempt(uuid, jsonb, jsonb) from public;
grant execute on function public.submit_exam_attempt(uuid, jsonb, jsonb) to authenticated;

create or replace function public.join_course_by_code(p_joining_code text)
returns table (
  id uuid,
  course_name text,
  course_code text,
  program_id uuid,
  year_level text,
  section text,
  semester text,
  academic_year text,
  joining_code text,
  programs jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  course_row public.courses;
begin
  if public.current_profile_role() <> 'Student' then
    raise exception 'Student access required.';
  end if;

  select *
  into course_row
  from public.courses c
  where c.joining_code = upper(trim(p_joining_code))
    and not c.archived
  limit 1;

  if course_row.id is null then
    raise exception 'Course code not found.';
  end if;

  insert into public.course_enrollments (course_id, student_id)
  values (course_row.id, auth.uid())
  on conflict (course_id, student_id) do nothing;

  return query
  select
    c.id,
    c.course_name,
    c.course_code,
    c.program_id,
    c.year_level,
    c.section,
    c.semester,
    c.academic_year,
    c.joining_code,
    jsonb_build_object('program_code', p.program_code, 'program_name', p.program_name, 'is_active', p.is_active)
  from public.courses c
  left join public.programs p on p.id = c.program_id
  where c.id = course_row.id;
end;
$$;

revoke all on function public.join_course_by_code(text) from public;
grant execute on function public.join_course_by_code(text) to authenticated;

revoke all on function public.is_audit_role() from public, anon, authenticated;
revoke all on function public.current_profile_role() from public, anon, authenticated;
revoke all on function public.is_student_enrolled_in_course(uuid) from public, anon, authenticated;
revoke all on function public.sanitize_student_question_config(public.exam_questions, text) from public, anon, authenticated;
revoke all on function public.student_can_take_exam(uuid) from public, anon, authenticated;
revoke all on function public.grade_exam_answer(public.exam_questions, jsonb) from public, anon, authenticated;
revoke all on function public.protect_profile_privileged_fields() from public, anon, authenticated;
grant execute on function public.is_audit_role() to authenticated;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.is_student_enrolled_in_course(uuid) to authenticated;
grant execute on function public.sanitize_student_question_config(public.exam_questions, text) to authenticated;
grant execute on function public.student_can_take_exam(uuid) to authenticated;
revoke all on function public.create_notification(text, uuid, text, text, text, uuid) from public;
grant execute on function public.create_notification(text, uuid, text, text, text, uuid) to authenticated;

drop policy if exists "exam_questions_student_read_available" on public.exam_questions;

drop policy if exists "attempts_student_insert" on public.exam_attempts;
drop policy if exists "attempts_student_delete_own" on public.exam_attempts;
drop policy if exists "attempt_answers_student_insert" on public.exam_attempt_answers;

drop policy if exists "notifications_authenticated_insert" on public.notifications;

drop policy if exists "courses_read_authenticated" on public.courses;
drop policy if exists "courses_admin_dean_read" on public.courses;
drop policy if exists "courses_cluster_read" on public.courses;
drop policy if exists "courses_professor_read_own" on public.courses;
drop policy if exists "courses_student_read_enrolled" on public.courses;
create policy "courses_admin_dean_read" on public.courses
for select using (public.is_audit_role());
create policy "courses_cluster_read" on public.courses
for select using (public.current_profile_role() = 'Cluster Professor');
create policy "courses_professor_read_own" on public.courses
for select using (professor_id = auth.uid());
create policy "courses_student_read_enrolled" on public.courses
for select using (public.is_student_enrolled_in_course(id));

drop policy if exists "exams_read_authenticated" on public.exams;
drop policy if exists "exams_admin_dean_read" on public.exams;
drop policy if exists "exams_cluster_review_read" on public.exams;
drop policy if exists "exams_student_read_available" on public.exams;
create policy "exams_admin_dean_read" on public.exams
for select using (public.is_audit_role());
create policy "exams_cluster_review_read" on public.exams
for select using (
  public.current_profile_role() = 'Cluster Professor'
  and lower(status) in ('pending review', 'approved', 'rejected')
);
create policy "exams_student_read_available" on public.exams
for select using (
  public.student_can_take_exam(id)
);

drop policy if exists "exams_cluster_review_update" on public.exams;

drop policy if exists "exam_approval_logs_read_authenticated" on public.exam_approval_logs;
drop policy if exists "exam_rejection_logs_read_authenticated" on public.exam_rejection_logs;
drop policy if exists "exam_approval_logs_reviewer_read" on public.exam_approval_logs;
drop policy if exists "exam_rejection_logs_reviewer_read" on public.exam_rejection_logs;
create policy "exam_approval_logs_reviewer_read" on public.exam_approval_logs
for select using (
  public.is_audit_role()
  or public.current_profile_role() = 'Cluster Professor'
  or exists (
    select 1
    from public.exams e
    where e.id = exam_approval_logs.exam_id
      and (e.professor_id = auth.uid() or e.created_by = auth.uid())
  )
);
create policy "exam_rejection_logs_reviewer_read" on public.exam_rejection_logs
for select using (
  public.is_audit_role()
  or public.current_profile_role() = 'Cluster Professor'
  or exists (
    select 1
    from public.exams e
    where e.id = exam_rejection_logs.exam_id
      and (e.professor_id = auth.uid() or e.created_by = auth.uid())
  )
);

drop policy if exists "violations_student_insert" on public.violations;
create policy "violations_student_insert" on public.violations
for insert with check (
  student_id = auth.uid()
  and public.student_can_take_exam(exam_id)
  and exists (
    select 1
    from public.exams e
    where e.id = exam_id
      and e.course_id = violations.course_id
      and (e.professor_id = violations.professor_id or e.created_by = violations.professor_id or violations.professor_id is null)
  )
);

create or replace function public.protect_student_violation_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if auth.uid() = old.student_id then
    if new.id is distinct from old.id
       or new.student_id is distinct from old.student_id
       or new.exam_id is distinct from old.exam_id
       or new.course_id is distinct from old.course_id
       or new.professor_id is distinct from old.professor_id
       or new.violation_type is distinct from old.violation_type
       or new.severity is distinct from old.severity
       or new.created_at is distinct from old.created_at then
      raise exception 'Trusted violation fields cannot be changed by students.';
    end if;

    if old.screenshot_url is not null and new.screenshot_url is distinct from old.screenshot_url then
      raise exception 'Violation screenshot evidence cannot be changed after it is attached.';
    end if;
    if old.evidence_url is not null and new.evidence_url is distinct from old.evidence_url then
      raise exception 'Violation evidence cannot be changed after it is attached.';
    end if;
    if old.evidence_type is not null and new.evidence_type is distinct from old.evidence_type then
      raise exception 'Violation evidence type cannot be changed after it is attached.';
    end if;
    if old.audio_level is not null and new.audio_level is distinct from old.audio_level then
      raise exception 'Violation audio level cannot be changed after it is attached.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_student_violation_updates on public.violations;
create trigger protect_student_violation_updates
before update on public.violations
for each row execute function public.protect_student_violation_updates();

revoke all on function public.protect_student_violation_updates() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
