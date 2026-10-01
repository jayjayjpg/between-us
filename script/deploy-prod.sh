#!/usr/bin/env bash
# Builds the frontend for production and deploys the Supabase side (DB
# migrations + edge functions) to the "between-us-prod" project -- see
# `npm run deploy:prod` in package.json, which is how this is meant to be
# invoked (npm runs scripts with cwd already set to coach-bot/, where this
# expects to run from).
#
# Frontend hosting (Netlify) isn't triggered from here: Netlify already
# rebuilds and redeploys automatically from its own GitHub integration on
# every push to the connected branch, using its own configured env vars
# (see CLAUDE.md) -- the build step below exists for a local,
# production-equivalent sanity build, not to publish it anywhere itself.
# Netlify *does* run this exact script, though (its configured build
# command), which is why every Supabase CLI call below goes through `npx`
# rather than a bare `supabase`: the CLI isn't preinstalled on Netlify's
# build image, and global installs of it are exactly what its own docs
# steer you away from, so it's a normal `devDependency` in package.json
# instead (`npm install`, which Netlify always runs before the build
# command, pulls it into node_modules/.bin) -- `npx` is what resolves that
# local copy, on Netlify and locally alike, without assuming anything
# about the machine it's running on beyond Node/npm.
#
# `supabase db push` has no `--project-ref` flag (unlike `functions
# deploy`) -- it only ever pushes to whichever project is currently
# *linked*. So this temporarily links to prod, pushes, and always
# re-links back to dev before exiting (via the trap below), regardless of
# whether anything failed -- every other command in this repo assumes the
# CLI is linked to dev, and leaving it linked to prod after an error would
# be an easy way to accidentally run some later dev command against
# production instead. That restore is skipped on Netlify specifically
# (detected via the `$NETLIFY` var Netlify always sets in its build
# environment): its build container is thrown away after every build, so
# there's no local dev workflow there to protect, and attempting it only
# risks a second, confusing credential-related failure in the build log
# on top of whatever the real one was.

set -euo pipefail

DEV_PROJECT_REF="bqjdlgogxlpkvhsucepp"
PROD_PROJECT_REF="hhqotvloounlbzwdvfhh"

# On Netlify, SUPABASE_ACCESS_TOKEN is the *only* possible way to
# authenticate -- its build container is fresh every time, so there's
# never a cached `supabase login` session the way there is locally -- so
# fail fast there with an unambiguous message if it's missing, rather
# than letting that surface later as the CLI's own much less clear
# "necessary privileges" error. Those two failure modes (no token vs. a
# token the Management API rejects) look identical from the CLI's error
# text alone, so this is what actually tells them apart. Locally, a
# cached login session is a perfectly valid alternative, so this isn't
# enforced there -- only reported, if it happens to be set, for parity
# with what Netlify's log shows.
if [ "${NETLIFY:-}" = "true" ] && [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN is not set in this build environment." >&2
  echo "Site configuration -> Environment variables -> add SUPABASE_ACCESS_TOKEN (exact name, case-sensitive)." >&2
  exit 1
fi
if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  # Deliberately just a length + first/last couple characters -- enough
  # to confirm *a* token landed and spot an obvious copy-paste mistake
  # (truncation, stray whitespace), never enough to be useful if a build
  # log ever leaked.
  token_len=${#SUPABASE_ACCESS_TOKEN}
  echo "==> SUPABASE_ACCESS_TOKEN is set (length $token_len, starts '${SUPABASE_ACCESS_TOKEN:0:4}...', ends '...${SUPABASE_ACCESS_TOKEN: -4}')"
else
  echo "==> SUPABASE_ACCESS_TOKEN is not set; relying on a cached 'supabase login' session (expected locally, not on Netlify)."
fi

restore_dev_link() {
  if [ "${NETLIFY:-}" = "true" ]; then
    return
  fi
  echo "==> Restoring Supabase CLI link to dev project ($DEV_PROJECT_REF)..."
  npx supabase link --project-ref "$DEV_PROJECT_REF"
}
trap restore_dev_link EXIT

echo "==> Building frontend (production mode)..."
vite build

echo "==> Linking Supabase CLI to production project ($PROD_PROJECT_REF)..."
npx supabase link --project-ref "$PROD_PROJECT_REF"

echo "==> Applying pending database migrations to production..."
# Idempotent either way: against a brand-new project with no migrations
# recorded yet, this applies every migration in order (first-time setup);
# against one that's already up to date through some earlier point, it
# only applies whatever's new since then (redeploy).
npx supabase db push

echo "==> Deploying edge functions to production..."
npx supabase functions deploy chat manage-user recompute-caller-profiles \
  --project-ref "$PROD_PROJECT_REF"

echo "==> Production deploy complete."
