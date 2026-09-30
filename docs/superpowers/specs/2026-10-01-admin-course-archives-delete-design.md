# Admin Course Archives Permanent Delete Design

## Goal

Complete Admin Courses archive management by moving the Archives entry point into Course Records, adding confirmation gates, and implementing an Admin-only permanent deletion path for archived courses.

## Existing System

Courses use the `archived` column and `public.admin_set_course_archived(p_course_id, p_archived)`. Active Admin Course Records already exclude archived rows. Restore/archive should continue using this existing RPC.

## UI

The Course Records card header owns the single Archives button. Archive and Restore actions require confirmation. Permanent Delete appears only in the Archived Courses modal and requires exact `DELETE` before submission. UI state disables duplicate destructive requests and refetches `admin-courses` after archive, restore, or delete.

## Backend

Add `public.admin_permanently_delete_course(p_course_id uuid)` in a new migration. The function is `SECURITY DEFINER`, uses a safe search path, derives all related IDs server-side, locks the course row, requires `archived = true`, checks active Admin from `profiles`, deletes exact blockers/children inside one transaction, writes one surviving `course.permanently_deleted` log, and returns a minimal storage manifest.

## Storage

Add an `admin-delete-course` Edge Function. It verifies the user's JWT via a user-scoped client and calls the RPC as that user. After database success, it uses a server-only privileged client to remove only RPC-returned objects from allowlisted buckets: `course-modules`, `course-permits`, `exam-submissions`, `proctor-snapshots`, and `audio-violations`. It never deletes `profile-pictures`.

## Verification

Use static regression scripts plus hosted read-only/synthetic verification. Do not delete existing hosted courses. Destructive manual QA remains limited to controlled temporary archived courses.
