begin;

alter table public.logs add column if not exists actor_role text;
alter table public.logs add column if not exists event_type text;
alter table public.logs add column if not exists entity_type text;
alter table public.logs add column if not exists entity_id uuid;
alter table public.logs add column if not exists target_user_id uuid references public.profiles(id);
alter table public.logs add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.logs
set event_type = case action
    when 'Password Reset Request' then 'account.password_reset_requested'
    when 'Attempt Reopen Requested' then 'attempt.reopen_requested'
    when 'Attempt Reopen Approved' then 'attempt.reopen_approved'
    when 'Attempt Reopen Rejected' then 'attempt.reopen_rejected'
    when 'Reopened Attempt Resubmitted' then 'attempt.reopen_resubmitted'
    else event_type
  end,
  entity_type = coalesce(entity_type, case when action like 'Attempt Reopen%' or action = 'Reopened Attempt Resubmitted' then 'attempt' else entity_type end),
  metadata = coalesce(metadata, '{}'::jsonb)
where event_type is null;

create index if not exists idx_logs_created_at on public.logs (created_at desc);
create index if not exists idx_logs_user_created_at on public.logs (user_id, created_at desc);
create index if not exists idx_logs_event_created_at on public.logs (event_type, created_at desc);
create index if not exists idx_logs_entity_created_at on public.logs (entity_type, entity_id, created_at desc);
create index if not exists idx_logs_target_user_created_at on public.logs (target_user_id, created_at desc);

drop policy if exists "logs_read_authenticated" on public.logs;
drop policy if exists "logs_read_own_or_audit_roles" on public.logs;
drop policy if exists "logs_select_own_or_admin" on public.logs;
drop policy if exists "logs_no_client_insert" on public.logs;
drop policy if exists "logs_no_client_update" on public.logs;
drop policy if exists "logs_no_client_delete" on public.logs;

create policy "logs_select_own_or_admin" on public.logs
for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role = 'Admin'
  )
);

revoke insert, update, delete on public.logs from anon, authenticated;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role::text from public.profiles where id = auth.uid();
$$;

