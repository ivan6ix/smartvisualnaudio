-- Existing hosted projects may still have the pre-draft save_exam RPC, which
-- rejects empty titles/questions even when saving status='Draft'. Keep strict
-- validation for submission, but allow owned backend drafts to sync early.
begin;

create or replace function public.save_exam(p_id uuid, p_exam jsonb, p_questions jsonb)
returns uuid
language plpgsql
security invoker
set search_path=public
as $$
declare
  eid uuid;
  old_exam public.exams;
  q jsonb;
  starts timestamptz;
  ends timestamptz;
  is_draft boolean;
  exam_title text;
  course_uuid uuid;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='Professor' and status='Active') then
    raise exception 'Professor access required.';
  end if;

  is_draft := coalesce(p_exam->>'status','Draft') = 'Draft';
  course_uuid := nullif(p_exam->>'course_id','')::uuid;

  if course_uuid is null
     or not exists(select 1 from public.courses where id=course_uuid and professor_id=auth.uid() and not archived) then
    raise exception 'Select an assigned active course.';
  end if;

  exam_title := case
    when length(trim(coalesce(p_exam->>'title',''))) > 0 then trim(p_exam->>'title')
    else 'Untitled Draft'
  end;

  if (not is_draft and length(trim(coalesce(p_exam->>'title',''))) = 0) or length(exam_title) > 200 then
    raise exception 'Exam title is required and must be 200 characters or fewer.';
  end if;

  if length(coalesce(p_exam->'exam_settings'->>'description','')) > 1000 then
    raise exception 'Description must be 1000 characters or fewer.';
  end if;

  if length(coalesce(p_exam->'exam_settings'->>'instructions','')) > 5000 then
    raise exception 'Instructions must be 5000 characters or fewer.';
  end if;

  if nullif(p_exam->>'duration','')::integer is not null
     and nullif(p_exam->>'duration','')::integer not between 1 and 1440 then
    raise exception 'Duration must be 1 to 1440 minutes.';
  end if;

  if p_exam->>'status' not in ('Draft','Pending Review') then
    raise exception 'Save as draft or submit for review before publishing.';
  end if;

  starts := nullif(p_exam->'exam_settings'->>'startsAt','')::timestamptz;
  ends := nullif(p_exam->'exam_settings'->>'deadline','')::timestamptz;
  if ends <= starts then
    raise exception 'Deadline must be after the start.';
  end if;

  if (not is_draft and jsonb_array_length(p_questions) < 1) or jsonb_array_length(p_questions) > 500 then
    raise exception 'Add between 1 and 500 questions.';
  end if;

  for q in select value from jsonb_array_elements(p_questions) loop
    if length(trim(coalesce(q->>'question_text',''))) = 0
       or length(q->>'question_text') > 5000
       or nullif(q->>'points','')::numeric not between 0.01 and 1000 then
      raise exception 'Each question requires text (up to 5000 characters) and points from 0.01 to 1000.';
    end if;
  end loop;

  if p_id is not null then
    select * into old_exam
    from public.exams
    where id = p_id and (professor_id = auth.uid() or created_by = auth.uid())
    for update;

    if old_exam.id is null then
      raise exception 'Exam access denied.';
    end if;

    if lower(old_exam.status) not in ('draft','rejected','revision needed','unpublished') then
      raise exception 'Only drafts, rejected or unpublished exams can be edited.';
    end if;

    update public.exams
    set title = exam_title,
        exam_title = exam_title,
        course_id = course_uuid,
        description = p_exam->>'description',
        semester = p_exam->>'semester',
        exam_type = p_exam->>'exam_type',
        course = p_exam->>'course',
        exam_settings = p_exam->'exam_settings',
        duration = nullif(p_exam->>'duration','')::integer,
        time_limit = nullif(p_exam->>'duration','')::integer,
        questions_count = jsonb_array_length(p_questions),
        status = p_exam->>'status',
        approved_at = null,
        rejected_at = null,
        submitted_at = case when p_exam->>'status' = 'Pending Review' then now() else null end
    where id = p_id
    returning id into eid;

    delete from public.exam_questions where exam_id = eid;
  else
    insert into public.exams(course_id,title,exam_title,description,semester,exam_type,course,exam_settings,duration,time_limit,questions_count,status,created_by,professor_id,submitted_at)
    values(course_uuid,exam_title,exam_title,p_exam->>'description',p_exam->>'semester',p_exam->>'exam_type',p_exam->>'course',p_exam->'exam_settings',nullif(p_exam->>'duration','')::integer,nullif(p_exam->>'duration','')::integer,jsonb_array_length(p_questions),p_exam->>'status',auth.uid(),auth.uid(),case when p_exam->>'status' = 'Pending Review' then now() else null end)
    returning id into eid;
  end if;

  insert into public.exam_questions(id,exam_id,question_text,question_type,choices,correct_answer,correct_answers,question_config,manual_grading,points)
  select coalesce(x.id, gen_random_uuid()), eid, x.question_text, x.question_type, x.choices, x.correct_answer, x.correct_answers, x.question_config, x.manual_grading, x.points
  from jsonb_to_recordset(p_questions) as x(id uuid, question_text text, question_type text, choices jsonb, correct_answer text, correct_answers jsonb, question_config jsonb, manual_grading boolean, points numeric);

  return eid;
end $$;

revoke all on function public.save_exam(uuid,jsonb,jsonb) from public;
grant execute on function public.save_exam(uuid,jsonb,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
