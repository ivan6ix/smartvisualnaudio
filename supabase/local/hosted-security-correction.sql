-- Minimal hosted correction for postcheck failures after hosted-security-deployment.sql.
-- DO NOT EXECUTE until reviewed. Intended for hosted Supabase SQL Editor.
-- Fixes explicit anon EXECUTE left on SECURITY DEFINER client RPCs.

begin;

revoke execute on function public.create_notification(text, uuid, text, text, text, uuid) from anon;
revoke execute on function public.get_student_exam_questions(uuid) from anon;
revoke execute on function public.join_course_by_code(text) from anon;
revoke execute on function public.submit_exam_attempt(uuid, jsonb, jsonb) from anon;

revoke execute on function public.create_notification(text, uuid, text, text, text, uuid) from public;
revoke execute on function public.get_student_exam_questions(uuid) from public;
revoke execute on function public.join_course_by_code(text) from public;
revoke execute on function public.submit_exam_attempt(uuid, jsonb, jsonb) from public;

grant execute on function public.create_notification(text, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.get_student_exam_questions(uuid) to authenticated;
grant execute on function public.join_course_by_code(text) to authenticated;
grant execute on function public.submit_exam_attempt(uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
