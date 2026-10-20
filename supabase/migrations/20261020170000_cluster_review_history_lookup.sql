-- Cluster Professors keep their own review history after an exam leaves review
-- (approval moves it to Unpublished, publishing to Published), without widening
-- exams_cluster_review_read. Returns history metadata only.
begin;

create or replace function public.get_cluster_review_history()
returns table (
  review_id uuid,
  exam_id uuid,
  group_id uuid,
  shared_course_count integer,
  exam_title text,
  course_label text,
  professor_name text,
  decision text,
  remarks text,
  review_date timestamptz,
  exam_status text,
  approved_at timestamptz,
  currently_approved boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'Cluster Professor' and p.status = 'Active'
  ) then
    raise exception 'Only active Cluster Professors may view review history.' using errcode = '42501';
  end if;

  return query
  select
    r.id,
    r.exam_id,
    m.group_id,
    case when m.group_id is null then 1
      else (select count(*)::integer from public.exam_publish_group_members gm where gm.group_id = m.group_id) end,
    coalesce(nullif(btrim(e.exam_title), ''), nullif(btrim(e.title), ''), 'Untitled exam'),
    coalesce(nullif(concat_ws(' - ', c.course_code, c.section), ''), c.course_name, e.course, 'Course'),
    coalesce(prof.full_name, prof.email, 'Professor'),
    r.decision,
    coalesce(r.remarks, ''),
    r.review_date,
    e.status::text,
    e.approved_at,
    -- Current only while this approval is the exam's latest decision and the approval still stands.
    (r.decision = 'Approved'
      and e.approved_at is not null
      and e.status in ('Unpublished', 'Published', 'Active')
      and r.id = (
        select r2.id from public.exam_reviews r2
        where r2.exam_id = r.exam_id and r2.decision in ('Approved', 'Rejected')
        order by r2.review_date desc, r2.id desc
        limit 1
      ))
  from public.exam_reviews r
  join public.exams e on e.id = r.exam_id
  left join public.courses c on c.id = e.course_id
  left join public.profiles prof on prof.id = coalesce(e.professor_id, e.created_by)
  left join public.exam_publish_group_members m on m.exam_id = r.exam_id
  where r.cluster_professor_id = auth.uid()
  order by r.review_date desc, r.id desc;
end;
$$;

revoke all on function public.get_cluster_review_history() from public, anon;
grant execute on function public.get_cluster_review_history() to authenticated;

notify pgrst, 'reload schema';
commit;
