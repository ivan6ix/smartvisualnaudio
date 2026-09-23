-- Hosted security hardening rollback scaffold.
-- CREATE ONLY. DO NOT EXECUTE without reviewing hosted pre-deployment backups.
--
-- BACKUP REQUIRED BEFORE DEPLOYMENT:
-- 1. Current definitions for all policies replaced or removed by hosted-security-deployment.sql.
-- 2. Current definitions for these functions if they already exist:
--    is_audit_role, current_profile_role, is_student_enrolled_in_course,
--    create_notification, protect_profile_privileged_fields,
--    sanitize_student_question_config, student_can_take_exam,
--    get_student_exam_questions, grade_exam_answer, submit_exam_attempt,
--    join_course_by_code, protect_student_violation_updates.
-- 3. Current trigger definitions for profiles and violations.
-- 4. Current function grants for the controlled RPCs and helper functions.
--
-- Rollback would remove or weaken:
-- - sanitized student question RPC enforcement
-- - controlled attempt submission/idempotency RPC
-- - controlled course join RPC
-- - controlled notification creation RPC
-- - profile privileged-field trigger protection
-- - student violation trusted-field trigger protection
-- - narrowed course/exam/approval-log/notification/attempt policies
--
-- This file intentionally aborts until the captured hosted definitions are pasted below.

do $$
begin
  raise exception 'BACKUP REQUIRED BEFORE DEPLOYMENT: paste reviewed hosted pre-deployment definitions into this rollback file before executing it.';
end $$;

-- Paste reviewed restore SQL below this line only after hosted precheck output has been reviewed.
