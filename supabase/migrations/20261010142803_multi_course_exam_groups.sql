-- Multi-course exam groups. Every member remains an independent course exam.
begin;

create table public.exam_publish_groups (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id),
  request_key text not null,
  request_payload jsonb not null,
  request_digest text not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_publish_groups_request_key_unique unique (created_by, request_key),
  constraint exam_publish_groups_request_key_nonempty check (length(btrim(request_key)) between 1 and 200)
);

create table public.exam_publish_group_members (
  group_id uuid not null references public.exam_publish_groups(id) on delete restrict,
  exam_id uuid not null unique references public.exams(id) on delete restrict,
  course_id uuid not null references public.courses(id),
  primary key (group_id, exam_id),
  unique (group_id, course_id)
);

create index exam_publish_group_members_course_idx on public.exam_publish_group_members(course_id);
alter table public.exam_questions add column sort_order integer;
create index exam_questions_exam_sort_idx on public.exam_questions(exam_id, sort_order, id);

create schema if not exists exam_private;
revoke all on schema exam_private from public, anon, authenticated;
create table exam_private.group_write_context (
  transaction_id bigint not null,
  backend_pid integer not null,
  group_id uuid not null references public.exam_publish_groups(id) on delete cascade,
  primary key (transaction_id, backend_pid, group_id)
);
revoke all on exam_private.group_write_context from public, anon, authenticated;

create or replace function public.get_student_exam_questions(p_exam_id uuid)
returns table (
  id uuid, exam_id uuid, question_text text, question_type text,
  choices jsonb, question_config jsonb, manual_grading boolean, points numeric
)
language sql stable security definer set search_path = public
as $$
  select q.id, q.exam_id, q.question_text, q.question_type, q.choices,
    public.sanitize_student_question_config(q, auth.uid()::text || ':' || q.exam_id::text || ':' || q.id::text),
    q.manual_grading, q.points
  from public.exam_questions q
  join public.exams e on e.id = q.exam_id
  where q.exam_id = p_exam_id
    and public.student_can_take_exam(p_exam_id)
    and (nullif(e.exam_settings->>'startsAt', '')::timestamptz is null
      or nullif(e.exam_settings->>'startsAt', '')::timestamptz <= now())
    and (nullif(e.exam_settings->>'deadline', '')::timestamptz is null
      or nullif(e.exam_settings->>'deadline', '')::timestamptz > now()
      or public.student_has_exam_deadline_exception(p_exam_id))
  order by q.sort_order nulls last, q.id
$$;
revoke all on function public.get_student_exam_questions(uuid) from public, anon;
grant execute on function public.get_student_exam_questions(uuid) to authenticated;

alter table public.exam_publish_groups enable row level security;
alter table public.exam_publish_group_members enable row level security;

create policy exam_publish_groups_owner_read on public.exam_publish_groups
for select to authenticated using (
  created_by = (select auth.uid())
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'Cluster Professor' and p.status = 'Active'
  )
);

create policy exam_publish_group_members_owner_read on public.exam_publish_group_members
for select to authenticated using (
  exists (
    select 1 from public.exam_publish_groups g
    where g.id = group_id and (
      g.created_by = (select auth.uid())
      or exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'Cluster Professor' and p.status = 'Active'
      )
    )
  )
);

grant select on public.exam_publish_groups, public.exam_publish_group_members to authenticated;

