-- Lets admin users read every conversation/message, not just their own, for
-- the /signed-in/admin/chats view. Run this in the Supabase SQL Editor (or
-- via `supabase db push` once the CLI is linked to the project) the same
-- way as the earlier migration.
--
-- "Admin" is read from the `role` claim in `app_metadata` on the JWT
-- (`auth.jwt() -> 'app_metadata' ->> 'role'`), a standard Supabase claim
-- that's present on every access token without extra setup. `app_metadata`
-- can only be set via the Supabase dashboard or the Admin API (never by the
-- user themselves), which is what makes it safe to gate access on.
--
-- These are *additional* policies alongside the "own rows only" ones from
-- the previous migration -- Postgres OR's multiple policies for the same
-- command together, so a regular user is unaffected (their own-rows policy
-- still applies) while an admin satisfies this policy too and sees
-- everyone's rows. Read-only: admins get no extra insert/update/delete
-- access here.
--
-- To make a user an admin, run (via the SQL Editor):
--   update auth.users
--   set raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'::jsonb
--   where email = 'someone@example.com';
-- They then need to sign out and back in -- app_metadata changes only take
-- effect on the next issued access token, not the one already in use.

create policy "Admins can view all conversations"
  on public.conversations for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admins can view all messages"
  on public.messages for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