create or replace function public.write_audit_log(
  p_user_id uuid,
  p_actor_role text,
  p_event_type text,
  p_action text,
  p_description text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_target_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if p_event_type is null or length(btrim(p_event_type)) = 0 then
    raise exception 'Audit event type is required.';
  end if;

  v_metadata := v_metadata - array['password','token','access_token','refresh_token','service_role','secret','answer','answers','signedUrl','signed_url','camera_frame','audio_recording','submission_content'];

  insert into public.logs (
    user_id, actor_role, event_type, action, description,
    entity_type, entity_id, target_user_id, metadata
  )
  values (
    p_user_id,
    nullif(btrim(coalesce(p_actor_role, '')), ''),
    p_event_type,
    coalesce(nullif(btrim(p_action), ''), p_event_type),
    coalesce(nullif(btrim(p_description), ''), p_event_type),
    nullif(btrim(coalesce(p_entity_type, '')), ''),
    p_entity_id,
    p_target_user_id,
    v_metadata
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.write_audit_log(uuid, text, text, text, text, text, uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.admin_create_course(
  p_course_name text,
  p_course_code text,
  p_program_id uuid,
  p_year_level text,
  p_section text,
  p_semester text,
  p_academic_year text,
  p_professor_id uuid,
  p_joining_code text
)
returns public.courses
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles;
  course_row public.courses;
begin
  select * into caller from public.profiles where id = auth.uid();
  if caller.id is null or caller.role <> 'Admin' or caller.status <> 'Active' then
    raise exception 'Only active admins can create courses.';
  end if;

  if length(btrim(coalesce(p_course_name, ''))) = 0 or length(p_course_name) > 160
     or length(btrim(coalesce(p_course_code, ''))) = 0 or length(p_course_code) > 32
     or length(btrim(coalesce(p_section, ''))) = 0 or length(p_section) > 40 then
    raise exception 'Course name, code, and section are required and must fit their limits.';
  end if;

  insert into public.courses (
    course_name, course_code, program_id, year_level, section,
    semester, academic_year, professor_id, joining_code, archived
  )
  values (
    btrim(p_course_name), btrim(p_course_code), p_program_id, nullif(btrim(coalesce(p_year_level, '')), ''),
    btrim(p_section), nullif(btrim(coalesce(p_semester, '')), ''),
    nullif(btrim(coalesce(p_academic_year, '')), ''), p_professor_id,
    upper(btrim(p_joining_code)), false
  )
  returning * into course_row;

  perform public.write_audit_log(
    auth.uid(), caller.role::text, 'course.created', 'Course Created',
    'An admin created a course.', 'course', course_row.id, p_professor_id,
    jsonb_build_object('course_code', course_row.course_code, 'program_id', course_row.program_id)
  );

  return course_row;
end;
$$;

create or replace function public.admin_set_course_archived(p_course_id uuid, p_archived boolean)
returns public.courses
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles;
  course_row public.courses;
begin
  select * into caller from public.profiles where id = auth.uid();
  if caller.id is null or caller.role <> 'Admin' or caller.status <> 'Active' then
    raise exception 'Only active admins can archive courses.';
  end if;

  update public.courses
  set archived = coalesce(p_archived, false)
  where id = p_course_id
  returning * into course_row;

  if course_row.id is null then
    raise exception 'Course not found.';
  end if;

  perform public.write_audit_log(
    auth.uid(), caller.role::text,
    case when course_row.archived then 'course.archived' else 'course.restored' end,
    case when course_row.archived then 'Course Archived' else 'Course Restored' end,
    case when course_row.archived then 'An admin archived a course.' else 'An admin restored a course.' end,
    'course', course_row.id, course_row.professor_id,
    jsonb_build_object('course_code', course_row.course_code)
  );

  return course_row;
end;
$$;

create or replace function public.admin_save_program(p_program_id uuid, p_program_code text, p_program_name text)
returns public.programs
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles;
  program_row public.programs;
  event_name text;
begin
  select * into caller from public.profiles where id = auth.uid();
  if caller.id is null or caller.role <> 'Admin' or caller.status <> 'Active' then
    raise exception 'Only active admins can manage programs.';
  end if;

  if length(btrim(coalesce(p_program_code, ''))) not between 2 and 24
     or length(btrim(coalesce(p_program_name, ''))) not between 3 and 160 then
    raise exception 'Program code and name are required.';
  end if;

  if p_program_id is null then
    insert into public.programs (program_code, program_name)
    values (upper(btrim(p_program_code)), btrim(p_program_name))
    returning * into program_row;
    event_name := 'program.created';
  else
    update public.programs
    set program_code = upper(btrim(p_program_code)),
        program_name = btrim(p_program_name)
    where id = p_program_id
    returning * into program_row;
    event_name := 'program.updated';
  end if;

  if program_row.id is null then
    raise exception 'Program not found.';
  end if;

  perform public.write_audit_log(
    auth.uid(), caller.role::text, event_name,
    case when event_name = 'program.created' then 'Program Created' else 'Program Updated' end,
    case when event_name = 'program.created' then 'An admin created an academic program.' else 'An admin updated an academic program.' end,
    'program', program_row.id, null,
    jsonb_build_object('program_code', program_row.program_code)
  );

  return program_row;
end;
$$;

create or replace function public.admin_set_program_active(p_program_id uuid, p_is_active boolean)
returns public.programs
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles;
  program_row public.programs;
begin
  select * into caller from public.profiles where id = auth.uid();
  if caller.id is null or caller.role <> 'Admin' or caller.status <> 'Active' then
    raise exception 'Only active admins can manage programs.';
  end if;

  update public.programs
  set is_active = coalesce(p_is_active, true)
  where id = p_program_id
  returning * into program_row;

  if program_row.id is null then
    raise exception 'Program not found.';
  end if;

  perform public.write_audit_log(
    auth.uid(), caller.role::text,
    case when program_row.is_active then 'program.restored' else 'program.deactivated' end,
    case when program_row.is_active then 'Program Restored' else 'Program Deactivated' end,
    case when program_row.is_active then 'An admin restored an academic program.' else 'An admin deactivated an academic program.' end,
    'program', program_row.id, null,
    jsonb_build_object('program_code', program_row.program_code)
  );

  return program_row;
end;
$$;

revoke all on function public.admin_create_course(text, text, uuid, text, text, text, text, uuid, text) from public, anon;
revoke all on function public.admin_set_course_archived(uuid, boolean) from public, anon;
revoke all on function public.admin_save_program(uuid, text, text) from public, anon;
revoke all on function public.admin_set_program_active(uuid, boolean) from public, anon;
grant execute on function public.admin_create_course(text, text, uuid, text, text, text, text, uuid, text) to authenticated;
grant execute on function public.admin_set_course_archived(uuid, boolean) to authenticated;
grant execute on function public.admin_save_program(uuid, text, text) to authenticated;
grant execute on function public.admin_set_program_active(uuid, boolean) to authenticated;

create or replace function public.enrich_audit_log_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.actor_role is null and new.user_id is not null then
    select role::text into new.actor_role from public.profiles where id = new.user_id;
  end if;

  if new.event_type is null then
    new.event_type := case new.action
      when 'Password Reset Request' then 'account.password_reset_requested'
      when 'Attempt Reopen Requested' then 'attempt.reopen_requested'
      when 'Attempt Reopen Approved' then 'attempt.reopen_approved'
      when 'Attempt Reopen Rejected' then 'attempt.reopen_rejected'
      when 'Reopened Attempt Resubmitted' then 'attempt.reopen_resubmitted'
      else lower(regexp_replace(coalesce(new.action, 'audit.event'), '[^a-zA-Z0-9]+', '.', 'g'))
    end;
  end if;

  if new.entity_type is null and new.event_type like 'attempt.%' then
    new.entity_type := 'attempt';
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    - array['password','token','access_token','refresh_token','service_role','secret','answer','answers','signedUrl','signed_url','camera_frame','audio_recording','submission_content'];

  return new;
end;
$$;

drop trigger if exists enrich_audit_log_defaults on public.logs;
create trigger enrich_audit_log_defaults
before insert on public.logs
for each row execute function public.enrich_audit_log_defaults();

revoke all on function public.enrich_audit_log_defaults() from public, anon, authenticated;

create or replace function public.set_exam_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql
security invoker
set search_path=public
as $$
declare
  exam_row public.exams;
  actor_role text;
begin
  select role::text into actor_role from public.profiles where id = auth.uid() and role = 'Professor';
  if actor_role is null then
    raise exception 'Professor access required.';
  end if;

  update public.exams
  set exam_settings = jsonb_set(exam_settings, '{archived}', to_jsonb(p_archived))
  where id = p_id and (professor_id = auth.uid() or created_by = auth.uid())
  returning * into exam_row;

  if exam_row.id is null then
    raise exception 'Exam access denied.';
  end if;

  perform public.write_audit_log(
    auth.uid(), actor_role,
    case when coalesce(p_archived, false) then 'exam.archived' else 'exam.restored' end,
    case when coalesce(p_archived, false) then 'Exam Archived' else 'Exam Restored' end,
    case when coalesce(p_archived, false) then 'A professor archived an exam.' else 'A professor restored an exam.' end,
    'exam', exam_row.id, null,
    jsonb_build_object('course_id', exam_row.course_id, 'status', exam_row.status)
  );
end;
$$;

revoke all on function public.set_exam_archived(uuid, boolean) from public, anon;
grant execute on function public.set_exam_archived(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
