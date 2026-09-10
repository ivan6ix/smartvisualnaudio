-- Apply after schema.sql. No RLS policies are removed or relaxed.
begin;
-- Starts currently exist only in browser recovery state; this records server-authorized starts.
create table if not exists public.exam_start_sessions (
 exam_id uuid not null references public.exams(id),
 student_id uuid not null references public.profiles(id),
 started_at timestamptz not null default now(),
 primary key (exam_id, student_id)
);
alter table public.exam_start_sessions enable row level security;
create policy exam_start_sessions_self on public.exam_start_sessions for select to authenticated using (student_id = auth.uid());

create or replace function public.authorize_exam_start(p_exam_id uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare e public.exams; started timestamptz;
begin
 select * into e from public.exams where id = p_exam_id for update;
 if e.id is null or not exists (select 1 from public.profiles where id=auth.uid() and role='Student' and status='Active') then raise exception 'Exam access denied.'; end if;
 if exists (select 1 from public.exam_attempts where exam_id=e.id and student_id=auth.uid()) then raise exception 'You have already taken this exam.'; end if;
 select started_at into started from public.exam_start_sessions where exam_id=e.id and student_id=auth.uid();
 if started is not null then return started; end if;
 if lower(e.status) not in ('published','active') or coalesce((e.exam_settings->>'archived')::boolean,false) or not exists (select 1 from public.course_enrollments ce join public.courses c on c.id=ce.course_id where ce.course_id=e.course_id and ce.student_id=auth.uid() and not c.archived) then raise exception 'Exam is not available for your account.'; end if;
 if nullif(e.exam_settings->>'startsAt','')::timestamptz > now() then raise exception 'This exam is scheduled and has not started.'; end if;
 if nullif(e.exam_settings->>'deadline','')::timestamptz <= now() then raise exception 'This exam has expired.'; end if;
 insert into public.exam_start_sessions(exam_id,student_id) values(e.id,auth.uid()) returning started_at into started;
 return started;
end $$;
revoke all on function public.authorize_exam_start(uuid) from public;
grant execute on function public.authorize_exam_start(uuid) to authenticated;

create or replace function public.guard_exam_changes() returns trigger language plpgsql security definer set search_path=public as $$
declare eid uuid; e public.exams;
begin
 if TG_TABLE_NAME='exams' then eid:=old.id; else eid:=coalesce(new.exam_id,old.exam_id); end if;
 select * into e from public.exams where id=eid for update;
 if TG_TABLE_NAME='exams' and TG_OP='UPDATE' then
  -- Lifecycle/approval transitions remain available; teaching content is immutable after a start.
  if (to_jsonb(new)-array['status','approved_at','rejected_at','submitted_at','exam_settings']) = (to_jsonb(old)-array['status','approved_at','rejected_at','submitted_at','exam_settings']) and (new.exam_settings-'archived')=(old.exam_settings-'archived') then return new; end if;
 end if;
 if exists(select 1 from public.exam_attempts where exam_id=eid) or exists(select 1 from public.exam_start_sessions where exam_id=eid) then raise exception 'This exam has student starts or attempts. Create a new exam to change its content.'; end if;
 if TG_TABLE_NAME='exam_questions' and lower(e.status) not in ('draft','rejected','revision needed','unpublished','pending review') then raise exception 'Unpublish and resubmit for review before changing questions.'; end if;
 if TG_TABLE_NAME='exams' and TG_OP='UPDATE' and lower(old.status) in ('approved','published','active') then new.status:='Draft'; new.approved_at:=null; new.rejected_at:=null; end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
create trigger guard_exam_content before update or delete on public.exams for each row execute function public.guard_exam_changes();
create trigger guard_exam_question_content before insert or update or delete on public.exam_questions for each row execute function public.guard_exam_changes();

create or replace function public.guard_scheduled_submission() returns trigger language plpgsql security definer set search_path=public as $$
declare e public.exams; started timestamptz;
begin
 select * into e from public.exams where id=new.exam_id for update;
 if nullif(e.exam_settings->>'startsAt','') is not null or nullif(e.exam_settings->>'deadline','') is not null then
  select started_at into started from public.exam_start_sessions where exam_id=new.exam_id and student_id=new.student_id;
  if started is null then raise exception 'Start this scheduled exam through the authorized exam flow.'; end if;
  new.started_at:=started;
 end if;
 return new;
end $$;
create trigger guard_scheduled_submission before insert on public.exam_attempts for each row execute function public.guard_scheduled_submission();

-- Atomic create/edit: failed question writes roll back the entire exam change.
create or replace function public.save_exam(p_id uuid, p_exam jsonb, p_questions jsonb) returns uuid
language plpgsql security invoker set search_path=public as $$
declare eid uuid; old_exam public.exams; q jsonb; starts timestamptz; ends timestamptz;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='Professor' and status='Active') then raise exception 'Professor access required.'; end if;
 if not exists(select 1 from public.courses where id=(p_exam->>'course_id')::uuid and professor_id=auth.uid() and not archived) then raise exception 'Select an assigned active course.'; end if;
 if length(trim(coalesce(p_exam->>'title','')))=0 or length(p_exam->>'title')>200 then raise exception 'Exam title is required and must be 200 characters or fewer.'; end if;
 if length(coalesce(p_exam->'exam_settings'->>'description',''))>1000 then raise exception 'Description must be 1000 characters or fewer.'; end if;
 if length(coalesce(p_exam->'exam_settings'->>'instructions',''))>5000 then raise exception 'Instructions must be 5000 characters or fewer.'; end if;
 if (p_exam->>'duration')::integer is not null and (p_exam->>'duration')::integer not between 1 and 1440 then raise exception 'Duration must be 1 to 1440 minutes.'; end if;
 if p_exam->>'status' not in ('Draft','Pending Review') then raise exception 'Save as draft or submit for review before publishing.'; end if;
 starts:=nullif(p_exam->'exam_settings'->>'startsAt','')::timestamptz;
 ends:=nullif(p_exam->'exam_settings'->>'deadline','')::timestamptz;
 if ends<=starts then raise exception 'Deadline must be after the start.'; end if;
 if jsonb_array_length(p_questions) not between 1 and 500 then raise exception 'Add between 1 and 500 questions.'; end if;
 for q in select value from jsonb_array_elements(p_questions) loop
  if length(trim(coalesce(q->>'question_text','')))=0 or length(q->>'question_text')>5000 or (q->>'points')::numeric not between 0.01 and 1000 then raise exception 'Each question requires text (up to 5000 characters) and points from 0.01 to 1000.'; end if;
 end loop;
 if p_id is not null then
  select * into old_exam from public.exams where id=p_id and (professor_id=auth.uid() or created_by=auth.uid()) for update;
  if old_exam.id is null then raise exception 'Exam access denied.'; end if;
  if lower(old_exam.status) not in ('draft','rejected','revision needed','unpublished') then raise exception 'Only drafts, rejected or unpublished exams can be edited.'; end if;
  update public.exams set title=p_exam->>'title',exam_title=p_exam->>'title',course_id=(p_exam->>'course_id')::uuid,description=p_exam->>'description',semester=p_exam->>'semester',exam_type=p_exam->>'exam_type',course=p_exam->>'course',exam_settings=p_exam->'exam_settings',duration=(p_exam->>'duration')::integer,time_limit=(p_exam->>'duration')::integer,questions_count=jsonb_array_length(p_questions),status=p_exam->>'status',approved_at=null,rejected_at=null,submitted_at=case when p_exam->>'status'='Pending Review' then now() else null end where id=p_id returning id into eid;
  delete from public.exam_questions where exam_id=eid;
 else
  insert into public.exams(course_id,title,exam_title,description,semester,exam_type,course,exam_settings,duration,time_limit,questions_count,status,created_by,professor_id,submitted_at)
  values((p_exam->>'course_id')::uuid,p_exam->>'title',p_exam->>'title',p_exam->>'description',p_exam->>'semester',p_exam->>'exam_type',p_exam->>'course',p_exam->'exam_settings',(p_exam->>'duration')::integer,(p_exam->>'duration')::integer,jsonb_array_length(p_questions),p_exam->>'status',auth.uid(),auth.uid(),case when p_exam->>'status'='Pending Review' then now() else null end) returning id into eid;
 end if;
 insert into public.exam_questions(exam_id,question_text,question_type,choices,correct_answer,correct_answers,question_config,manual_grading,points)
 select eid,x.question_text,x.question_type,x.choices,x.correct_answer,x.correct_answers,x.question_config,x.manual_grading,x.points from jsonb_to_recordset(p_questions) as x(question_text text,question_type text,choices jsonb,correct_answer text,correct_answers jsonb,question_config jsonb,manual_grading boolean,points numeric);
 return eid;
