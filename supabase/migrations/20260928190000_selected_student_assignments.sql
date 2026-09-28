alter table public.exams
  add column if not exists assignment_mode text not null default 'entire_course';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'exams_assignment_mode_check'
      and conrelid = 'public.exams'::regclass
  ) then
    alter table public.exams
      add constraint exams_assignment_mode_check
      check (assignment_mode in ('entire_course', 'selected_students'));
  end if;
end $$;

create table if not exists public.exam_student_assignments (
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  primary key (exam_id, student_id)
);

create index if not exists exam_student_assignments_student_idx
  on public.exam_student_assignments(student_id, exam_id);

create table if not exists public.exam_student_access_exceptions (
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  allow_after_deadline boolean not null default true,
  reason text,
  primary key (exam_id, student_id)
);

create index if not exists exam_student_access_exceptions_student_idx
  on public.exam_student_access_exceptions(student_id, exam_id);

alter table public.exam_student_assignments enable row level security;
alter table public.exam_student_access_exceptions enable row level security;

create or replace function public.professor_owns_exam(p_exam_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.exams e
    join public.profiles p on p.id = auth.uid()
    where e.id = p_exam_id
      and p.role = 'Professor'
      and p.status = 'Active'
      and (e.professor_id = auth.uid() or e.created_by = auth.uid())
  )
$$;

create or replace function public.student_has_exam_deadline_exception(p_exam_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.exam_student_access_exceptions x
    where x.exam_id = p_exam_id
      and x.student_id = auth.uid()
      and x.allow_after_deadline
  )
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
    join public.courses c on c.id = e.course_id
    join public.profiles p on p.id = auth.uid()
    where e.id = p_exam_id
      and p.role = 'Student'
      and p.status = 'Active'
      and lower(e.status) in ('published', 'active')
      and not c.archived
      and not coalesce((e.exam_settings->>'archived')::boolean, false)
      and (
        exists (
          select 1
          from public.exam_student_access_exceptions x
          where x.exam_id = e.id
            and x.student_id = auth.uid()
        )
        or (
          exists (
            select 1
            from public.course_enrollments ce
            where ce.course_id = e.course_id
              and ce.student_id = auth.uid()
          )
          and (
            e.assignment_mode = 'entire_course'
            or (
              e.assignment_mode = 'selected_students'
              and exists (
                select 1
                from public.exam_student_assignments a
                where a.exam_id = e.id
                  and a.student_id = auth.uid()
              )
            )
          )
        )
      )
  )
$$;

drop policy if exists "exam_student_assignments_professor_read" on public.exam_student_assignments;
drop policy if exists "exam_student_assignments_student_read_own" on public.exam_student_assignments;
drop policy if exists "exam_student_assignments_professor_manage" on public.exam_student_assignments;
create policy "exam_student_assignments_professor_read" on public.exam_student_assignments
for select to authenticated
using (public.professor_owns_exam(exam_id));
create policy "exam_student_assignments_student_read_own" on public.exam_student_assignments
for select to authenticated
using (student_id = auth.uid());
create policy "exam_student_assignments_professor_manage" on public.exam_student_assignments
for all to authenticated
using (public.professor_owns_exam(exam_id))
with check (public.professor_owns_exam(exam_id));

drop policy if exists "exam_student_access_exceptions_professor_read" on public.exam_student_access_exceptions;
drop policy if exists "exam_student_access_exceptions_student_read_own" on public.exam_student_access_exceptions;
drop policy if exists "exam_student_access_exceptions_professor_manage" on public.exam_student_access_exceptions;
create policy "exam_student_access_exceptions_professor_read" on public.exam_student_access_exceptions
for select to authenticated
using (public.professor_owns_exam(exam_id));
create policy "exam_student_access_exceptions_student_read_own" on public.exam_student_access_exceptions
for select to authenticated
using (student_id = auth.uid());
create policy "exam_student_access_exceptions_professor_manage" on public.exam_student_access_exceptions
for all to authenticated
using (public.professor_owns_exam(exam_id))
with check (public.professor_owns_exam(exam_id));

