// Admin-only bulk recompute of `caller_profiles` against each target
// user's *existing* message history, using the current scoring
// methodology in `_shared/caller-profile.ts`. Exists for exactly this
// situation: that methodology changes (e.g. neuroticism split into three
// sub-questions -- see that file), and the profiles already computed
// under the old methodology need to catch up with it without waiting for
// each affected user to send a new message.
//
// POST with an optional JSON body `{ "userIds": ["...", ...] }` to scope
// the recompute to specific users; omit it (or omit `userIds`) to
// recompute every user who has sent at least one message. Requires the
// caller to be an admin -- runs through the same auth/rate-limit/
// suspicious-activity pipeline as `chat` and `manage-user` (see
// `_shared/`), rejecting with 403 if the caller isn't one.
//
// Deploy:
//   supabase functions deploy recompute-caller-profiles
//
// Secrets: OPENROUTER_API_KEY (same one `chat` uses), SUPABASE_URL,
// SUPABASE_ANON_KEY -- all already required/injected for `chat`, nothing
// new to set. Needs `add_admin_caller_profile_recompute` (well,
// `20260930180000_allow_admin_caller_profile_recompute.sql`) applied,
// since it calls `upsert_caller_profile` with an explicit `p_user_id`,
// which that migration is what allows for an admin caller.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/http.ts';
import {
  checkRateLimit,
  rateLimitExceededResponse,
  checkSuspiciousActivity,
} from '../_shared/abuse-prevention.ts';
import {
  analyzeCallerProfile,
  type HistoryEntry,
} from '../_shared/caller-profile.ts';

// Same bucket as `manage-user` -- this is also an infrequent, deliberate
// admin action rather than routine traffic, so chat's much higher write
// limit isn't the right fit, and sharing manage-user's 'account' bucket
// (rather than inventing a third) keeps the bucket list from growing
// unnecessarily.
const RATE_LIMIT_ACCOUNT_PER_MINUTE = 5;

interface RecomputeRequestBody {
  userIds?: string[] | null;
}

interface RecomputeResult {
  userId: string;
  messagesAnalyzed: number;
  success: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY in function env');
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

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

  if (user.app_metadata?.role !== 'admin') {
    // A plain 403 (not a 404 like the admin-area Ember routes) -- this is
    // an API a non-admin has no legitimate reason to be probing for in
    // the first place, unlike a page whose existence is worth masking.
    return jsonResponse({ error: 'Admin access required.' }, 403);
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

  const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!openRouterApiKey) {
    console.error('Missing OPENROUTER_API_KEY in function env');
    return jsonResponse(
      { error: 'Server misconfigured: missing OpenRouter credentials' },
      500,
    );
  }

  let body: RecomputeRequestBody = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const targetUserIds =
    body.userIds && body.userIds.length > 0
      ? body.userIds
      : await loadAllCallerIds(supabase);

  if (targetUserIds.length === 0) {
    return jsonResponse({ results: [], succeeded: 0, failed: 0 });
  }

  const results: RecomputeResult[] = [];
  for (const targetUserId of targetUserIds) {
    const history = await loadUserHistory(supabase, targetUserId);
    const success = await analyzeCallerProfile(
      supabase,
      history,
      openRouterApiKey,
      { targetUserId },
    );
    results.push({
      userId: targetUserId,
      messagesAnalyzed: history.filter((entry) => entry.role === 'user').length,
      success,
    });
  }

  const succeeded = results.filter((result) => result.success).length;

  return jsonResponse({
    results,
    succeeded,
    failed: results.length - succeeded,
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAllCallerIds(supabase: any): Promise<string[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('user_id')
    .eq('role', 'user');

  if (error) {
    console.error('Failed to load caller ids for recompute', error);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids = (data ?? []).map((row: any) => row.user_id as string);
  return [...new Set(ids)];
}

async function loadUserHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`Failed to load message history for user ${userId}`, error);
    return [];
  }

  return data ?? [];
}
