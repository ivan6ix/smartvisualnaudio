revoke all on function public.create_notification(text, uuid, text, text, text, uuid) from public, anon, authenticated;
drop function if exists public.create_notification(text, uuid, text, text, text, uuid);

notify pgrst, 'reload schema';
