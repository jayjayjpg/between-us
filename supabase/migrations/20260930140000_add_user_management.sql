-- Backs the `manage-user` edge function's edit path (its delete path needs
-- no schema change -- see the comment at the bottom of this file for why).

-- The original `add_profiles` migration granted every authenticated user
-- `update (onboarding_status)` on their own row, intending it only for the
-- chat edge function's own 'new' -> 'pending' advancement (which acts as
-- that user's JWT). It didn't account for a user just calling
-- `.update({ onboarding_status: 'onboarded' })` on their own row directly
-- -- RLS's "Users can update their own profile" policy plus that grant
-- would have let that succeed, self-promoting straight past the intended
-- admin-only 'onboarded' transition. Closing that here: revoke the grant,
-- and replace every direct-write path (this one plus the new full_name
-- edit) with the single `update_profile` RPC below, which enforces the
-- real permission matrix itself rather than relying on column grants to
-- approximate it.
revoke update (onboarding_status) on public.profiles from authenticated;

drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Admins can update any profile" on public.profiles;

-- Edits a profile's `full_name` and/or `onboarding_status`, enforcing:
--   - Anyone may edit their own row; only an admin may edit someone else's.
--   - `onboarding_status` may only be changed by an admin (on any row,
--     including their own) -- a plain user can never touch it, even on
--     their own row, closing the gap described above.
-- `p_user_id` null means "my own row". Either p_full_name or
-- p_onboarding_status may be null to leave that field unchanged; passing
-- both null is rejected by the edge function before this is ever called.
-- `security definer` since, per the drop above, `authenticated` now has no
-- direct UPDATE privilege on `profiles` at all -- this is the only path.
create or replace function public.update_profile(
  p_user_id uuid,
  p_full_name text,
  p_onboarding_status text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_id uuid := coalesce(p_user_id, auth.uid());
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
  v_row public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if v_target_id <> auth.uid() and not v_is_admin then
    raise exception 'Not authorized to edit this user'
      using errcode = '42501';
  end if;

  if p_onboarding_status is not null and not v_is_admin then
    raise exception 'Only admins can change onboarding status'
      using errcode = '42501';
  end if;

  update public.profiles
  set
    full_name = coalesce(p_full_name, full_name),
    onboarding_status = coalesce(p_onboarding_status, onboarding_status)
  where id = v_target_id
  returning * into v_row;

  -- The existing `onboarding_status` check constraint (see `add_profiles`)
  -- already rejects an invalid status value by failing the update above;
  -- this only catches a target row that doesn't exist at all.
  if v_row is null then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_profile from public;
grant execute on function public.update_profile to authenticated;

-- Account management (edit/delete, via `manage-user`) gets its own rate
-- limit bucket rather than sharing 'write' with the chat endpoint -- a
-- stricter per-minute limit makes sense for actions this consequential,
-- and pooling it with chat traffic would mean a heavy chat session could
-- (or a profile edit could) eat into the other's budget for no reason.
alter table public.rate_limit_counters
  drop constraint rate_limit_counters_bucket_check;
alter table public.rate_limit_counters
  add constraint rate_limit_counters_bucket_check
  check (bucket in ('read', 'write', 'account'));

-- No schema change needed for deletion itself: `manage-user` deletes a
-- user by calling the Supabase Auth Admin API (`auth.admin.deleteUser`),
-- which removes the `auth.users` row directly -- and every table that
-- references a user (`profiles`, `conversations`, `messages`,
-- `caller_profiles`, `rate_limit_counters`, `ai_usage_counters`,
-- `user_request_log`) already declared `references auth.users (id) on
-- delete cascade` in its own migration, so deleting the auth user cleans
-- up everything below it automatically.
