-- Fix hosted databases where the shared exam guard trigger was attached to
-- exam_questions while still reading OLD.status as if every row came from exams.
begin;

create or replace function public.guard_exam_changes()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  eid uuid;
  e public.exams;
begin
  if TG_TABLE_NAME = 'exams' and TG_OP = 'INSERT' then
    eid := new.id;
  elsif TG_TABLE_NAME = 'exams' and TG_OP = 'UPDATE' then
    eid := new.id;
  elsif TG_TABLE_NAME = 'exams' then
    eid := old.id;
  elsif TG_OP = 'INSERT' then
    eid := new.exam_id;
  elsif TG_OP = 'UPDATE' then
    eid := coalesce(new.exam_id, old.exam_id);
  else
    eid := old.exam_id;
  end if;

  select * into e from public.exams where id = eid for update;

  if TG_TABLE_NAME = 'exams' and TG_OP = 'UPDATE' then
    -- Lifecycle/archive transitions remain available; content is immutable after a start.
    if (to_jsonb(new) - array['status','approved_at','rejected_at','submitted_at','exam_settings'])
       = (to_jsonb(old) - array['status','approved_at','rejected_at','submitted_at','exam_settings'])
       and (new.exam_settings - 'archived') = (old.exam_settings - 'archived') then
      return new;
    end if;
  end if;

  if exists(select 1 from public.exam_attempts where exam_id = eid)
     or exists(select 1 from public.exam_start_sessions where exam_id = eid) then
    raise exception 'This exam has student starts or attempts. Create a new exam to change its content.';
  end if;

  if TG_TABLE_NAME = 'exam_questions'
     and lower(e.status) not in ('draft','rejected','revision needed','unpublished','pending review') then
    raise exception 'Unpublish and resubmit for review before changing questions.';
  end if;

  if TG_TABLE_NAME = 'exams' and TG_OP = 'UPDATE' then
    if lower(old.status) in ('approved','published','active') then
      new.status := 'Draft';
      new.approved_at := null;
      new.rejected_at := null;
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;

  return new;
end $$;

notify pgrst, 'reload schema';
commit;
