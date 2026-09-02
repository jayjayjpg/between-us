-- Conversations + messages for the coaching chat, scoped per signed-in user
-- via Row Level Security. Run this in the Supabase SQL Editor (or via
-- `supabase db push` once the CLI is linked to the project).

create extension if not exists pgcrypto;

-- Conversations: one row per chat thread, owned by exactly one signed-in
-- user.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_id_idx
  on public.conversations (user_id);

alter table public.conversations enable row level security;

create policy "Users can view their own conversations"
  on public.conversations for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own conversations"
  on public.conversations for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own conversations"
  on public.conversations for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own conversations"
  on public.conversations for delete
  to authenticated
  using (auth.uid() = user_id);

-- Messages: individual chat turns within a conversation. `user_id` is
-- denormalized from the parent conversation so RLS can check ownership
-- directly on every row, without a join.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'assistant', 'system')),
  content text not null check (char_length(trim(content)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx
  on public.messages (conversation_id);

create index if not exists messages_user_id_idx
  on public.messages (user_id);

alter table public.messages enable row level security;

create policy "Users can view their own messages"
  on public.messages for select
  to authenticated
  using (auth.uid() = user_id);

-- Requires both that the message is being written as the caller, and that
-- the target conversation is one the caller actually owns -- otherwise a
-- user could attach their own messages to someone else's conversation.
create policy "Users can add messages to their own conversations"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "Users can delete their own messages"
  on public.messages for delete
  to authenticated
  using (auth.uid() = user_id);

-- Keep conversations.updated_at current so a future "recent conversations"
-- view can sort by last activity rather than creation time. Runs with the
-- inserting user's own privileges -- the insert policy above already
-- guarantees they own the conversation, so the update policy permits this.
create or replace function public.touch_conversation_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row
  execute function public.touch_conversation_updated_at();
