// Lets a user edit or delete their own account record, or -- for admins --
// anyone's. See the `update_profile` RPC in `add_user_management.sql` for
// the exact permission matrix this enforces on edits; deletes are
// enforced directly in this file (see `handleDelete` for why that can't
// live in a RPC the way the edit path does).
//
// Two operations, routed by HTTP method:
//   PATCH  -- edit `fullName` and/or (admin only) `onboardingStatus`. Any
//             other field in the request body is ignored -- there is no
//             path to editing e.g. `email` here at all.
//   DELETE -- delete the account entirely: the `auth.users` row and
//             everything that cascades off it (`profiles`, `conversations`,
//             `messages`, `caller_profiles`, and the abuse-prevention
//             counters -- see each of their own migrations for the `on
//             delete cascade` this relies on). Irreversible.
//
// Both go through the same shape of pipeline as `chat`: auth verification,
// a per-minute rate limit (its own 'account' bucket, stricter than chat's
// -- see the migration), and the suspicious-activity heuristics -- see
// `_shared/abuse-prevention.ts`, shared with `chat` so the two can't drift
// apart.
//
// Deploy:
//   supabase functions deploy manage-user
//
// Secrets this function needs (`supabase secrets set NAME=value`):
//   SUPABASE_SERVICE_ROLE_KEY   required for DELETE only -- injected
//                                automatically by the platform for every
//                                edge function already, so nothing to set
//                                by hand. Used *only* after the permission
//                                check below has already passed using the
//                                caller's own JWT -- see the comment above
//                                `handleDelete` for why this function
//                                needs it at all when the rest of this app
//                                deliberately never does.
//
// SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically too. Needs
// the accompanying migration (`add_user_management.sql`) applied.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/http.ts';
import {
  checkRateLimit,
  rateLimitExceededResponse,
  checkSuspiciousActivity,
} from '../_shared/abuse-prevention.ts';

// Its own bucket (see the migration's widened `rate_limit_counters` bucket
// check), deliberately stricter than chat's 10/minute -- editing or
// deleting an account is consequential enough, and rare enough for a
// legitimate caller, to warrant a tighter limit than ordinary chat writes.
const RATE_LIMIT_ACCOUNT_PER_MINUTE = 5;

const ONBOARDING_STATUSES = ['new', 'pending', 'onboarded'];
const MAX_FULL_NAME_LENGTH = 200;

interface PatchRequestBody {
  userId?: string | null;
  fullName?: string | null;
  onboardingStatus?: string | null;
}

interface DeleteRequestBody {
  userId?: string | null;
}

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  last_sign_in_at: string | null;
  onboarding_status: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY in function env');
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  // Scoped to the caller's own JWT for everything through the permission
  // check below -- this is also the client `handleDelete` uses to verify
  // who's calling and whether they're an admin, *before* it ever
  // constructs the separate elevated client it needs for the delete
  // itself.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const rateLimit = await checkRateLimit(
    supabase,
    'account',
    RATE_LIMIT_ACCOUNT_PER_MINUTE,
  );
  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit);
  }

  if (await checkSuspiciousActivity(supabase, req)) {
    return jsonResponse(
      {
        error:
          'This request was blocked for security reasons. If this seems wrong, please try again shortly.',
      },
      403,
    );
  }

  const isAdmin = user.app_metadata?.role === 'admin';

  if (req.method === 'DELETE') {
    return handleDelete(req, supabaseUrl, user.id, isAdmin);
  }

  return handlePatch(req, supabase, user.id, isAdmin);
});

