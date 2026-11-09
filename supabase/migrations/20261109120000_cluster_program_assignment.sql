-- Each Cluster Professor is assigned one program (BSIT, BSCS, ...). They see and review only exams whose
-- course is in that program. A shared exam whose courses span several programs can be reviewed by a Cluster
-- Professor of any of those programs. A Cluster Professor without a program sees no exams for review.
-- Professors' review requests (notifications) go only to the Cluster Professors of the exam's program(s).
begin;

alter table public.cluster_professors
  add column if not exists program_id uuid references public.programs(id) on delete set null;
create index if not exists cluster_professors_program_idx on public.cluster_professors(program_id);

-- The programs an exam belongs to: its course's program, plus the programs of every course in its shared group.
create or replace function public.exam_program_ids(p_exam_id uuid)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select c.program_id
  from public.exams e
  join public.courses c on c.id = e.course_id
  where e.id = p_exam_id and c.program_id is not null
  union
  select c.program_id
  from public.exam_publish_group_members m
  join public.exam_publish_group_members m2 on m2.group_id = m.group_id
  join public.courses c on c.id = m2.course_id
  where m.exam_id = p_exam_id and c.program_id is not null
$$;

-- The calling Cluster Professor's assigned program, or null (not a cluster, inactive, or unassigned).
create or replace function public.current_cluster_program_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select cp.program_id
  from public.cluster_professors cp
  join public.profiles p on p.id = cp.id
  where cp.id = auth.uid() and p.role = 'Cluster Professor' and p.status = 'Active'
$$;

create or replace function public.cluster_can_review_exam(p_exam_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.exam_program_ids(p_exam_id) as program_id
    where program_id = public.current_cluster_program_id()
  )
$$;

create or replace function public.cluster_can_review_group(p_group_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.exam_publish_group_members m
    where m.group_id = p_group_id and public.cluster_can_review_exam(m.exam_id)
  )
$$;

-- Courses in the cluster's program, and the other courses of shared exams that include one of them.
create or replace function public.cluster_can_see_course(p_course_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.program_id = public.current_cluster_program_id()
  ) or exists (
    select 1
    from public.exam_publish_group_members m
    join public.exam_publish_group_members m2 on m2.group_id = m.group_id
    join public.courses c on c.id = m2.course_id
    where m.course_id = p_course_id and c.program_id = public.current_cluster_program_id()
  )
$$;

revoke all on function public.exam_program_ids(uuid) from public, anon;
revoke all on function public.current_cluster_program_id() from public, anon;
revoke all on function public.cluster_can_review_exam(uuid) from public, anon;
revoke all on function public.cluster_can_review_group(uuid) from public, anon;
revoke all on function public.cluster_can_see_course(uuid) from public, anon;
grant execute on function public.exam_program_ids(uuid) to authenticated;
grant execute on function public.current_cluster_program_id() to authenticated;
grant execute on function public.cluster_can_review_exam(uuid) to authenticated;
grant execute on function public.cluster_can_review_group(uuid) to authenticated;
grant execute on function public.cluster_can_see_course(uuid) to authenticated;

-- Cluster Professors read only their program's exams, courses, questions and review logs.
drop policy if exists "exams_cluster_review_read" on public.exams;
create policy "exams_cluster_review_read" on public.exams
for select using (
  public.current_profile_role() = 'Cluster Professor'
  and lower(status) in ('pending review', 'approved', 'rejected')
  and public.cluster_can_review_exam(id)
);

drop policy if exists "courses_cluster_read" on public.courses;
create policy "courses_cluster_read" on public.courses
for select using (
  public.current_profile_role() = 'Cluster Professor'
  and public.cluster_can_see_course(id)
);

drop policy if exists "exam_questions_audit_read" on public.exam_questions;
create policy "exam_questions_audit_read" on public.exam_questions
for select to authenticated
using (
  public.is_audit_role()
  or (public.current_profile_role() = 'Cluster Professor' and public.cluster_can_review_exam(exam_id))
);

drop policy if exists "exam_approval_logs_reviewer_read" on public.exam_approval_logs;
create policy "exam_approval_logs_reviewer_read" on public.exam_approval_logs
for select using (
  public.is_audit_role()
  or (public.current_profile_role() = 'Cluster Professor' and public.cluster_can_review_exam(exam_id))
  or exists (
    select 1 from public.exams e
    where e.id = exam_approval_logs.exam_id and (e.professor_id = auth.uid() or e.created_by = auth.uid())
  )
);