end $$;
revoke all on function public.save_exam(uuid,jsonb,jsonb) from public;
grant execute on function public.save_exam(uuid,jsonb,jsonb) to authenticated;
create or replace function public.set_exam_archived(p_id uuid,p_archived boolean) returns void language plpgsql security invoker set search_path=public as $
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='Professor') then raise exception 'Professor access required.'; end if;
 update public.exams set exam_settings=jsonb_set(exam_settings,'{archived}',to_jsonb(p_archived)) where id=p_id and (professor_id=auth.uid() or created_by=auth.uid());
 if not found then raise exception 'Exam access denied.'; end if;
end $;
revoke all on function public.set_exam_archived(uuid,boolean) from public;
grant execute on function public.set_exam_archived(uuid,boolean) to authenticated;
-- Validate new/changed content without rewriting existing long saved values.
create or replace function public.validate_content_lengths() returns trigger language plpgsql as $
declare limits jsonb; item record; value text;
begin
 limits:=case TG_TABLE_NAME
 when 'messages' then '{"message":4000}'::jsonb
 when 'courses' then '{"course_name":160,"course_code":32,"section":40}'::jsonb
 when 'course_modules' then '{"title":255,"description":1000}'::jsonb
 when 'student_resource_folders' then '{"name":160}'::jsonb
 when 'profiles' then '{"full_name":120,"student_number":40,"employee_number":40}'::jsonb
 when 'exam_questions' then '{"question_text":5000,"correct_answer":2000}'::jsonb
 else '{}'::jsonb end;
 for item in select * from jsonb_each_text(limits) loop
  if TG_OP='INSERT' or to_jsonb(new)->item.key is distinct from to_jsonb(old)->item.key then
   value:=to_jsonb(new)->>item.key;
   if length(value)>item.value::integer then raise exception '% must be % characters or fewer.',item.key,item.value; end if;
  end if;
 end loop;
 return new;
end $;
create trigger validate_message_length before insert or update on public.messages for each row execute function public.validate_content_lengths();
create trigger validate_course_lengths before insert or update on public.courses for each row execute function public.validate_content_lengths();
create trigger validate_module_lengths before insert or update on public.course_modules for each row execute function public.validate_content_lengths();
create trigger validate_folder_length before insert or update on public.student_resource_folders for each row execute function public.validate_content_lengths();
create trigger validate_profile_lengths before insert or update on public.profiles for each row execute function public.validate_content_lengths();
create trigger validate_question_lengths before insert or update on public.exam_questions for each row execute function public.validate_content_lengths();
commit;