create or replace function public.publish_exam_group(
  p_source_exam_id uuid,
  p_exam jsonb,
  p_questions jsonb,
  p_course_ids uuid[],
  p_assignments jsonb,
  p_request_key text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_courses uuid[];
  v_course uuid;
  v_group public.exam_publish_groups;
  v_payload jsonb;
  v_assignments jsonb := coalesce(p_assignments, '{}'::jsonb);
  v_mode text := coalesce(nullif(p_exam->>'assignment_mode', ''), 'entire_course');
  v_ids uuid[];
  v_exam_id uuid;
  v_questions jsonb;
  v_member_questions jsonb;
  v_status text := coalesce(p_exam->>'status', 'Published');
  v_result jsonb := '[]'::jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.profiles where id = v_uid and role = 'Professor' and status = 'Active'
  ) then
    raise exception 'Professor access required.';
  end if;
  if nullif(btrim(p_request_key), '') is null or length(p_request_key) > 200 then
    raise exception 'A request key of at most 200 characters is required.';
  end if;
  if jsonb_typeof(p_questions) is distinct from 'array'
     or jsonb_typeof(v_assignments) is distinct from 'object' then
    raise exception 'Invalid questionnaire or assignment payload.';
  end if;
  if v_mode not in ('entire_course', 'selected_students') then
    raise exception 'Unsupported assignment mode.';
  end if;
  if v_status not in ('Published', 'Pending Review') then
    raise exception 'Unsupported group publish status.';
  end if;
  if cardinality(p_course_ids) is null or cardinality(p_course_ids) = 0
     or array_position(p_course_ids, null) is not null
     or cardinality(p_course_ids) <> (select count(distinct x) from unnest(p_course_ids) x) then
    raise exception 'Select distinct destination courses.';
  end if;

  select array_agg(course_id order by course_id) into v_courses
  from unnest(p_course_ids) as selected(course_id);

  if (select count(*) from public.courses c
      where c.id = any(v_courses) and c.professor_id = v_uid and not c.archived)
     <> cardinality(v_courses) then
    raise exception 'Select only assigned active courses.';
  end if;
  if v_mode = 'entire_course' and v_assignments <> '{}'::jsonb then
    raise exception 'Entire Course must not include selected-student assignments.';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_assignments) as selected(course_key)
    where not selected.course_key = any(select unnest(v_courses)::text)
  ) then
    raise exception 'Assignments include a course outside this group.';
  end if;

  -- JSONB canonicalizes object keys; arrays are normalized explicitly.
  select jsonb_agg(q.value - 'id' order by q.ordinality)
  into v_questions
  from jsonb_array_elements(p_questions) with ordinality as q(value, ordinality);
  v_questions := coalesce(v_questions, '[]'::jsonb);
  v_payload := jsonb_build_object(
    'source_exam_id', p_source_exam_id,
    'exam', (p_exam - 'course_id' - 'course' - 'exam_settings'
      - 'submitted_at' - 'approved_at' - 'rejected_at'
      - 'professor_id' - 'created_by') ||
      jsonb_build_object('exam_settings', coalesce(p_exam->'exam_settings', '{}'::jsonb) - 'draftSnapshot'),
    'questions', v_questions,
    'course_ids', to_jsonb(v_courses),
    'assignments', (
      select coalesce(jsonb_object_agg(course_id::text, student_ids), '{}'::jsonb)
      from (
        select course_id, (
          select coalesce(jsonb_agg(student_id order by student_id), '[]'::jsonb)
          from (
            select distinct value::uuid as student_id
            from jsonb_array_elements_text(coalesce(v_assignments->course_id::text, '[]'::jsonb))
          ) ids
        ) student_ids
        from unnest(v_courses) as courses(course_id)
      ) canonical
    )
  );

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_request_key, 0));
  select * into v_group from public.exam_publish_groups
  where created_by = v_uid and request_key = p_request_key for update;
  if found then
    if v_group.request_payload <> v_payload then
      raise exception 'Idempotency key conflicts with a different publish request.' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'group_id', v_group.id, 'revision', v_group.revision,
      'members', (select jsonb_agg(jsonb_build_object('exam_id', m.exam_id, 'course_id', m.course_id) order by m.course_id)
                  from public.exam_publish_group_members m where m.group_id = v_group.id)
    );
  end if;

  if p_source_exam_id is not null then
    perform 1 from public.exams e
    where e.id = p_source_exam_id and e.professor_id = v_uid
      and e.status = 'Draft' and e.course_id = any(v_courses)
      and not exists (select 1 from public.exam_publish_group_members m where m.exam_id = e.id)
    for update;
    if not found then
      raise exception 'Source exam must be an ungrouped owned draft in a selected course.';
    end if;
  end if;

  insert into public.exam_publish_groups(created_by, request_key, request_payload, request_digest)
  values (v_uid, p_request_key, v_payload, md5(v_payload::text))
  returning * into v_group;

  foreach v_course in array v_courses loop
    if v_mode = 'selected_students' then
      if jsonb_typeof(v_assignments->v_course::text) is distinct from 'array' then
        raise exception 'Every destination course needs a selected-student list.';
      end if;
      select coalesce(array_agg(distinct value::uuid order by value::uuid), '{}'::uuid[])
      into v_ids
      from jsonb_array_elements_text(v_assignments->v_course::text);
      if cardinality(v_ids) = 0 then
        raise exception 'Select at least one student in every destination course.';
      end if;
    else
      v_ids := '{}'::uuid[];
    end if;

    select jsonb_agg(q.value || jsonb_build_object('id', gen_random_uuid()) order by q.ordinality)
    into v_member_questions
    from jsonb_array_elements(v_questions) with ordinality as q(value, ordinality);
    -- save_exam enforces the established title, question and schedule rules.
    v_exam_id := public.save_exam(
      case when p_source_exam_id is not null and
        (select e.course_id from public.exams e where e.id = p_source_exam_id) = v_course
        then p_source_exam_id else null end,
      (p_exam - 'assignment_mode') || jsonb_build_object(
        'course_id', v_course,
        'course', (select c.course_code || ' - ' || c.section from public.courses c where c.id = v_course),
        'status',
        case when v_status = 'Published' then 'Unpublished' else v_status end,
        'exam_settings', coalesce(p_exam->'exam_settings', '{}'::jsonb) - 'draftSnapshot'
      ), v_member_questions
    );
    update public.exams set assignment_mode = v_mode where id = v_exam_id;
    if v_mode = 'selected_students' then
      perform public.save_exam_assignments(v_exam_id, v_mode, v_ids);
    end if;
    update public.exam_questions q set sort_order = ordered.position
    from (
      select (value->>'id')::uuid as id, ordinality::integer as position
      from jsonb_array_elements(v_member_questions) with ordinality
    ) ordered
    where q.id = ordered.id and q.exam_id = v_exam_id;
    if v_status = 'Published' then
      perform public.publish_exam(v_exam_id);
    end if;
    insert into public.exam_publish_group_members(group_id, exam_id, course_id)
    values (v_group.id, v_exam_id, v_course);
    v_result := v_result || jsonb_build_array(jsonb_build_object('exam_id', v_exam_id, 'course_id', v_course));
  end loop;
  return jsonb_build_object('group_id', v_group.id, 'revision', v_group.revision, 'members', v_result);
