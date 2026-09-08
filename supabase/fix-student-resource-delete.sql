-- Supabase forbids deleting directly from storage.objects.
-- Resource files are removed by the client through storage.from(...).remove().
drop trigger if exists delete_student_resource_storage_object
on public.student_resource_files;

drop function if exists public.delete_student_resource_storage_object();
