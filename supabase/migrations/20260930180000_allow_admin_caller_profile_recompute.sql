-- Backs `recompute-caller-profiles`, the admin-triggered bulk recompute
-- that brings existing users' `caller_profiles` rows up to date whenever
-- the scoring methodology in `_shared/caller-profile.ts` changes (the
-- immediate case: `neuroticism` is now the average of three sub-questions
-- instead of one direct question -- see that file's comment).
--
-- `upsert_caller_profile` previously only ever wrote the caller's own row
-- (derived from `auth.uid()`, no way to target anyone else). This adds an
-- optional trailing `p_user_id` -- appended as the last parameter with a
-- default so every existing call site (which passes none) is unaffected
-- -- and, when it's supplied for a row that isn't the caller's own,
-- requires the caller to be an admin. Mirrors `update_profile`'s same
-- self-or-admin shape (see `add_user_management.sql`) rather than
-- introducing a separate admin-only sibling function for what's
-- otherwise identical logic.
--
-- `create or replace function` only replaces a function with the exact
-- same parameter list -- adding a new trailing parameter (even with a
-- default) makes Postgres treat it as a distinct overload rather than a
-- replacement, which then breaks the unqualified `revoke`/`grant` below
-- ("function name is not unique"). Drop the old 17-parameter signature
-- explicitly first so exactly one `upsert_caller_profile` exists after
-- this migration, same as before it.
drop function if exists public.upsert_caller_profile(
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  text, numeric, text, numeric, text, numeric, text, numeric, integer
);

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
  p_messages_analyzed integer,
  p_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_id uuid := coalesce(p_user_id, auth.uid());
begin
  if v_target_id <> auth.uid()
     and (auth.jwt() -> 'app_metadata' ->> 'role') <> 'admin'
  then
    raise exception 'Only admins can update another user''s caller profile'
      using errcode = '42501';
  end if;

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
    v_target_id, p_mood, p_neuroticism, p_entitlement, p_self_reflection,
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