drop policy if exists "exam_rejection_logs_reviewer_read" on public.exam_rejection_logs;
create policy "exam_rejection_logs_reviewer_read" on public.exam_rejection_logs
for select using (
  public.is_audit_role()
  or (public.current_profile_role() = 'Cluster Professor' and public.cluster_can_review_exam(exam_id))
  or exists (
    select 1 from public.exams e
    where e.id = exam_rejection_logs.exam_id and (e.professor_id = auth.uid() or e.created_by = auth.uid())
  )
);

-- A cluster can still read its own past reviews, but can only record a review for its program's exams.
drop policy if exists "exam_reviews_cluster_manage" on public.exam_reviews;
create policy "exam_reviews_cluster_manage" on public.exam_reviews
for all to authenticated
using (auth.uid() = cluster_professor_id)
with check (auth.uid() = cluster_professor_id and public.cluster_can_review_exam(exam_id));

-- review_exam_group runs as the database owner, so it skips the policy above; this trigger covers it.
-- Reviews written by the service role (the review-exam function) have no auth.uid(); that function checks itself.
create or replace function public.guard_cluster_review_program()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and new.cluster_professor_id = auth.uid() and not public.cluster_can_review_exam(new.exam_id) then
    raise exception 'This exam is not in your assigned program.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_cluster_review_program() from public, anon, authenticated;
drop trigger if exists guard_cluster_review_program on public.exam_reviews;
create trigger guard_cluster_review_program
before insert on public.exam_reviews
for each row execute function public.guard_cluster_review_program();

drop policy if exists exam_publish_groups_owner_read on public.exam_publish_groups;
create policy exam_publish_groups_owner_read on public.exam_publish_groups
for select to authenticated using (
  created_by = (select auth.uid())
  or (public.current_profile_role() = 'Cluster Professor' and public.cluster_can_review_group(id))
);

drop policy if exists exam_publish_group_members_owner_read on public.exam_publish_group_members;
create policy exam_publish_group_members_owner_read on public.exam_publish_group_members
for select to authenticated using (
  exists (select 1 from public.exam_publish_groups g where g.id = group_id and g.created_by = (select auth.uid()))
  or (public.current_profile_role() = 'Cluster Professor' and public.cluster_can_review_group(group_id))
);

-- Admins and Deans see each Cluster Professor's program; the Admin changes it through the create-account function.
drop policy if exists "cluster_professors_audit_read" on public.cluster_professors;
create policy "cluster_professors_audit_read" on public.cluster_professors
for select to authenticated using (public.is_audit_role());

-- Who a professor's exam goes to for review: the programs of the given exam and/or courses, and the active
-- Cluster Professors assigned to those programs. Only the exam owner or the courses' professor may ask.
create or replace function public.get_review_targets(p_exam_id uuid default null, p_course_ids uuid[] default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  program_list uuid[];
begin
  if p_exam_id is not null and not exists (
    select 1 from public.exams e where e.id = p_exam_id and (e.professor_id = auth.uid() or e.created_by = auth.uid())
  ) then
    raise exception 'Exam access denied.';
  end if;
  if coalesce(cardinality(p_course_ids), 0) > 0 and exists (
    select 1 from unnest(p_course_ids) as requested(course_id)
    where not exists (select 1 from public.courses c where c.id = requested.course_id and c.professor_id = auth.uid())
  ) then
    raise exception 'Course access denied.';
  end if;

  select array_agg(distinct program_id) into program_list
  from (
    select public.exam_program_ids(p_exam_id) as program_id where p_exam_id is not null
    union
    select c.program_id from public.courses c where c.id = any(coalesce(p_course_ids, '{}')) and c.program_id is not null
  ) as found;

  return jsonb_build_object(
    'programs', coalesce((
      select jsonb_agg(pr.program_code order by pr.program_code) from public.programs pr where pr.id = any(coalesce(program_list, '{}'))
    ), '[]'::jsonb),
    'clusters', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name) order by p.full_name)
      from public.profiles p
      join public.cluster_professors cp on cp.id = p.id
      where p.role = 'Cluster Professor' and p.status = 'Active' and cp.program_id = any(coalesce(program_list, '{}'))
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_review_targets(uuid, uuid[]) from public, anon;
grant execute on function public.get_review_targets(uuid, uuid[]) to authenticated;

-- Review request notifications may only go to a Cluster Professor assigned to one of the exam's programs.
create or replace function public.create_notification(p_workflow text, p_recipient_id uuid, p_title text, p_message text, p_type text, p_context_id uuid default null::uuid, p_entity_type text default null::text, p_entity_id uuid default null::uuid, p_action_path text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
       or not exists (
         select 1
         from public.profiles p
         join public.cluster_professors cp on cp.id = p.id
         where p.id = p_recipient_id
           and p.role = 'Cluster Professor'
           and p.status = 'Active'
           and cp.program_id in (select public.exam_program_ids(p_context_id))
       )
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
$function$;

notify pgrst, 'reload schema';
commit;
