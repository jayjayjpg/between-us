-- Backs the AI-inferred "caller profile" shown to admins on the chat-log
-- detail page: a set of traits (mood, temperament, and a few estimated
-- demographic signals) meant to help the human listener approach the
-- follow-up call well-informed. Computed by the chat edge function via
-- OpenRouter's Decisions API (`typesafe/jev-*`) after each onboarding
-- message -- see `analyzeCallerProfile` in supabase/functions/chat/index.ts.
--
-- Unlike the abuse-prevention counters in `add_abuse_prevention.sql`, this
-- table intentionally does NOT grant the owning user direct INSERT/UPDATE
-- via RLS: those counters are low-stakes bookkeeping where self-tampering
-- doesn't matter, but a user rewriting their own inferred profile would
-- defeat the entire point of it being an independent read for the
-- listener. Writes only happen through `upsert_caller_profile` below
-- (`security definer`, and not granted to anyone but `authenticated`),
-- which still derives the row to write from the caller's own `auth.uid()`
-- -- so it can never write another user's profile -- it just isn't a path
-- the user can point at arbitrary values through directly.
create table public.caller_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Continuous traits, normalized 0 (low end of the trait) to 1 (high
  -- end) -- see the per-question `criteria` scales in
  -- `buildCallerProfileQuestions` for what each end represents.
  mood numeric(3, 2),
  neuroticism numeric(3, 2),
  entitlement numeric(3, 2),
  self_reflection numeric(3, 2),
  willingness_to_change numeric(3, 2),
  descriptiveness numeric(3, 2),
  defensiveness numeric(3, 2),
  satisfaction numeric(3, 2),

  -- Estimated/disclosed demographic signals. Each defaults to, and should
  -- be read back as, 'unknown' whenever the model doesn't have clear
  -- signal -- the accompanying `_confidence` is what the admin UI uses to
  -- decide whether to actually show a non-unknown value at all, so a
  -- low-confidence guess doesn't get presented as fact about someone in a
  -- confidential support conversation.
  estimated_gender text not null default 'unknown' check (
    estimated_gender in ('male', 'female', 'nonbinary_or_other', 'unknown')
  ),
  estimated_gender_confidence numeric(3, 2),

  estimated_age_bracket text not null default 'unknown' check (
    estimated_age_bracket in (
      'under_18', '18_24', '25_34', '35_44', '45_54', '55_64', '65_plus', 'unknown'
    )
  ),
  estimated_age_confidence numeric(3, 2),

  education_level text not null default 'unknown' check (
    education_level in (
      'less_than_high_school', 'high_school', 'some_college', 'bachelors', 'graduate', 'unknown'
    )
  ),
  education_level_confidence numeric(3, 2),

  political_alignment text not null default 'unknown' check (
    political_alignment in (
      'extreme_left', 'left', 'centrist', 'right', 'extreme_right', 'unknown'
    )
  ),
  political_alignment_confidence numeric(3, 2),

  -- How many of the caller's own messages fed the most recent analysis --
  -- lets the admin UI caveat a profile built from just one or two
  -- messages differently than one built from a full conversation.
  messages_analyzed integer not null default 0,
  last_analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.caller_profiles enable row level security;

create policy "Users can view their own caller profile"
  on public.caller_profiles for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Admins can view all caller profiles"
  on public.caller_profiles for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Upserts the caller's own profile row from the edge function. Runs as
-- `security definer` specifically so it can write despite no client-facing
-- INSERT/UPDATE policy existing on the table (see the comment above the
-- table) -- but it still only ever writes `auth.uid()`'s own row, so it
-- grants no more reach than the counters' `with check (auth.uid() =
-- user_id)` policies do, just via a narrower path.
create or replace function public.upsert_caller_profile(
  p_mood numeric,
  p_neuroticism numeric,
  p_entitlement numeric,
  p_self_reflection numeric,
  p_willingness_to_change numeric,
  p_descriptiveness numeric,
  p_defensiveness numeric,
  p_satisfaction numeric,
  p_estimated_gender text,
  p_estimated_gender_confidence numeric,
  p_estimated_age_bracket text,
  p_estimated_age_confidence numeric,
  p_education_level text,
  p_education_level_confidence numeric,
  p_political_alignment text,
  p_political_alignment_confidence numeric,
  p_messages_analyzed integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.caller_profiles (
    user_id, mood, neuroticism, entitlement, self_reflection,
    willingness_to_change, descriptiveness, defensiveness, satisfaction,
    estimated_gender, estimated_gender_confidence,
    estimated_age_bracket, estimated_age_confidence,
    education_level, education_level_confidence,
    political_alignment, political_alignment_confidence,
    messages_analyzed, last_analyzed_at, updated_at
  )
  values (
    auth.uid(), p_mood, p_neuroticism, p_entitlement, p_self_reflection,
    p_willingness_to_change, p_descriptiveness, p_defensiveness, p_satisfaction,
    coalesce(p_estimated_gender, 'unknown'), p_estimated_gender_confidence,
    coalesce(p_estimated_age_bracket, 'unknown'), p_estimated_age_confidence,
    coalesce(p_education_level, 'unknown'), p_education_level_confidence,
    coalesce(p_political_alignment, 'unknown'), p_political_alignment_confidence,
    p_messages_analyzed, now(), now()
  )
  on conflict (user_id) do update set
    mood = excluded.mood,
    neuroticism = excluded.neuroticism,
    entitlement = excluded.entitlement,
    self_reflection = excluded.self_reflection,
    willingness_to_change = excluded.willingness_to_change,
    descriptiveness = excluded.descriptiveness,
    defensiveness = excluded.defensiveness,
    satisfaction = excluded.satisfaction,
    estimated_gender = excluded.estimated_gender,
    estimated_gender_confidence = excluded.estimated_gender_confidence,
    estimated_age_bracket = excluded.estimated_age_bracket,
    estimated_age_confidence = excluded.estimated_age_confidence,
    education_level = excluded.education_level,
    education_level_confidence = excluded.education_level_confidence,
    political_alignment = excluded.political_alignment,
    political_alignment_confidence = excluded.political_alignment_confidence,
    messages_analyzed = excluded.messages_analyzed,
    last_analyzed_at = now(),
    updated_at = now();
end;
$$;

revoke all on function public.upsert_caller_profile from public;
grant execute on function public.upsert_caller_profile to authenticated;
