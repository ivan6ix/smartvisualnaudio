-- Safe performance indexes for the Supabase SQL Editor.
-- These match the current React/Supabase queries in this project.

create index if not exists idx_profiles_role
on public.profiles (role);

create index if not exists idx_profiles_created_at_desc
on public.profiles (created_at desc);

create index if not exists idx_courses_professor_archived_created_at
on public.courses (professor_id, archived, created_at desc);

create index if not exists idx_courses_archived_created_at
on public.courses (archived, created_at desc);

create index if not exists idx_courses_created_at_desc
on public.courses (created_at desc);

create index if not exists idx_exams_course_status_created_at
on public.exams (course_id, status, created_at desc);

create index if not exists idx_exams_course_created_at
on public.exams (course_id, created_at desc);

create index if not exists idx_exams_professor_status_created_at
on public.exams (professor_id, status, created_at desc);

create index if not exists idx_exams_created_by_status_created_at
on public.exams (created_by, status, created_at desc);

create index if not exists idx_exams_status_created_at
on public.exams (status, created_at desc);

create index if not exists idx_exam_questions_exam_id
on public.exam_questions (exam_id);

create index if not exists idx_exam_reviews_exam_review_date
on public.exam_reviews (exam_id, review_date desc);

create index if not exists idx_exam_attempts_exam_submitted_at
on public.exam_attempts (exam_id, submitted_at desc);

create index if not exists idx_exam_attempts_student_exam
on public.exam_attempts (student_id, exam_id);

create index if not exists idx_exam_attempts_student_submitted_at
on public.exam_attempts (student_id, submitted_at desc);

create index if not exists idx_exam_attempts_status
on public.exam_attempts (status);

create index if not exists idx_exam_attempt_answers_attempt_id
on public.exam_attempt_answers (attempt_id);

create index if not exists idx_exam_attempt_answers_question_id
on public.exam_attempt_answers (question_id);

create index if not exists idx_course_enrollments_student_joined_at
on public.course_enrollments (student_id, joined_at desc);

create index if not exists idx_course_enrollments_course_joined_at
on public.course_enrollments (course_id, joined_at asc);

create index if not exists idx_course_periods_course_professor_created_at
on public.course_periods (course_id, professor_id, created_at asc);

create index if not exists idx_course_modules_course_professor_created_at
on public.course_modules (course_id, professor_id, created_at desc);

create index if not exists idx_course_modules_course_created_at
on public.course_modules (course_id, created_at desc);

create index if not exists idx_course_permit_requests_course_created_at
on public.course_permit_requests (course_id, created_at desc);

create index if not exists idx_course_permit_files_course_student_created_at
on public.course_permit_files (course_id, student_id, created_at desc);

create index if not exists idx_violations_created_at
on public.violations (created_at desc);

create index if not exists idx_violations_exam_created_at
on public.violations (exam_id, created_at desc);

create index if not exists idx_violations_student_created_at
on public.violations (student_id, created_at desc);

create index if not exists idx_violations_professor_created_at
on public.violations (professor_id, created_at desc);

create index if not exists idx_notifications_user_created_at
on public.notifications (user_id, created_at desc);

create index if not exists idx_notifications_user_unread_created_at
on public.notifications (user_id, is_read, created_at desc);

create index if not exists idx_messages_receiver_unread_created_at
on public.messages (receiver_id, is_read, created_at desc);

create index if not exists idx_messages_sender_created_at
on public.messages (sender_id, created_at desc);

create index if not exists idx_messages_receiver_created_at
on public.messages (receiver_id, created_at desc);

create index if not exists idx_logs_created_at
on public.logs (created_at desc);

create index if not exists idx_logs_user_created_at
on public.logs (user_id, created_at desc);
