alter table public.notifications
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists action_path text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notifications_action_path_internal'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications
      add constraint notifications_action_path_internal
      check (action_path is null or (action_path like '/%' and action_path not like '//%'));
  end if;
end $$;

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  show_message_previews boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists "notification_preferences_owner_select" on public.notification_preferences;
create policy "notification_preferences_owner_select" on public.notification_preferences
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "notification_preferences_owner_insert" on public.notification_preferences;
create policy "notification_preferences_owner_insert" on public.notification_preferences
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "notification_preferences_owner_update" on public.notification_preferences;
create policy "notification_preferences_owner_update" on public.notification_preferences
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.touch_notification_preferences_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_notification_preferences_updated_at on public.notification_preferences;
create trigger touch_notification_preferences_updated_at
before update on public.notification_preferences
for each row execute function public.touch_notification_preferences_updated_at();

create index if not exists idx_notifications_user_created_at
on public.notifications (user_id, created_at desc);

create index if not exists idx_notifications_user_unread_created_at
on public.notifications (user_id, is_read, created_at desc);

create index if not exists idx_notifications_user_type_created_at
on public.notifications (user_id, type, created_at desc);

drop policy if exists "notifications_authenticated_insert" on public.notifications;
drop policy if exists "notifications_owner_update" on public.notifications;

revoke all on public.notifications from anon;
revoke insert, update, delete, truncate, references, trigger on public.notifications from authenticated;
grant select on public.notifications to authenticated;

revoke all on public.notification_preferences from anon;
grant select, insert, update on public.notification_preferences to authenticated;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  update public.notifications
  set is_read = true
  where id = p_notification_id
    and user_id = auth.uid()
    and is_read = false;

  get diagnostics changed_count = row_count;
  return changed_count > 0;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  update public.notifications
  set is_read = true
  where user_id = auth.uid()
    and is_read = false;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