end;
$$;

revoke all on function public.publish_exam_group(uuid,jsonb,jsonb,uuid[],jsonb,text) from public, anon;
grant execute on function public.publish_exam_group(uuid,jsonb,jsonb,uuid[],jsonb,text) to authenticated;

create or replace function public.exam_group_shared_content(p_exam_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'title', e.title, 'exam_title', e.exam_title,
    'description', e.description, 'semester', e.semester,
    'exam_type', e.exam_type, 'duration', e.duration,
    'time_limit', e.time_limit, 'passing_score', e.passing_score,
    'questions_count', e.questions_count,
    'exam_settings', coalesce(e.exam_settings, '{}'::jsonb) - 'archived' - 'draftSnapshot',
    'questions', coalesce((
      select jsonb_agg(to_jsonb(q) - 'id' - 'exam_id' - 'sort_order'
                       order by q.sort_order nulls last, q.id)
      from public.exam_questions q where q.exam_id = e.id
    ), '[]'::jsonb)
  )
  from public.exams e where e.id = p_exam_id
$$;
revoke all on function public.exam_group_shared_content(uuid) from public, anon, authenticated;

-- Ordinary exam RPCs and direct writes may not change just one grouped member.
create or replace function public.guard_group_member_write()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_exam_id uuid;
  v_group_id uuid;
