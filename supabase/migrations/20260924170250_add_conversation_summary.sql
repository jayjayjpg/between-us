-- Adds a `summary` column to `conversations`, holding the chat edge
-- function's AI-generated recap of the conversation for the admin
-- chat-log detail view. No new RLS/grants needed: the existing
-- "Users can update their own conversations" policy already covers writing
-- to any column on a row the caller owns (which is how the edge function,
-- acting as that user's own JWT, saves it), and the existing
-- "Admins can view all conversations" policy already covers reading any
-- column on any row for an admin.
alter table public.conversations
  add column summary text;
