-- Backs the chat edge function's rate limiting, daily AI quota, and
-- suspicious-activity checks (see supabase/functions/chat/index.ts). Every
-- RPC below reads `auth.uid()` from the caller's own JWT rather than taking
-- a user id argument, so a caller can only ever record/check activity
-- against their own account -- consistent with this app never using a
-- service-role key.

-- ---------------------------------------------------------------------
-- Rate limiting: N requests per user per operation-type per minute.
-- ---------------------------------------------------------------------

create table public.rate_limit_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null check (bucket in ('read', 'write')),
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (user_id, bucket, window_start)
);

alter table public.rate_limit_counters enable row level security;

create policy "Users can manage their own rate limit counters"
  on public.rate_limit_counters for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Atomically records one request against the caller's current 1-minute
-- window for `p_bucket` and reports whether they're still at or under
-- `p_limit`. The caller (the edge function) decides what counts as a
-- "read" vs a "write" and what each bucket's limit is.
create or replace function public.increment_rate_limit(
  p_bucket text,
  p_limit integer
)
returns table (allowed boolean, current_count integer)
language plpgsql
set search_path = public
as $$
declare
  v_window_start timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  insert into public.rate_limit_counters (user_id, bucket, window_start, count)
  values (auth.uid(), p_bucket, v_window_start, 1)
  on conflict (user_id, bucket, window_start)
  do update set count = rate_limit_counters.count + 1
  returning count into v_count;

  return query select v_count <= p_limit, v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Daily AI (OpenRouter/Mercury) usage quota, resetting at UTC midnight by
-- virtue of being keyed on the UTC calendar date rather than a rolling
-- window.
-- ---------------------------------------------------------------------

create table public.ai_usage_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null,
  count integer not null default 0,
  primary key (user_id, usage_date)
);

alter table public.ai_usage_counters enable row level security;

create policy "Users can manage their own AI usage counters"
  on public.ai_usage_counters for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Atomically records one AI call against the caller's current UTC day and
-- reports whether they're still at or under `p_limit`.
create or replace function public.increment_ai_usage(
  p_limit integer
)
returns table (allowed boolean, current_count integer)
language plpgsql
set search_path = public
as $$
declare
  v_date date := (now() at time zone 'utc')::date;
  v_count integer;
begin
  insert into public.ai_usage_counters (user_id, usage_date, count)
  values (auth.uid(), v_date, 1)
  on conflict (user_id, usage_date)
  do update set count = ai_usage_counters.count + 1
  returning count into v_count;

  return query select v_count <= p_limit, v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Suspicious-activity signal: rapid IP address changes. Last-seen IP per
-- user only -- not a general audit log.
-- ---------------------------------------------------------------------

create table public.user_request_log (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_ip text,
  last_seen_at timestamptz
);

alter table public.user_request_log enable row level security;

create policy "Users can manage their own request log"
  on public.user_request_log for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Atomically compares the caller's new IP to their last recorded one and
-- records the new one, returning true if the IP changed within
-- `p_window_seconds` of their last request -- a signal (not proof) of a
-- shared/compromised session or automated traffic bouncing across IPs. Kept
-- deliberately tight (see the edge function's constant) so an ordinary
-- network change -- wifi to cellular, a VPN toggle -- doesn't get flagged
-- unless it happens implausibly fast.
create or replace function public.check_suspicious_ip_change(
  p_ip text,
  p_window_seconds integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_last_ip text;
  v_last_seen_at timestamptz;
  v_suspicious boolean := false;
begin
  select last_ip, last_seen_at into v_last_ip, v_last_seen_at
  from public.user_request_log
  where user_id = auth.uid();

  if v_last_ip is not null
     and p_ip is not null
     and v_last_ip <> p_ip
     and v_last_seen_at is not null
     and now() - v_last_seen_at < make_interval(secs => p_window_seconds)
  then
    v_suspicious := true;
  end if;

  insert into public.user_request_log (user_id, last_ip, last_seen_at)
  values (auth.uid(), p_ip, now())
  on conflict (user_id) do update
    set last_ip = excluded.last_ip, last_seen_at = excluded.last_seen_at;

  return v_suspicious;
end;
$$;