begin
  if TG_TABLE_NAME = 'exams' then
    v_exam_id := old.id;
  elsif TG_OP = 'INSERT' then
    v_exam_id := new.exam_id;
  else
    v_exam_id := old.exam_id;
  end if;
  select m.group_id into v_group_id from public.exam_publish_group_members m
  where m.exam_id = v_exam_id;
  if v_group_id is not null and TG_TABLE_NAME = 'exams' and TG_OP = 'UPDATE'
     and to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then
    return new;
  end if;
  if v_group_id is not null and not exists (
    select 1 from exam_private.group_write_context c
    where c.transaction_id = txid_current()
      and c.backend_pid = pg_backend_pid()
      and c.group_id = v_group_id
  ) then
    raise exception 'Use a group action to change a shared exam.';
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger guard_group_exam_write before update or delete on public.exams
for each row execute function public.guard_group_member_write();
create trigger guard_group_question_write before insert or update or delete on public.exam_questions
for each row execute function public.guard_group_member_write();

create or replace function public.get_exam_group(p_exam_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_group public.exam_publish_groups;
begin
  select g.* into v_group from public.exam_publish_groups g
  join public.exam_publish_group_members m on m.group_id = g.id
  where m.exam_id = p_exam_id;
  if not found then return null; end if;
  if v_group.created_by <> auth.uid() and not exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'Cluster Professor' and p.status = 'Active'
  ) then
    raise exception 'Group access denied.';
  end if;
  return jsonb_build_object(
    'group_id', v_group.id, 'revision', v_group.revision,
    'members', (
      select jsonb_agg(jsonb_build_object(
        'exam_id', m.exam_id, 'course_id', m.course_id,
        'course_name', c.course_name, 'section', c.section,
        'status', e.status, 'archived', coalesce((e.exam_settings->>'archived')::boolean, false),
        'student_ids', coalesce((
          select jsonb_agg(a.student_id order by a.student_id)
          from public.exam_student_assignments a where a.exam_id = m.exam_id
        ), '[]'::jsonb)
      ) order by m.course_id)
      from public.exam_publish_group_members m
      join public.exams e on e.id = m.exam_id
      join public.courses c on c.id = m.course_id
      where m.group_id = v_group.id
    )
  );
end;
$$;
revoke all on function public.get_exam_group(uuid) from public, anon;
grant execute on function public.get_exam_group(uuid) to authenticated;

