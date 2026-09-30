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
# production instead.

set -euo pipefail

DEV_PROJECT_REF="bqjdlgogxlpkvhsucepp"
PROD_PROJECT_REF="hhqotvloounlbzwdvfhh"

restore_dev_link() {
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
