import { jsonResponse } from './http.ts';

// Shared between every edge function that needs per-user rate limiting
// and/or the suspicious-activity heuristics -- originally lived only in
// `chat/index.ts`, factored out here once `manage-user` needed the same
// checks, so the two can't drift apart. Each function still owns its own
// bucket name(s) and limit value(s) -- see its own constants -- this just
// shares the RPC-calling and response-shaping code itself.

export const SUSPICIOUS_IP_CHANGE_WINDOW_SECONDS = 10;

// Exponential backoff for repeated rate-limit violations: the more a user
// exceeds the limit within the same window, the longer they're told to
// wait, rather than a fixed cooldown.
export const BACKOFF_BASE_SECONDS = 2;
export const BACKOFF_MAX_SECONDS = 300;

// Coarse, deliberately conservative bot signals -- an empty/missing
// User-Agent, or one naming a known HTTP client/scraper library rather
// than a browser. Trivially spoofable, so this is one signal among
// several, not a sole gate.
export const BOT_USER_AGENT_PATTERNS = [
  /^$/,
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /^go-http-client/i,
  /\bbot\b/i,
  /spider/i,
  /crawler/i,
  /headlesschrome/i,
  /^okhttp/i,
];

// AI (OpenRouter/Jev) usage quota, shared for the same reason as the rate
// limit / suspicious-activity checks above -- both `chat` (chat replies,
// summaries) and `recompute-caller-profiles` (bulk Jev recompute) spend
// from it.
export const AI_DAILY_LIMIT = 120;

export interface AiUsageResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
}

export async function checkAiUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  limit: number,
): Promise<AiUsageResult> {
  const { data, error } = await supabase
    .rpc('increment_ai_usage', { p_limit: limit })
    .single();

  if (error) {
    // Same fail-open reasoning as checkRateLimit.
    console.error('AI usage check failed -- allowing request', error);
    return { allowed: true, currentCount: 0, limit };
  }

  return { allowed: data.allowed, currentCount: data.current_count, limit };
}

function secondsUntilNextUtcMidnight(): number {
  const now = new Date();
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(0, Math.round((nextMidnight - now.getTime()) / 1000));
}

export function aiQuotaExceededResponse(result: AiUsageResult): Response {
  const retryAfterSeconds = secondsUntilNextUtcMidnight();

  return jsonResponse(
    {
      error: `You've reached your daily limit of ${result.limit} AI-assisted messages. Your quota resets at midnight UTC.`,
      retryAfterSeconds,
    },
    429,
    { 'Retry-After': String(retryAfterSeconds) },
  );
}

export interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
}

export async function checkRateLimit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  bucket: 'read' | 'write' | 'account',
  limit: number,
): Promise<RateLimitResult> {
  const { data, error } = await supabase
    .rpc('increment_rate_limit', { p_bucket: bucket, p_limit: limit })
    .single();

  if (error) {
    // Fail *open*: an outage in the abuse-prevention plumbing itself
    // shouldn't take the calling feature down with it. Logged either way.
    console.error('Rate limit check failed -- allowing request', error);
    return { allowed: true, currentCount: 0, limit };
  }

  return { allowed: data.allowed, currentCount: data.current_count, limit };
}

export function rateLimitExceededResponse(result: RateLimitResult): Response {
  // See BACKOFF_BASE_SECONDS/BACKOFF_MAX_SECONDS above: a single request
  // just over the line gets a short wait; someone hammering the endpoint
  // gets told to wait longer with each additional attempt.
  const overage = Math.max(1, result.currentCount - result.limit);
  const retryAfterSeconds = Math.min(
    BACKOFF_MAX_SECONDS,
    Math.round(BACKOFF_BASE_SECONDS * 2 ** (overage - 1)),
  );

  return jsonResponse(
    {
      error: `You're sending requests too quickly. Please wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'} and try again.`,
      retryAfterSeconds,
    },
    429,
    { 'Retry-After': String(retryAfterSeconds) },
  );
}

export async function checkSuspiciousActivity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  req: Request,
): Promise<boolean> {
  if (looksLikeBot(req.headers.get('user-agent'))) {
    return true;
  }

  const ip = getClientIp(req);
  if (!ip) {
    // No IP to compare against -- nothing to flag on that signal, and no
    // record to update either.
    return false;
  }

  const { data, error } = await supabase.rpc('check_suspicious_ip_change', {
    p_ip: ip,
    p_window_seconds: SUSPICIOUS_IP_CHANGE_WINDOW_SECONDS,
  });

  if (error) {
    console.error(
      'Suspicious-activity IP check failed -- allowing request',
      error,
    );
    return false;
  }

  return Boolean(data);
}

function looksLikeBot(userAgent: string | null): boolean {
  if (!userAgent || !userAgent.trim()) {
    return true;
  }
  return BOT_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

function getClientIp(req: Request): string | null {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  return req.headers.get('x-real-ip');
}
