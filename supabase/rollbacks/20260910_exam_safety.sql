begin;
drop trigger if exists guard_scheduled_submission on public.exam_attempts;
drop trigger if exists guard_exam_question_content on public.exam_questions;
drop trigger if exists guard_exam_content on public.exams;
drop function if exists public.guard_scheduled_submission();
drop function if exists public.guard_exam_changes();
drop function if exists public.save_exam(uuid,jsonb,jsonb);
drop function if exists public.authorize_exam_start(uuid);
-- Keep start records for audit/recovery; rollback does not delete production data.
drop function if exists public.set_exam_archived(uuid,boolean);
drop trigger if exists validate_message_length on public.messages;
drop trigger if exists validate_course_lengths on public.courses;
drop trigger if exists validate_module_lengths on public.course_modules;
drop trigger if exists validate_folder_length on public.student_resource_folders;
drop trigger if exists validate_profile_lengths on public.profiles;
drop trigger if exists validate_question_lengths on public.exam_questions;
drop function if exists public.validate_content_lengths();
commit;
