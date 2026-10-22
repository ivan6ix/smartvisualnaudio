-- Request log for the generate-mcq Edge Function: one row per generation call, used for per-professor rate
-- limits, one call in flight at a time, and duplicate-request protection. It stores counts and token usage
-- only, never PDF text, prompts or generated questions. Only service_role (the Edge Function) can read or
-- write it. Additive and safe to re-run.

create table if not exists public.ai_question_generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_key uuid not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  question_count integer not null check (question_count between 1 and 20),
  difficulty text not null check (difficulty in ('Easy', 'Moderate', 'Hard', 'Mixed')),
  page_count integer not null check (page_count between 1 and 100),
  char_count integer not null check (char_count >= 0),
  returned_count integer check (returned_count >= 0),
  model text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, request_key)
);

create index if not exists ai_question_generation_requests_user_created_idx
  on public.ai_question_generation_requests (user_id, created_at desc);

alter table public.ai_question_generation_requests enable row level security;
revoke all on table public.ai_question_generation_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_question_generation_requests to service_role;

-- Checks the limits and records the call in one transaction. The per-user advisory lock stops two parallel
-- calls from both passing the checks.
create or replace function public.claim_ai_question_generation(
  p_user_id uuid,
  p_request_key uuid,
  p_question_count integer,
  p_difficulty text,
  p_page_count integer,
  p_char_count integer,
  p_window_minutes integer,
  p_window_limit integer,
  p_daily_limit integer,
  p_in_flight_minutes integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_count integer;
  v_daily_count integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_question_generation:' || p_user_id::text, 0));

  if exists (
    select 1 from public.ai_question_generation_requests
    where user_id = p_user_id and request_key = p_request_key
  ) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  if exists (
    select 1 from public.ai_question_generation_requests
    where user_id = p_user_id
      and status = 'pending'
      and created_at > now() - make_interval(mins => p_in_flight_minutes)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'in_flight');
  end if;

  select
    count(*) filter (where created_at > now() - make_interval(mins => p_window_minutes)),
    count(*)
  into v_window_count, v_daily_count
  from public.ai_question_generation_requests
  where user_id = p_user_id and created_at > now() - interval '1 day';

  if v_window_count >= p_window_limit then
    return jsonb_build_object('ok', false, 'reason', 'window_limit');
  end if;
  if v_daily_count >= p_daily_limit then
    return jsonb_build_object('ok', false, 'reason', 'daily_limit');
  end if;

  insert into public.ai_question_generation_requests (
    user_id, request_key, question_count, difficulty, page_count, char_count
  ) values (
    p_user_id, p_request_key, p_question_count, p_difficulty, p_page_count, p_char_count
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.claim_ai_question_generation(uuid, uuid, integer, text, integer, integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_ai_question_generation(uuid, uuid, integer, text, integer, integer, integer, integer, integer, integer) to service_role;