create or replace function public.guard_selected_student_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.status) in ('published', 'active')
     and new.assignment_mode = 'selected_students'
     and not exists (
       select 1
       from public.exam_student_assignments a
       where a.exam_id = new.id
     ) then
    raise exception 'Select at least one student before publishing this exam.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_selected_student_publish on public.exams;
create trigger guard_selected_student_publish
before insert or update of status, assignment_mode on public.exams
for each row execute function public.guard_selected_student_publish();

create or replace function public.save_exam_assignments(
  p_exam_id uuid,
  p_assignment_mode text,
  p_student_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_mode text := coalesce(nullif(p_assignment_mode, ''), 'entire_course');
  student_ids uuid[] := coalesce(p_student_ids, '{}'::uuid[]);
  exam_row public.exams;
  locked_ids uuid[];
  new_ids uuid[];
begin
  if clean_mode not in ('entire_course', 'selected_students') then
    raise exception 'Unsupported assignment mode.';
  end if;

  select * into exam_row
  from public.exams
  where id = p_exam_id
    and (professor_id = auth.uid() or created_by = auth.uid())
  for update;

  if exam_row.id is null then
    raise exception 'Exam access denied.';
  end if;

  if exists (
    select 1
    from unnest(student_ids) as selected(student_id)
    where not exists (
      select 1
      from public.course_enrollments ce
      join public.profiles p on p.id = ce.student_id
      where ce.course_id = exam_row.course_id
        and ce.student_id = selected.student_id
        and p.role = 'Student'
        and p.status = 'Active'
    )
  ) then
    raise exception 'Assigned students must be active students enrolled in this course.';
  end if;

  select coalesce(array_agg(distinct student_id), '{}'::uuid[])
  into locked_ids
  from (
    select student_id from public.exam_start_sessions where exam_id = p_exam_id
    union
    select student_id from public.exam_attempts where exam_id = p_exam_id
  ) locked;

  if exists (
    select 1
    from public.exam_student_assignments a
    where a.exam_id = p_exam_id
      and a.student_id = any(locked_ids)
      and not a.student_id = any(student_ids)
  ) then
    raise exception 'Students who have started this exam cannot be removed.';
  end if;

  select coalesce(array_agg(distinct selected.student_id), '{}'::uuid[])
  into new_ids
  from unnest(student_ids) as selected(student_id)
  where not exists (
    select 1
    from public.exam_student_assignments a
    where a.exam_id = p_exam_id
      and a.student_id = selected.student_id
  );

  update public.exams
  set assignment_mode = clean_mode
  where id = p_exam_id;

  delete from public.exam_student_assignments a
  where a.exam_id = p_exam_id
    and not a.student_id = any(student_ids)
    and not a.student_id = any(locked_ids);

  insert into public.exam_student_assignments (exam_id, student_id, assigned_by)
  select p_exam_id, selected.student_id, auth.uid()
  from unnest(student_ids) as selected(student_id)
  on conflict (exam_id, student_id) do nothing;

  if clean_mode = 'selected_students'
     and lower(exam_row.status) in ('published', 'active')
     and cardinality(new_ids) > 0 then
    insert into public.notifications (user_id, title, message, type, is_read)
    select
      id,
      'Exam Assigned',
      coalesce(exam_row.exam_title, exam_row.title, 'An exam') || ' is now available to you.',
      'Exam',
      false
    from public.profiles
    where id = any(new_ids);
  end if;

  return jsonb_build_object(
    'assignment_mode', clean_mode,
    'assigned_count', cardinality(student_ids),
    'locked_count', cardinality(locked_ids),
    'notified_count', cardinality(new_ids)
  );
end;
$$;

create or replace function public.publish_exam(p_exam_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  exam_row public.exams;
begin
  select * into exam_row
  from public.exams
  where id = p_exam_id
    and (professor_id = auth.uid() or created_by = auth.uid())
  for update;

  if exam_row.id is null then
    raise exception 'Exam access denied.';
  end if;

  if exam_row.assignment_mode = 'selected_students'
     and not exists (select 1 from public.exam_student_assignments where exam_id = p_exam_id) then
    raise exception 'Select at least one student before publishing this exam.';
  end if;

  update public.exams
  set status = 'Published'
  where id = p_exam_id;

  if exam_row.assignment_mode = 'selected_students' then
    insert into public.notifications (user_id, title, message, type, is_read)
    select
      a.student_id,
      'Exam Available',
      coalesce(exam_row.exam_title, exam_row.title, 'An exam') || ' is now available to you.',
      'Exam',
      false
    from public.exam_student_assignments a
    where a.exam_id = p_exam_id;
  end if;

  return p_exam_id;
end;
$$;

create or replace function public.grant_exam_student_exception(
  p_exam_id uuid,
  p_student_id uuid,
  p_allow_after_deadline boolean default true,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  exam_row public.exams;
begin
  select * into exam_row
  from public.exams
  where id = p_exam_id
    and (professor_id = auth.uid() or created_by = auth.uid())
  for update;

  if exam_row.id is null then
    raise exception 'Exam access denied.';
  end if;

  if not exists (
    select 1
    from public.course_enrollments ce
    join public.profiles p on p.id = ce.student_id
    where ce.course_id = exam_row.course_id
      and ce.student_id = p_student_id
      and p.role = 'Student'
      and p.status = 'Active'
  ) then
    raise exception 'Shared student must be an active enrolled student.';
  end if;

  insert into public.exam_student_access_exceptions (
    exam_id, student_id, granted_by, allow_after_deadline, reason
  )
  values (
    p_exam_id, p_student_id, auth.uid(), coalesce(p_allow_after_deadline, true), nullif(btrim(coalesce(p_reason, '')), '')
  )
  on conflict (exam_id, student_id) do update set
    granted_by = excluded.granted_by,
    granted_at = now(),
    allow_after_deadline = excluded.allow_after_deadline,
    reason = excluded.reason;

  insert into public.notifications (user_id, title, message, type, is_read)
  values (
    p_student_id,
    'Exam Shared',
    coalesce(exam_row.exam_title, exam_row.title, 'An exam') || ' was shared with you.',
    'Exam',
    false
  );

  return p_exam_id;
end;
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
    and (
      nullif(e.exam_settings->>'deadline', '')::timestamptz is null
      or nullif(e.exam_settings->>'deadline', '')::timestamptz > now()
      or public.student_has_exam_deadline_exception(p_exam_id)
    )
  order by q.id
$$;

create or replace function public.authorize_exam_start(p_exam_id uuid)
returns timestamptz
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
  reopened_attempt public.exam_attempts;
  reopen_request public.exam_attempt_reopen_requests;
  has_deadline_exception boolean := false;
begin
  select * into e from public.exams where id = p_exam_id for update;

  if e.id is null or not public.student_can_take_exam(p_exam_id) then
    raise exception 'Exam access denied.';
  end if;

  has_deadline_exception := public.student_has_exam_deadline_exception(p_exam_id);

  select * into reopened_attempt
  from public.exam_attempts
  where exam_id = e.id
    and student_id = auth.uid()
    and status = 'Reopened'
  order by submitted_at desc nulls last, id desc
  limit 1
  for update;

  if reopened_attempt.id is not null then
    max_attempts := public.exam_attempt_limit(e.exam_settings);
    if max_attempts is distinct from 1 then
      raise exception 'Only one-attempt exams can be reopened.';
    end if;

    select * into reopen_request
    from public.exam_attempt_reopen_requests
    where attempt_id = reopened_attempt.id
      and exam_id = e.id
      and student_id = auth.uid()
      and status = 'Approved'
    for update;

    if reopen_request.id is null then
      raise exception 'Reopened attempt is missing approval.';
    end if;

    if nullif(e.exam_settings->>'startsAt', '')::timestamptz > now() then
      raise exception 'This exam is scheduled and has not started.';
    end if;

    if nullif(e.exam_settings->>'deadline', '')::timestamptz <= now() then
      raise exception 'Exam is not available for reopening.';
    end if;

    if reopen_request.reopened_started_at is null then
      started := clock_timestamp();
      insert into public.exam_start_sessions (
        exam_id, student_id, started_at, interruption_count, interruption_limit,
        recovery_event_keys, last_recovery_event_key, last_recovery_at
      )
      values (e.id, auth.uid(), started, 0, 3, '[]'::jsonb, null, null)
      on conflict (exam_id, student_id) do update set
        started_at = excluded.started_at,
        interruption_count = 0,
        interruption_limit = 3,
        recovery_event_keys = '[]'::jsonb,
        last_recovery_event_key = null,
        last_recovery_at = null;

      update public.exam_attempts
      set started_at = started,
          submission_session_started_at = started
      where id = reopened_attempt.id;

      update public.exam_attempt_reopen_requests
      set reopened_started_at = started,
          updated_at = now()
      where id = reopen_request.id;

      return started;
    end if;

    return reopen_request.reopened_started_at;
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

  select started_at into started
  from public.exam_start_sessions
  where exam_id = e.id
    and student_id = auth.uid();

  if started is not null and not exists (
    select 1
    from public.exam_attempts
    where exam_id = e.id
      and student_id = auth.uid()
      and submission_session_started_at = started
  ) then
    return started;
  end if;

  if nullif(e.exam_settings->>'startsAt', '')::timestamptz > now() then
    raise exception 'This exam is scheduled and has not started.';
  end if;

  if nullif(e.exam_settings->>'deadline', '')::timestamptz <= now()
     and not has_deadline_exception then
    raise exception 'This exam has expired.';
  end if;

  insert into public.exam_start_sessions (
    exam_id, student_id, started_at, interruption_count, interruption_limit,
    recovery_event_keys, last_recovery_event_key, last_recovery_at
  )
  values (e.id, auth.uid(), clock_timestamp(), 0, 3, '[]'::jsonb, null, null)
  on conflict (exam_id, student_id) do update set
    started_at = clock_timestamp(),
    interruption_count = 0,
    interruption_limit = 3,
    recovery_event_keys = '[]'::jsonb,
    last_recovery_event_key = null,
    last_recovery_at = null
  returning started_at into started;

  return started;
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
  v_attempt_id uuid;
  attempt_status text;
  approved_reopen_exists boolean := false;
  is_reopened boolean := false;
  has_deadline_exception boolean := false;
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

  has_deadline_exception := public.student_has_exam_deadline_exception(p_exam_id);

  if nullif(e.exam_settings->>'startsAt', '')::timestamptz > now() then
    raise exception 'This exam is scheduled and has not started.';
  end if;

  select started_at into started
  from public.exam_start_sessions
  where exam_id = e.id
    and student_id = auth.uid()
  for update;

  if started is null then
    raise exception 'Start this exam through the authorized exam flow.';
  end if;

  select id, status
  into v_attempt_id, attempt_status
  from public.exam_attempts
  where exam_id = e.id
    and student_id = auth.uid()
    and submission_session_started_at = started
  order by submitted_at desc nulls last
  limit 1
  for update;

  is_reopened := v_attempt_id is not null and attempt_status = 'Reopened';

  if is_reopened then
    max_attempts := public.exam_attempt_limit(e.exam_settings);
    select exists (
      select 1
      from public.exam_attempt_reopen_requests r
      where r.attempt_id = v_attempt_id
        and r.exam_id = e.id
        and r.student_id = auth.uid()
        and r.status = 'Approved'
    ) into approved_reopen_exists;

    is_reopened := approved_reopen_exists and max_attempts is not distinct from 1;
    if not is_reopened then
      raise exception 'Reopened attempt is not authorized.';
    end if;
  end if;

  if v_attempt_id is not null and not is_reopened then
    return v_attempt_id;
  end if;

  select count(*)::integer, max(submitted_at)
  into used_attempts, latest_submitted
  from public.exam_attempts
  where exam_id = e.id and student_id = auth.uid();

  max_attempts := public.exam_attempt_limit(e.exam_settings);
  if not is_reopened and max_attempts is not null and used_attempts >= max_attempts then
    raise exception 'You have used all available attempts for this exam.';
  end if;

  if nullif(e.exam_settings->>'deadline', '')::timestamptz <= now()
     and not has_deadline_exception
     and (is_reopened
          or started > nullif(e.exam_settings->>'deadline', '')::timestamptz
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

  if is_reopened then
    update public.exam_attempts
    set score = case when has_manual then null when max_total > 0 then round((earned_total / max_total) * 100, 2) else 0 end,
        earned_points = earned_total,
        max_points = max_total,
        violations = coalesce(p_violations, '[]'::jsonb),
        status = case when has_manual then 'Pending Manual Grading' else 'Submitted' end,
        started_at = started,
        submitted_at = now(),
        submission_session_started_at = started
    where id = v_attempt_id;
  else
    insert into public.exam_attempts (
      exam_id, student_id, score, earned_points, max_points, status, violations, started_at, submitted_at, submission_session_started_at
    )
    values (
      e.id,
      auth.uid(),
      case when has_manual then null when max_total > 0 then round((earned_total / max_total) * 100, 2) else 0 end,
      earned_total,
      max_total,
      case when has_manual then 'Pending Manual Grading' else 'Submitted' end,
      coalesce(p_violations, '[]'::jsonb),
      started,
      now(),
      started
    )
    returning id into v_attempt_id;
  end if;

  delete from public.exam_attempt_answers where attempt_id = v_attempt_id;

  for q in select * from public.exam_questions where exam_id = e.id order by id loop
    answer_value := coalesce(p_answers->(q.id::text), 'null'::jsonb);
    result := public.grade_exam_answer(q, answer_value);
    insert into public.exam_attempt_answers (
      attempt_id, question_id, answer, earned_points, max_points, is_correct, needs_manual_grading, file_url
    )
    values (
      v_attempt_id,
      q.id,
      answer_value,
      (result->>'earnedPoints')::numeric,
      (result->>'maxPoints')::numeric,
      coalesce((result->>'correct')::boolean, false),
      coalesce((result->>'manual')::boolean, false),
      nullif(result->>'fileUrl', '')
    );
  end loop;

  return v_attempt_id;
end;
$$;

create or replace function public.guard_exam_attempt_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.exams;
  started timestamptz;
  latest_submitted timestamptz;
  max_attempts integer;
  used_attempts integer;
begin
  select * into e from public.exams where id = new.exam_id;
  if e.id is null or new.student_id <> auth.uid() or not public.student_can_take_exam(e.id) then
    raise exception 'Exam is not available for your account.';
  end if;

  if nullif(e.exam_settings->>'startsAt', '')::timestamptz > now() then
    raise exception 'This exam is scheduled and has not started.';
  end if;

  select started_at into started
  from public.exam_start_sessions
  where exam_id = e.id
    and student_id = new.student_id;

  select max(submitted_at), count(*)::integer
  into latest_submitted, used_attempts
  from public.exam_attempts
  where exam_id = e.id
    and student_id = new.student_id;

  if nullif(e.exam_settings->>'deadline', '')::timestamptz <= now()
     and not exists (
       select 1
       from public.exam_student_access_exceptions x
       where x.exam_id = e.id
         and x.student_id = new.student_id
         and x.allow_after_deadline
     )
     and (
       started is null
       or started > nullif(e.exam_settings->>'deadline', '')::timestamptz
       or (latest_submitted is not null and latest_submitted >= started)
     ) then
    raise exception 'This exam has expired.';
  end if;

  max_attempts := public.exam_attempt_limit(e.exam_settings);
  if max_attempts is not null and used_attempts >= max_attempts then
    raise exception 'You have used all available attempts for this exam.';
  end if;

  return new;
end;
$$;

revoke all on function public.professor_owns_exam(uuid) from public, anon;
revoke all on function public.student_has_exam_deadline_exception(uuid) from public, anon;
revoke all on function public.save_exam_assignments(uuid, text, uuid[]) from public, anon;
revoke all on function public.publish_exam(uuid) from public, anon;
revoke all on function public.grant_exam_student_exception(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.professor_owns_exam(uuid) to authenticated;
grant execute on function public.student_has_exam_deadline_exception(uuid) to authenticated;
grant execute on function public.save_exam_assignments(uuid, text, uuid[]) to authenticated;
grant execute on function public.publish_exam(uuid) to authenticated;
grant execute on function public.grant_exam_student_exception(uuid, uuid, boolean, text) to authenticated;
grant select on public.exam_student_assignments to authenticated;
grant select on public.exam_student_access_exceptions to authenticated;