create or replace function public.save_exam_group(
  p_group_id uuid, p_exam jsonb, p_questions jsonb,
  p_assignments jsonb, p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_group public.exam_publish_groups;
  v_member record;
  v_first jsonb;
  v_current jsonb;
  v_status text;
  v_mode text;
  v_ids uuid[];
  v_questions jsonb;
  v_member_questions jsonb;
  v_count integer := 0;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'Professor' and p.status = 'Active') then
    raise exception 'Active Professor access required.';
  end if;
  select * into v_group from public.exam_publish_groups
  where id = p_group_id and created_by = auth.uid() for update;
  if not found then raise exception 'Group access denied.'; end if;
  if v_group.revision <> p_expected_revision then
    raise exception 'Shared exam changed since it was opened.' using errcode = '40001';
  end if;
  if jsonb_typeof(p_questions) is distinct from 'array'
     or jsonb_typeof(coalesce(p_assignments, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'Invalid questionnaire or assignment payload.';
  end if;
  select jsonb_agg(q.value - 'id' order by q.ordinality) into v_questions
  from jsonb_array_elements(p_questions) with ordinality as q(value, ordinality);
  v_questions := coalesce(v_questions, '[]'::jsonb);

  -- Lock every member and reject any divergence before the first write.
  for v_member in
    select e.*, m.course_id as member_course_id
    from public.exam_publish_group_members m
    join public.exams e on e.id = m.exam_id
    where m.group_id = p_group_id order by e.id for update of e
  loop
    v_count := v_count + 1;
    if v_member.professor_id <> auth.uid() or v_member.course_id <> v_member.member_course_id then
      raise exception 'Group member ownership or course diverged.';
    end if;
    if coalesce((v_member.exam_settings->>'archived')::boolean, false) then
      raise exception 'Restore all archived group members before editing.';
    end if;
    if v_member.status not in ('Unpublished', 'Draft', 'Rejected', 'Revision Needed') then
      raise exception 'Unpublish or complete review before editing the shared exam.';
    end if;
    v_current := public.exam_group_shared_content(v_member.id);
    if v_first is null then
      v_first := v_current;
      v_status := v_member.status;
      v_mode := v_member.assignment_mode;
    elsif v_current <> v_first or v_member.status <> v_status
       or v_member.assignment_mode <> v_mode then
      raise exception 'Group members diverged; no changes were applied.';
    end if;
    if exists (select 1 from public.exam_attempts where exam_id = v_member.id)
       or exists (select 1 from public.exam_start_sessions where exam_id = v_member.id) then
      raise exception 'A group member has student starts or attempts; questionnaire edits are blocked.';
    end if;
  end loop;
  if v_count = 0 then raise exception 'Group has no members.'; end if;
  if coalesce(p_exam->>'assignment_mode', v_mode) <> v_mode then
    raise exception 'Group assignment mode cannot change during shared editing.';
  end if;
  if exists (
    select 1 from jsonb_object_keys(coalesce(p_assignments, '{}'::jsonb)) as selected(course_key)
    where not exists (select 1 from public.exam_publish_group_members m
                      where m.group_id = p_group_id and m.course_id::text = selected.course_key)
  ) then raise exception 'Assignments include a course outside this group.'; end if;

  insert into exam_private.group_write_context(transaction_id, backend_pid, group_id)
  values (txid_current(), pg_backend_pid(), p_group_id);
  for v_member in
    select e.*, m.course_id as member_course_id
    from public.exam_publish_group_members m join public.exams e on e.id = m.exam_id
    where m.group_id = p_group_id order by e.id
  loop
    select jsonb_agg(q.value || jsonb_build_object('id', gen_random_uuid()) order by q.ordinality)
    into v_member_questions
    from jsonb_array_elements(v_questions) with ordinality as q(value, ordinality);
    perform public.save_exam(v_member.id,
      (p_exam - 'assignment_mode') || jsonb_build_object(
        'course_id', v_member.course_id,
        'course', (select c.course_code || ' - ' || c.section from public.courses c where c.id = v_member.course_id),
        'status', 'Unpublished',
        'exam_settings', coalesce(p_exam->'exam_settings', '{}'::jsonb) - 'draftSnapshot'
      ), v_member_questions);
    update public.exam_questions q set sort_order = ordered.position
    from (select (value->>'id')::uuid as id, ordinality::integer as position
          from jsonb_array_elements(v_member_questions) with ordinality) ordered
    where q.id = ordered.id and q.exam_id = v_member.id;
    update public.exams set approved_at = null, rejected_at = null where id = v_member.id;
    if v_mode = 'selected_students' then
      if jsonb_typeof(p_assignments->v_member.course_id::text) is distinct from 'array' then
        raise exception 'Every destination course needs a selected-student list.';
      end if;
      select coalesce(array_agg(distinct value::uuid order by value::uuid), '{}'::uuid[])
      into v_ids from jsonb_array_elements_text(p_assignments->v_member.course_id::text);
      if cardinality(v_ids) = 0 then
        raise exception 'Select at least one student in every destination course.';
      end if;
      perform public.save_exam_assignments(v_member.id, v_mode, v_ids);
    elsif coalesce(p_assignments, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'Entire Course must not include selected-student assignments.';
    end if;
  end loop;
  delete from exam_private.group_write_context
  where transaction_id = txid_current() and backend_pid = pg_backend_pid() and group_id = p_group_id;
  update public.exam_publish_groups set revision = revision + 1, updated_at = now()
  where id = p_group_id returning * into v_group;
  if p_exam->>'status' in ('Published', 'Pending Review') then
    return public.transition_exam_group(
      p_group_id,
      case when p_exam->>'status' = 'Published' then 'publish' else 'submit_review' end,
      v_group.revision
    );
  end if;
  return public.get_exam_group((select m.exam_id from public.exam_publish_group_members m
    where m.group_id = p_group_id order by m.course_id limit 1));
end;
$$;
revoke all on function public.save_exam_group(uuid,jsonb,jsonb,jsonb,bigint) from public, anon;
grant execute on function public.save_exam_group(uuid,jsonb,jsonb,jsonb,bigint) to authenticated;

create or replace function public.transition_exam_group(
  p_group_id uuid, p_action text, p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_group public.exam_publish_groups;
  v_member record;
  v_status text;
  v_archived boolean;
  v_first jsonb;
  v_count integer := 0;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'Professor' and p.status = 'Active') then
    raise exception 'Active Professor access required.';
  end if;
  select * into v_group from public.exam_publish_groups
  where id = p_group_id and created_by = auth.uid() for update;
  if not found then raise exception 'Group access denied.'; end if;
  if v_group.revision <> p_expected_revision then
    raise exception 'Shared exam changed since it was opened.' using errcode = '40001';
  end if;
  for v_member in
    select e.*, m.course_id as member_course_id from public.exam_publish_group_members m
    join public.exams e on e.id = m.exam_id
    where m.group_id = p_group_id order by e.id for update of e
  loop
    v_count := v_count + 1;
    if v_member.professor_id <> auth.uid() or v_member.course_id <> v_member.member_course_id then
      raise exception 'Group member ownership or course diverged.';
    end if;
    if p_action in ('publish', 'submit_review') and not exists (
      select 1 from public.courses c where c.id = v_member.course_id
        and c.professor_id = auth.uid() and not c.archived
    ) then
      raise exception 'Every destination course must remain active and assigned.';
    end if;
    if v_first is null then
      v_first := public.exam_group_shared_content(v_member.id);
      v_status := v_member.status;
      v_archived := coalesce((v_member.exam_settings->>'archived')::boolean, false);
    elsif public.exam_group_shared_content(v_member.id) <> v_first
       or v_member.status <> v_status
       or coalesce((v_member.exam_settings->>'archived')::boolean, false) <> v_archived then
      raise exception 'Group members diverged; no changes were applied.';
    end if;
  end loop;
  if v_count = 0 then raise exception 'Group has no members.'; end if;
  if (p_action = 'publish' and (v_archived or v_status <> 'Unpublished'))
     or (p_action = 'unpublish' and v_status <> 'Published')
     or (p_action = 'submit_review' and (v_archived or v_status <> 'Unpublished'))
     or (p_action = 'move_to_unpublished' and v_status <> 'Draft')
     or (p_action = 'archive' and v_archived)
     or (p_action = 'restore' and not v_archived)
     or p_action not in ('publish','unpublish','submit_review','move_to_unpublished','archive','restore') then
    raise exception 'Invalid group lifecycle transition.';
  end if;
  insert into exam_private.group_write_context(transaction_id, backend_pid, group_id)
  values (txid_current(), pg_backend_pid(), p_group_id);
  for v_member in
    select e.*, m.course_id as member_course_id from public.exam_publish_group_members m
    join public.exams e on e.id = m.exam_id
    where m.group_id = p_group_id order by e.id
  loop
    if p_action = 'publish' then
      if v_member.submitted_at is not null and v_member.approved_at is null then
        raise exception 'Cluster review approval is required before publishing.';
      end if;
      perform public.publish_exam(v_member.id);
    elsif p_action = 'unpublish' then
      update public.exams set status = 'Unpublished' where id = v_member.id;
    elsif p_action = 'submit_review' then
      update public.exams set status = 'Pending Review', submitted_at = now(),
        approved_at = null, rejected_at = null where id = v_member.id;
    elsif p_action = 'move_to_unpublished' then
      update public.exams set status = 'Unpublished' where id = v_member.id;
    elsif p_action in ('archive','restore') then
      perform public.set_exam_archived(v_member.id, p_action = 'archive');
    end if;
  end loop;
  delete from exam_private.group_write_context
  where transaction_id = txid_current() and backend_pid = pg_backend_pid() and group_id = p_group_id;
  update public.exam_publish_groups set revision = revision + 1, updated_at = now()
  where id = p_group_id;
  return public.get_exam_group((select m.exam_id from public.exam_publish_group_members m
    where m.group_id = p_group_id order by m.course_id limit 1));
end;
$$;
revoke all on function public.transition_exam_group(uuid,text,bigint) from public, anon;
grant execute on function public.transition_exam_group(uuid,text,bigint) to authenticated;

create or replace function public.review_exam_group(
  p_exam_id uuid, p_action text, p_remarks text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_group public.exam_publish_groups;
  v_member record;
  v_content jsonb;
  v_first jsonb;
  v_count integer := 0;
  v_decision text;
  v_remarks text := btrim(coalesce(p_remarks, ''));
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'Cluster Professor' and p.status = 'Active') then
    raise exception 'Only active Cluster Professors may review exams.';
  end if;
  if p_action not in ('approve', 'reject') or (p_action = 'reject' and v_remarks = '') then
    raise exception 'Invalid group review decision or missing rejection reason.';
  end if;
  select g.* into v_group from public.exam_publish_groups g
  join public.exam_publish_group_members m on m.group_id = g.id
  where m.exam_id = p_exam_id for update of g;
  if not found then raise exception 'Shared group not found.'; end if;
  for v_member in
    select e.*, m.course_id as member_course_id from public.exam_publish_group_members m
    join public.exams e on e.id = m.exam_id
    where m.group_id = v_group.id order by e.id for update of e
  loop
    v_count := v_count + 1;
    if v_member.professor_id <> v_group.created_by
       or v_member.course_id <> v_member.member_course_id then
      raise exception 'Group member ownership or course diverged.';
    end if;
    if v_member.status <> 'Pending Review'
       or coalesce((v_member.exam_settings->>'archived')::boolean, false) then
      raise exception 'Every group member must be pending review and unarchived.';
    end if;
    v_content := public.exam_group_shared_content(v_member.id);
    if v_first is null then v_first := v_content;
    elsif v_content <> v_first then
      raise exception 'Group members diverged; review was not applied.';
    end if;
  end loop;
  if v_count = 0 then raise exception 'Group has no members.'; end if;
  v_decision := case when p_action = 'approve' then 'Approved' else 'Rejected' end;
  insert into exam_private.group_write_context(transaction_id, backend_pid, group_id)
  values (txid_current(), pg_backend_pid(), v_group.id);
  for v_member in
    select e.* from public.exam_publish_group_members m
    join public.exams e on e.id = m.exam_id
    where m.group_id = v_group.id order by e.id
  loop
    update public.exams set
      status = case when p_action = 'approve' then 'Unpublished' else 'Rejected' end,
      approved_at = case when p_action = 'approve' then now() else null end,
      rejected_at = case when p_action = 'reject' then now() else null end
    where id = v_member.id;
    insert into public.exam_reviews(exam_id, cluster_professor_id, decision, remarks)
    values (v_member.id, auth.uid(), v_decision,
      coalesce(nullif(v_remarks, ''), 'Approved for publishing.'));
    insert into public.notifications(
      user_id, title, message, type, is_read, entity_type, entity_id, action_path
    ) values (
      v_group.created_by,
      case when p_action = 'approve' then 'Exam approved' else 'Exam rejected' end,
      coalesce(v_member.exam_title, v_member.title, 'Exam') || ' was ' || lower(v_decision) || '.',
      'Exam Review', false, 'exam', v_member.id, '/professor/exams'
    );
    perform public.write_audit_log(
      auth.uid(), 'Cluster Professor',
      case when p_action = 'approve' then 'exam.approved' else 'exam.rejected' end,
      case when p_action = 'approve' then 'Exam Approved' else 'Exam Rejected' end,
      'A Cluster Professor reviewed a shared exam member.',
      'exam', v_member.id, v_group.created_by,
      jsonb_build_object('group_id', v_group.id)
    );
  end loop;
  delete from exam_private.group_write_context
  where transaction_id = txid_current() and backend_pid = pg_backend_pid() and group_id = v_group.id;
  update public.exam_publish_groups set revision = revision + 1, updated_at = now()
  where id = v_group.id;
  return public.get_exam_group(p_exam_id);
end;
$$;
revoke all on function public.review_exam_group(uuid,text,text) from public, anon;
grant execute on function public.review_exam_group(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
