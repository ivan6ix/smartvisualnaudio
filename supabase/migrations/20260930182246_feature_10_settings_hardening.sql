begin;

update storage.buckets
set
  file_size_limit = 5 * 1024 * 1024,
  allowed_mime_types = array['image/png']::text[]
where id = 'profile-pictures';

revoke delete, truncate, references, trigger on table public.notification_preferences from authenticated;
grant select, insert, update on table public.notification_preferences to authenticated;

create or replace function public.write_self_account_audit_log(
  p_event_type text,
  p_action text,
  p_description text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles;
  audit_id uuid;
  clean_event_type text := btrim(coalesce(p_event_type, ''));
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if clean_event_type not in (
    'account.password_changed',
    'account.avatar_updated',
    'account.avatar_removed'
  ) then
    raise exception 'Unsupported account audit event.';
  end if;

  select *
  into caller
  from public.profiles
  where id = auth.uid()
    and status = 'Active';

  if caller.id is null then
    raise exception 'Active account required.';
  end if;

  audit_id := public.write_audit_log(
    auth.uid(),
    caller.role::text,
    clean_event_type,
    p_action,
    p_description,
    'account',
    null,
    auth.uid(),
    coalesce(p_metadata, '{}'::jsonb)
  );

  return audit_id;
end;
$$;

revoke all on function public.write_self_account_audit_log(text, text, text, jsonb) from public, anon;
grant execute on function public.write_self_account_audit_log(text, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
