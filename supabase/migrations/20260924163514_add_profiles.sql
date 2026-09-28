-- Adds `public.profiles`, one row per auth user, kept in sync with
-- `auth.users` via a trigger. `auth.users` itself isn't reachable from the
-- client (Supabase doesn't expose the `auth` schema over the REST API), so
-- this is how the admin chat-log detail view gets a user's email/name/last
-- login time, and it's also where each user's onboarding status lives.
--
-- Run this the same way as the earlier migrations (SQL Editor, or
-- `supabase db push` once linked).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  last_sign_in_at timestamptz,
  -- 'new': logged in, hasn't engaged with the chat bot yet.
  -- 'pending': chatted with the bot until it concluded the conversation
  --   (see the chat edge function's CONCLUSION_MARKER handling).
  -- 'onboarded': a human has since booked their follow-up call -- set only
  --   by an admin, from the chat-log detail page, never automatically.
  onboarding_status text not null default 'new'
    check (onboarding_status in ('new', 'pending', 'onboarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "Admins can view all profiles"
  on public.profiles for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Self-update: the chat edge function advances a user's own status from
-- 'new' to 'pending' (acting as that user's own JWT, same as everywhere
-- else in this app -- no service-role key).
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Admin update: marking someone else's status 'onboarded' from the
-- chat-log detail page.
create policy "Admins can update any profile"
  on public.profiles for update
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Both write paths above only ever need to touch onboarding_status --
-- narrow the grant to just that column (on top of the row-level policies),
-- and remove profile row creation/deletion from the client entirely; rows
-- only ever come from the sync trigger below, which runs with elevated
-- privileges regardless of these grants.
revoke insert, delete, update on public.profiles from authenticated, anon;
grant update (onboarding_status) on public.profiles to authenticated;

-- Bumps updated_at whenever onboarding_status (or anything else) changes,
-- independent of the column-level grant above -- trigger-computed columns
-- aren't subject to the invoking role's own column privileges.
create or replace function public.touch_profile_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row
  execute function public.touch_profile_updated_at();

-- Keeps profiles in sync with auth.users: creates a row on signup, and
-- refreshes email/full_name/last_sign_in_at on every login. Deliberately
-- never touches onboarding_status on conflict -- that column is owned by
-- the app (edge function / admin action), not derived from auth data.
-- SECURITY DEFINER because this runs as part of Supabase's internal auth
-- flow, not as `authenticated`/`anon`, and needs elevated rights to write
-- into `public` regardless.
create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, last_sign_in_at)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.last_sign_in_at
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name,
    last_sign_in_at = excluded.last_sign_in_at;
  return new;
end;
$$;

drop trigger if exists on_auth_user_change on auth.users;
create trigger on_auth_user_change
  after insert or update on auth.users
  for each row
  execute function public.sync_profile_from_auth_user();

-- Backfill: the trigger above only fires for future signups/logins, so
-- give every user that already exists a profile row right away.
insert into public.profiles (id, email, full_name, last_sign_in_at)
select id, email, raw_user_meta_data ->> 'full_name', last_sign_in_at
from auth.users
on conflict (id) do nothing;