async function handlePatch(
  req: Request,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  callerId: string,
  isAdmin: boolean,
): Promise<Response> {
  let body: PatchRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const targetUserId = body.userId ?? callerId;

  if (targetUserId !== callerId && !isAdmin) {
    return jsonResponse({ error: 'You can only edit your own account.' }, 403);
  }

  const hasFullName = body.fullName !== undefined && body.fullName !== null;
  const hasOnboardingStatus =
    body.onboardingStatus !== undefined && body.onboardingStatus !== null;

  if (!hasFullName && !hasOnboardingStatus) {
    return jsonResponse(
      { error: 'Provide fullName and/or onboardingStatus to update.' },
      400,
    );
  }

  // Rejected wholesale (nothing written) rather than silently dropping
  // onboardingStatus and applying fullName alone -- a partial apply here
  // would make "why didn't my status change" a silent, confusing bug
  // instead of a clear error.
  if (hasOnboardingStatus && !isAdmin) {
    return jsonResponse(
      { error: 'Only admins can change onboarding status.' },
      403,
    );
  }

  let fullName: string | null = null;
  if (hasFullName) {
    fullName = String(body.fullName).trim();
    if (!fullName || fullName.length > MAX_FULL_NAME_LENGTH) {
      return jsonResponse(
        {
          error: `Name must be between 1 and ${MAX_FULL_NAME_LENGTH} characters.`,
        },
        400,
      );
    }
  }

  let onboardingStatus: string | null = null;
  if (hasOnboardingStatus) {
    onboardingStatus = String(body.onboardingStatus);
    if (!ONBOARDING_STATUSES.includes(onboardingStatus)) {
      return jsonResponse(
        {
          error: `onboardingStatus must be one of: ${ONBOARDING_STATUSES.join(', ')}.`,
        },
        400,
      );
    }
  }

  const { data, error } = await supabase
    .rpc('update_profile', {
      p_user_id: targetUserId,
      p_full_name: fullName,
      p_onboarding_status: onboardingStatus,
    })
    .single();

  if (error) {
    return errorResponseForRpcError(error);
  }

  return jsonResponse({ user: toWireProfile(data) });
}

// `auth.users` isn't reachable through RLS at all -- Supabase doesn't
// expose the `auth` schema over the REST API for *any* role, admin or not
// (see `add_profiles.sql`'s comment on the same point) -- so deleting a
// user is only possible via the Auth Admin API, which requires a
// service-role key. This is the only place in this whole app that uses
// one, and deliberately the last step here: the permission check in
// `Deno.serve` above already ran against the caller's own JWT-scoped
// client, so this elevated client is only ever asked to delete exactly the
// one row that check already authorized -- never anything derived from
// the request without that check having passed first.
async function handleDelete(
  req: Request,
  supabaseUrl: string,
  callerId: string,
  isAdmin: boolean,
): Promise<Response> {
  let body: DeleteRequestBody = {};
  try {
    // Optional body: deleting your own account needs no payload at all.
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const targetUserId = body.userId ?? callerId;

  if (targetUserId !== callerId && !isAdmin) {
    return jsonResponse(
      { error: 'You can only delete your own account.' },
      403,
    );
  }

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY in function env');
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error } = await adminClient.auth.admin.deleteUser(targetUserId);

  if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((error as any).status === 404) {
      return jsonResponse({ error: 'User not found' }, 404);
    }
    console.error('Failed to delete user', error);
    return jsonResponse({ error: 'Could not delete this user.' }, 500);
  }

  return jsonResponse({ deletedUserId: targetUserId });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function errorResponseForRpcError(error: any): Response {
  // Matches the errcodes `update_profile` raises explicitly -- anything
  // else is unexpected and treated as a genuine server error rather than
  // guessed at.
  if (error.code === '42501') {
    return jsonResponse({ error: error.message }, 403);
  }
  if (error.code === 'P0002') {
    return jsonResponse({ error: error.message }, 404);
  }
  if (error.code === '28000') {
    return jsonResponse({ error: error.message }, 401);
  }

  console.error('update_profile RPC failed', error);
  return jsonResponse({ error: 'Could not update this user.' }, 500);
}

function toWireProfile(row: ProfileRow) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    lastSignInAt: row.last_sign_in_at,
    onboardingStatus: row.onboarding_status,
  };
}