create or replace function public.create_notification(
  p_workflow text,
  p_recipient_id uuid,
  p_title text,
  p_message text,
  p_type text,
  p_context_id uuid default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_action_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  notification_id uuid;
  clean_action_path text := nullif(btrim(coalesce(p_action_path, '')), '');
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

  if clean_action_path is not null and (clean_action_path not like '/%' or clean_action_path like '//%' or clean_action_path ~* '^[a-z][a-z0-9+.-]*:') then
    raise exception 'Invalid notification action path.';
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

  insert into public.notifications (user_id, title, message, type, is_read, entity_type, entity_id, action_path)
  values (p_recipient_id, trim(p_title), trim(p_message), trim(p_type), false, nullif(btrim(coalesce(p_entity_type, '')), ''), p_entity_id, clean_action_path)
  returning id into notification_id;

  return notification_id;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.mark_all_notifications_read() from public, anon;
revoke all on function public.create_notification(text, uuid, text, text, text, uuid, text, uuid, text) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.create_notification(text, uuid, text, text, text, uuid, text, uuid, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

create or replace function public.request_exam_attempt_reopen(p_attempt_id uuid, p_reason text)
returns public.exam_attempt_reopen_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_reason text := btrim(coalesce(p_reason, ''));
  profile_row public.profiles;
  attempt_row public.exam_attempts;
  exam_row public.exams;
  max_attempts integer;
  request_row public.exam_attempt_reopen_requests;
begin
  if length(clean_reason) = 0 then
    raise exception 'Reason is required.';
  end if;

  if length(clean_reason) > 500 then
    raise exception 'Reason must be 500 characters or fewer.';
  end if;

  select * into profile_row from public.profiles where id = auth.uid();
  if profile_row.id is null or profile_row.role <> 'Student' or profile_row.status <> 'Active' then
    raise exception 'Only active students can request reopening.';
  end if;

  select * into attempt_row
  from public.exam_attempts
  where id = p_attempt_id
  for update;

  if attempt_row.id is null or attempt_row.student_id <> auth.uid() then
    raise exception 'Attempt not found.';
  end if;

  if attempt_row.status = 'Reopened' then
    raise exception 'This attempt is already reopened.';
  end if;

  if attempt_row.submitted_at is null then
    raise exception 'Only submitted attempts can be reopened.';
  end if;

  if attempt_row.status not in ('Submitted', 'Pending Manual Grading', 'Manually Graded') then
    raise exception 'This attempt is not eligible for reopening.';
  end if;

  select * into exam_row from public.exams where id = attempt_row.exam_id for update;
  if exam_row.id is null then
    raise exception 'Exam not found.';
  end if;

  max_attempts := public.exam_attempt_limit(exam_row.exam_settings);
  if max_attempts is distinct from 1 then
    raise exception 'Only one-attempt exams can be reopened.';
  end if;

  if nullif(exam_row.exam_settings->>'deadline', '')::timestamptz <= now() then
    raise exception 'The exam deadline has passed. Reopening is no longer available.';
  end if;

  if not exists (
    select 1
    from public.course_enrollments ce
    join public.courses c on c.id = ce.course_id
    where ce.course_id = exam_row.course_id
      and ce.student_id = auth.uid()
      and not c.archived
  ) then
    raise exception 'Exam access denied.';
  end if;

  insert into public.exam_attempt_reopen_requests (
    attempt_id, exam_id, student_id, requested_by, reason,
    original_submitted_at, original_score, original_earned_points, original_max_points, original_status
  )
  values (
    attempt_row.id, attempt_row.exam_id, attempt_row.student_id, auth.uid(), clean_reason,
    attempt_row.submitted_at, attempt_row.score, attempt_row.earned_points, attempt_row.max_points, attempt_row.status
  )
  returning * into request_row;

  insert into public.logs (user_id, action, description)
  values (auth.uid(), 'Attempt Reopen Requested', 'A student requested reopening for an exam attempt.');

  insert into public.notifications (user_id, title, message, type, is_read, entity_type, entity_id, action_path)
  select
    coalesce(e.professor_id, e.created_by),
    'Attempt Reopen Request',
    coalesce(profile_row.full_name, profile_row.email, 'A student') || ' requested an attempt reopening.',
    'Attempt Reopen',
    false,
    'exam_attempt_reopen_request',
    request_row.id,
    '/professor/scores/' || attempt_row.exam_id::text
  from public.exams e
  where e.id = attempt_row.exam_id
    and coalesce(e.professor_id, e.created_by) is not null;

  return request_row;
exception
  when unique_violation then
    raise exception 'A reopening request already exists for this attempt.';
end;
$$;

create or replace function public.review_exam_attempt_reopen_request(p_request_id uuid, p_decision text)
returns public.exam_attempt_reopen_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_decision text := initcap(lower(btrim(coalesce(p_decision, ''))));
  request_row public.exam_attempt_reopen_requests;
  attempt_row public.exam_attempts;
  exam_row public.exams;
  reviewer public.profiles;
begin
  if clean_decision not in ('Approved', 'Rejected') then
    raise exception 'Decision must be Approved or Rejected.';
  end if;

  select * into reviewer from public.profiles where id = auth.uid();
  if reviewer.id is null or reviewer.role <> 'Professor' or reviewer.status <> 'Active' then
    raise exception 'Only authorized professors can review reopening requests.';
  end if;

  select * into request_row
  from public.exam_attempt_reopen_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Reopening request not found.';
  end if;

  if request_row.status <> 'Pending' then
    raise exception 'This reopening request has already been reviewed.';
  end if;

  select * into attempt_row from public.exam_attempts where id = request_row.attempt_id for update;
  select * into exam_row from public.exams where id = request_row.exam_id for update;

  if exam_row.id is null
     or attempt_row.id is null
     or attempt_row.exam_id <> request_row.exam_id
     or attempt_row.student_id <> request_row.student_id then
    raise exception 'Reopening request is no longer valid.';
  end if;

  if not (exam_row.professor_id = auth.uid() or exam_row.created_by = auth.uid()) then
    raise exception 'You are not authorized to review this request.';
  end if;

  if clean_decision = 'Approved' then
    if public.exam_attempt_limit(exam_row.exam_settings) is distinct from 1 then
      raise exception 'Only one-attempt exams can be reopened.';
    end if;

    if nullif(exam_row.exam_settings->>'deadline', '')::timestamptz <= now() then
      raise exception 'The exam deadline has passed. This request can no longer be approved.';
    end if;

    update public.exam_attempts
    set status = 'Reopened',
        score = null,
        earned_points = null,
        max_points = null,
        submitted_at = null
    where id = attempt_row.id;
  end if;

  update public.exam_attempt_reopen_requests
  set status = clean_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  insert into public.logs (user_id, action, description)
  values (
    auth.uid(),
    case when clean_decision = 'Approved' then 'Attempt Reopen Approved' else 'Attempt Reopen Rejected' end,
    'A professor reviewed an attempt reopening request.'
  );

  insert into public.notifications (user_id, title, message, type, is_read, entity_type, entity_id, action_path)
  values (
    request_row.student_id,
    case when clean_decision = 'Approved' then 'Attempt Reopened' else 'Attempt Reopen Rejected' end,
    case when clean_decision = 'Approved'
      then 'Your reopening request was approved. You may reopen the exam before the deadline.'
      else 'Your reopening request was rejected.'
    end,
    'Attempt Reopen',
    false,
    'exam_attempt_reopen_request',
    request_row.id,
    '/student/grades'
  );

  return request_row;
end;
$$;

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
    insert into public.notifications (user_id, title, message, type, is_read, entity_type, entity_id, action_path)
    select
      id,
      'Exam Assigned',
      coalesce(exam_row.exam_title, exam_row.title, 'An exam') || ' is now available to you.',
      'Exam',
      false,
      'exam',
      p_exam_id,
      '/student/courses/' || exam_row.course_id::text || '/assessments'
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
    insert into public.notifications (user_id, title, message, type, is_read, entity_type, entity_id, action_path)
    select
      a.student_id,
      'Exam Available',
      coalesce(exam_row.exam_title, exam_row.title, 'An exam') || ' is now available to you.',
      'Exam',
      false,
      'exam',
      p_exam_id,
      '/student/courses/' || exam_row.course_id::text || '/assessments'
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

  insert into public.notifications (user_id, title, message, type, is_read, entity_type, entity_id, action_path)
  values (
    p_student_id,
    'Exam Shared',
    coalesce(exam_row.exam_title, exam_row.title, 'An exam') || ' was shared with you.',
    'Exam',
    false,
    'exam',
    p_exam_id,
    '/student/courses/' || exam_row.course_id::text || '/assessments'
  );

  return p_exam_id;
end;
$$;

revoke all on function public.request_exam_attempt_reopen(uuid, text) from public, anon;
revoke all on function public.review_exam_attempt_reopen_request(uuid, text) from public, anon;
revoke all on function public.save_exam_assignments(uuid, text, uuid[]) from public, anon;
revoke all on function public.publish_exam(uuid) from public, anon;
revoke all on function public.grant_exam_student_exception(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.request_exam_attempt_reopen(uuid, text) to authenticated;
grant execute on function public.review_exam_attempt_reopen_request(uuid, text) to authenticated;
grant execute on function public.save_exam_assignments(uuid, text, uuid[]) to authenticated;
grant execute on function public.publish_exam(uuid) to authenticated;
grant execute on function public.grant_exam_student_exception(uuid, uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
