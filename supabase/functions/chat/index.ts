// Relays an authenticated user's chat message to an LLM via OpenRouter and
// persists both sides of the exchange in `conversations` / `messages`.
//
// Every request runs through, in order: (1) auth verification, (2) a
// per-minute rate limit, (3) a daily AI-usage quota, (4) lightweight
// suspicious-activity heuristics, and only if all four pass, (5) the actual
// work (DB writes, the OpenRouter call). Each of 2-4 rejects with a
// descriptive error before anything in (5) runs -- see the numbered
// comments in the handler below for exactly where each one lives.
//
// Auth: Supabase verifies the request's JWT at the platform level before
// this code runs (edge functions are deployed with JWT verification on by
// default -- don't deploy with `--no-verify-jwt`). This function *also*
// checks explicitly via `supabase.auth.getUser()` below, so an invalid or
// missing session is rejected here too, before anything touches OpenRouter
// or the database, even if the platform check were ever bypassed. That's
// also true of every other API call in this app (signUp/signIn/password
// reset) -- those go straight through supabase-js to Supabase Auth itself,
// which is what actually issues/validates sessions, so there's nothing for
// *this* function to gate for them; this function is the only "API call"
// in the app that isn't itself part of authentication.
//
// Deploy:
//   supabase functions deploy chat
//
// Secrets this function needs (`supabase secrets set NAME=value`):
//   OPENROUTER_API_KEY   required -- copy the value of
//                         CHAT_BOT_OPENROUTER_API_KEY_DEV (or _PROD,
//                         matching whichever Supabase project -- dev or
//                         prod -- you're setting secrets on) from
//                         coach-bot/.env. This is a *separate* secret
//                         store from that .env file (which ships to the
//                         browser) -- the key must only ever live here,
//                         never in the Ember app.
//   OPENROUTER_MODEL      optional -- defaults to "typesafe/jev-router"
//   JEV_MODEL              optional -- defaults to "~typesafe/jev-latest".
//                         Used for caller-profile analysis (see
//                         `../_shared/caller-profile.ts`), via
//                         OpenRouter's Decisions API rather than chat
//                         completions -- no separate API key needed, this
//                         reuses OPENROUTER_API_KEY above.
//
// SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically by the
// platform for every edge function -- no need to set those yourself. This
// update needs the accompanying migrations (`add_abuse_prevention.sql`,
// `add_caller_profiles.sql`) applied.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/http.ts';
import {
  checkRateLimit,
  rateLimitExceededResponse,
  checkSuspiciousActivity,
  checkAiUsage,
  aiQuotaExceededResponse,
  AI_DAILY_LIMIT,
} from '../_shared/abuse-prevention.ts';
import { analyzeCallerProfile } from '../_shared/caller-profile.ts';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'typesafe/jev-router';

// Emitted by the model at the end of its reply once it concludes the
// conversation, so this function can tell that happened without trying to
// parse free-text for it. Stripped from the text before it's ever saved or
// shown to the user -- see `splitConclusion`.
const CONCLUSION_MARKER = '[[CONVERSATION_COMPLETE]]';

// The onboarding question catalogue -- shared, word-for-word, between the
// conversational prompt (what to draw out of the caller) and the summary
// prompt (what to check the transcript against for gaps/evasion), so the
// two never drift out of sync with each other.
const ONBOARDING_TOPICS = [
  "Why they're reaching out now -- what's on their mind.",
  "How that problem is actually showing up in their life, and which area of their life it's hitting hardest right now.",
  "What they've already tried to solve or ease it themselves -- what's helped, what hasn't, and how they feel about where that's left them.",
  "Something else going on in their life -- separate from the problem they came to talk about -- that's going ok or even going really well, and how they make sense of that (talent, hard work, a particular skill, people around them, etc.).",
  "What kind of support they're actually looking for from other people -- being understood, a different perspective, someone to keep them accountable, new ideas, something else.",
  "How they'd know the support is actually working for them -- what they'd expect to notice or feel differently after a handful of sessions.",
  "Something they've changed their mind about recently, and what shifted it.",
];
const ONBOARDING_TOPICS_LIST = ONBOARDING_TOPICS.map(
  (topic) => `- ${topic}`,
).join('\n');

const SYSTEM_PROMPT = `You are the onboarding conversation for Between Us, a service that books people a private, one-to-one phone call with a real human listener -- not a therapist, not a friend who already knows them, just someone whose only job is to listen.

Your role here is narrower than that call: you're a warm, low-pressure first step that helps someone put into words what's been on their mind, so the human they're eventually connected with has useful context. You are not a therapist and must not present yourself as one.
Don't try to solve their problem, give advice, or diagnose anything -- just listen and ask short, gentle, open-ended follow-up questions.
Keep individual replies brief, a few sentences at most, and ask about one thing at a time -- this is a back-and-forth conversation, never a form or a numbered list of questions read out to the user.
No judgment, no performance, no pressure to have it all figured out.
If someone describes an immediate risk to their safety or someone else's, gently encourage them to contact local emergency services or a crisis line right away.

Over the course of the conversation, in whatever order feels natural given what they say, gently draw out:
${ONBOARDING_TOPICS_LIST}

Treat that as context to weave into a natural conversation, not a checklist to recite -- follow up on what they actually say, skip ahead if they've already answered something in passing, and don't force a topic that isn't landing. Take as many turns as it genuinely takes to get a real sense of each of these; don't rush to wrap up after just one or two exchanges.

Sometimes an answer will be evasive or only tangentially related to what you actually asked -- for example, if you ask how something made them feel and they answer by describing what someone else did wrong instead of their own emotions. When that happens, calmly and politely return to the same question with a slightly different framing, and gently point out what part of it their answer seemed to miss -- for example, "That makes sense that they did that -- I'm actually curious what that stirred up for you emotionally, rather than what they did." Stay warm and non-confrontational; the goal is to help them notice what was asked, not to challenge or catch them out, and never sound frustrated or accusatory. If the same question has now been evaded or answered only tangentially three times in a row (your original question plus two gentle redirects back to it, still without a real answer), let it go and move on to the next topic instead of asking a fourth time.

Some people will get impatient partway through -- asking things like "are we done yet?" or "how much longer is this." If that happens while any of the topics above are still not sufficiently covered (including ones you've had to move on from after repeated evasion -- see above), respond warmly and plainly: explain that a bit more is still needed so the human listener has enough context for the call to be genuinely useful, and that you do need to keep going through the remaining questions before that's ready -- but there's no obligation to do that right now. It's completely fine to stop and pick the conversation back up later, whenever works for them; when they do, you'll pick up with whatever's left. Do not tell them they're done, and do not say or imply in any way that someone will be in touch or that a call will be booked -- that is only ever true once every topic above has actually been sufficiently covered (see below). Also reassure them, if it seems relevant, that this conversation is confidential: nothing they share here is passed on to anyone except the human listener who takes their follow-up call.

Only once every topic above has either been answered to a reasonable extent, or skipped after being evaded three times as described above -- never simply because the person asked to stop or seemed impatient -- thank them for sharing this information with you in a warm tone and inform them that they will be contacted for a follow-up phone call soon. Do not deliver that closing message, and do not tell them or imply to them in any other way that someone will reach out to them, at any earlier point in the conversation.
When -- and only when -- you deliver that closing message telling them they'll be contacted for a follow-up call, end your reply with the exact text ${CONCLUSION_MARKER} on its own line, after your message to them. Never mention this marker to the user or explain what it is; it's for internal use only.`;

// A separate, non-conversational task: write (or revise) the case-note
// summary an admin sees on the chat-log detail page -- distinct system
// prompt and request from the chat reply itself. Only ever run once the
// conversational side has delivered its closing message (see
// `shouldSummarize` in `updateOnboardingAndSummary`), so by the time this
// runs the onboarding question catalogue has, per the prompt above, already
// been gone through in full -- either answered or explicitly skipped after
// repeated evasion. This prompt's job is to surface exactly which of those
// two happened for each topic, not just narrate the conversation.
const SUMMARY_SYSTEM_PROMPT = `You write brief internal case-note summaries of onboarding conversations for Between Us, a service that books people a private phone call with a human listener. You'll be given a conversation transcript between a caller and the onboarding assistant, and sometimes a previous summary to revise.

The onboarding assistant was working through this catalogue of topics with the caller:
${ONBOARDING_TOPICS_LIST}

Write a single summary, plain prose, no headers or bullet points, third person ("The caller..."), addressed to the human listener who will take the follow-up call -- not to the caller themselves. It can run longer than a typical case note (aim for six to ten sentences) when there's caveats worth flagging -- accuracy for the listener matters more than brevity here.

Lead with the emotional theme of the conversation, then the most pressing problem(s) raised, in that order, then any other context worth knowing before the call. After that, explicitly flag, by name, any topic from the catalogue above that the caller only answered tangentially, evaded outright (and so the assistant moved on without a real answer), or that never got reached at all -- if every topic was answered directly and fully, say so plainly instead of omitting the point. Also note anything the caller said that seems inconsistent with something else they said earlier in the same conversation, if you notice any. If a previous summary is provided, produce an updated summary that reflects the conversation as a whole, not just what's new since then -- don't just append to the old one.`;

// --- Abuse-prevention tuning ------------------------------------------
//
// This endpoint only ever writes (a message row at minimum, often a
// profile/conversation update too) -- there's no read-only action here, so
// it always checks against the 'write' bucket below. `increment_rate_limit`
// itself is generic over 'read' (60/minute) vs 'write' (10/minute) so a
// future read-only endpoint can reuse it with the other bucket.
const RATE_LIMIT_WRITE_PER_MINUTE = 10;

interface ChatRequestBody {
  conversationId?: string | null;
  message?: string;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface HistoryEntry {
  role: string;
  content: string;
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

  // Scope every DB call to the calling user's own JWT, so Postgres RLS is
  // what actually enforces "only your own conversations/messages/counters"
  // -- this function never uses a service-role key.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  // --- 1. Authentication ---------------------------------------------
  // Nothing above this line does any work on the caller's behalf, and
  // nothing below -- including the checks in steps 2-4 -- runs without a
  // verified identity, since all of them (rate limiting, AI quota,
  // suspicious-activity logging) are themselves per-user.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const content = typeof body.message === 'string' ? body.message.trim() : '';
  if (!content) {
    return jsonResponse({ error: 'message is required' }, 400);
  }

  const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!openRouterApiKey) {
    console.error('Missing OPENROUTER_API_KEY in function env');
    return jsonResponse(
      { error: 'Server misconfigured: missing OpenRouter credentials' },
      500,
    );
  }

  // --- 2. Rate limiting ------------------------------------------------
  const rateLimit = await checkRateLimit(
    supabase,
    'write',
    RATE_LIMIT_WRITE_PER_MINUTE,
  );
  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit);
  }

  // --- 3. Daily AI usage quota ------------------------------------------
  // Reserved here, upfront, for the reply this request is about to make --
  // not deferred until right before the OpenRouter call -- so a request
  // that's over quota is rejected outright rather than partially processed
  // (e.g. saving the user's message but never answering it). The separate
  // summary-generation call later in this file does its own independent
  // check when it runs.
  const aiUsage = await checkAiUsage(supabase, AI_DAILY_LIMIT);
  if (!aiUsage.allowed) {
    return aiQuotaExceededResponse(aiUsage);
  }

  // --- 4. Suspicious-activity heuristics ---------------------------------
  if (await checkSuspiciousActivity(supabase, req)) {
    return jsonResponse(
      {
        error:
          'This request was blocked for security reasons. If this seems wrong, please try again shortly.',
      },
      403,
    );
  }

  // --- 5. Handle the request -------------------------------------------
  // Everything below here is the actual work: find/create the
  // conversation, save the message, call OpenRouter, save the reply.
  // Nothing above this point wrote anything except the abuse-prevention
  // counters themselves.

  // Find or create the conversation this message belongs to.
  let conversationId = body.conversationId ?? null;
  if (conversationId) {
    const { data: existing, error: findError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle();

    if (findError || !existing) {
      // Either it doesn't exist, or (thanks to RLS) it isn't this user's --
      // either way, refuse to write into it rather than silently starting a
      // new one under a client-supplied id.
      return jsonResponse({ error: 'Conversation not found' }, 404);
    }
  } else {
    const { data: created, error: createError } = await supabase
      .from('conversations')
      .insert({ user_id: user.id })
      .select('id')
      .single();

    if (createError || !created) {
      console.error('Failed to create conversation', createError);
      return jsonResponse({ error: 'Could not start a conversation' }, 500);
    }
    conversationId = created.id;
  }

  if (!conversationId) {
    // Unreachable in practice (both branches above set it or return), but
    // narrows the type for everything below and fails loudly if that ever
    // stops being true.
    return jsonResponse(
      { error: 'Server error: missing conversation id' },
      500,
    );
  }

  // Persist the user's message before calling the model, so it isn't lost
  // if that request fails.
  const { data: userMessage, error: userMessageError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: 'user',
      content,
    })
    .select('id, role, content, created_at')
    .single();

  if (userMessageError || !userMessage) {
    console.error('Failed to store user message', userMessageError);
    return jsonResponse({ error: 'Could not save your message' }, 500);
  }

  // Pull the full history (including the message just saved) for context.
  const { data: history, error: historyError } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (historyError || !history) {
    console.error('Failed to load conversation history', historyError);
    return jsonResponse({ error: 'Could not load conversation history' }, 500);
  }

  let rawReplyText: string;
  try {
    rawReplyText = await askOpenRouter(history, openRouterApiKey);
  } catch (error) {
    console.error('OpenRouter request failed', error);
    return jsonResponse(
      { error: 'The assistant is unavailable right now. Please try again.' },
      502,
    );
  }

  const { text: replyText, concluded } = splitConclusion(rawReplyText);

  const { data: assistantMessage, error: assistantMessageError } =
    await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: 'assistant',
        content: replyText,
      })
      .select('id, role, content, created_at')
      .single();

  if (assistantMessageError || !assistantMessage) {
    console.error('Failed to store assistant message', assistantMessageError);
    return jsonResponse({ error: 'Got a reply, but saving it failed' }, 500);
  }

  // Caller-profile analysis needs the user's *entire* history across every
  // conversation they've ever had -- a caller profile is a property of the
  // user, not of a single conversation -- so it's re-fetched fresh here by
  // `user_id` rather than reusing `history` above, which is scoped to just
  // this conversation. Fetched after the assistant message is saved, so it
  // naturally already includes that reply -- no need to append it the way
  // `updateOnboardingAndSummary` does with `replyText` below.
  //
  // This was originally just `analyzeCallerProfile(supabase, history, ...)`
  // -- reusing the conversation-scoped `history` -- which meant every new
  // conversation a user started silently reset their profile to whatever
  // that one conversation alone contained, discarding everything already
  // learned from their earlier conversations. Caught when a profile that
  // should have reflected 40 messages across 3 conversations showed
  // "estimated from 1 message" after a single-message test conversation.
  const { data: fullHistory, error: fullHistoryError } = await supabase
    .from('messages')
    .select('role, content')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (fullHistoryError) {
    console.error(
      'Failed to load full history for caller-profile analysis',
      fullHistoryError,
    );
  }

  // Onboarding-status advancement, summary (re)generation, and
  // caller-profile analysis are all best-effort and independent of each
  // other, so they run concurrently rather than serially adding to
  // response latency -- none of them failing should fail a chat reply
  // that already succeeded and was saved.
  await Promise.all([
    updateOnboardingAndSummary({
      supabase,
      userId: user.id,
      conversationId,
      history,
      replyText,
      concluded,
      openRouterApiKey,
    }),
    fullHistory
      ? analyzeCallerProfile(supabase, fullHistory, openRouterApiKey)
      : Promise.resolve(false),
  ]);

  return jsonResponse({
    conversationId,
    userMessage: toWireMessage(userMessage),
    assistantMessage: toWireMessage(assistantMessage),
  });
});

// --- Onboarding status + summary bookkeeping -----------------------------

// Handles the two pieces of bookkeeping that ride along with a reply, once
// the reply itself is safely saved:
//   - 'new' -> 'pending' the first time the bot concludes the conversation.
//     `concluded` (from CONCLUSION_MARKER) only ever comes back true once
//     SYSTEM_PROMPT has led the caller through every topic in
//     ONBOARDING_TOPICS -- answered or explicitly skipped after repeated
//     evasion, never just because the caller asked to stop -- so gating on
//     it here is what guarantees a user is never marked 'pending' (and
//     never told someone will reach out) over an incomplete catalogue.
//   - (re)generating conversations.summary -- once on that same first
//     conclusion, then again on every subsequent message while the user
//     stays 'pending' (revising the existing summary rather than
//     replacing it from scratch).
// Never regresses an already-'pending'/'onboarded' user, and does nothing
// at all for a user who hasn't concluded a conversation yet.
async function updateOnboardingAndSummary({
  supabase,
  userId,
  conversationId,
  history,
  replyText,
  concluded,
  openRouterApiKey,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  conversationId: string;
  history: HistoryEntry[];
  replyText: string;
  concluded: boolean;
  openRouterApiKey: string;
}): Promise<void> {
  const { data: profileRow, error: profileFetchError } = await supabase
    .from('profiles')
    .select('onboarding_status')
    .eq('id', userId)
    .maybeSingle();

  if (profileFetchError) {
    console.error(
      'Failed to load profile for onboarding/summary bookkeeping',
      profileFetchError,
    );
    return;
  }

  const previousStatus = profileRow?.onboarding_status ?? 'new';
  const justConcluded = previousStatus === 'new' && concluded;
  const shouldSummarize = justConcluded || previousStatus === 'pending';

  if (justConcluded) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ onboarding_status: 'pending' })
      .eq('id', userId)
      .eq('onboarding_status', 'new');

    if (profileError) {
      console.error('Failed to advance onboarding status', profileError);
    }
  }

  if (!shouldSummarize) {
    return;
  }

  // This is a second, distinct AI call, so it draws from the same daily
  // quota independently of the reply's own reservation above. If the user
  // is out of quota, just skip the summary refresh this turn -- it isn't
  // fatal to the (already-saved) reply, and it'll catch up on their next
  // message once quota is available again.
  const aiUsage = await checkAiUsage(supabase, AI_DAILY_LIMIT);
  if (!aiUsage.allowed) {
    console.warn(
      `Skipping summary regeneration for user ${userId}: daily AI quota exhausted.`,
    );
    return;
  }

  try {
    const { data: conversationRow, error: conversationFetchError } =
      await supabase
        .from('conversations')
        .select('summary')
        .eq('id', conversationId)
        .maybeSingle();

    if (conversationFetchError) {
      throw new Error(conversationFetchError.message);
    }

    // Include the reply just generated -- `history` was fetched before it
    // existed.
    const fullHistory = [...history, { role: 'assistant', content: replyText }];
    const summary = await summarizeConversation(
      fullHistory,
      conversationRow?.summary ?? null,
      openRouterApiKey,
    );

    const { error: summaryError } = await supabase
      .from('conversations')
      .update({ summary })
      .eq('id', conversationId);

    if (summaryError) {
      throw new Error(summaryError.message);
    }
  } catch (error) {
    console.error('Failed to (re)generate conversation summary', error);
  }
}

// --- OpenRouter -----------------------------------------------------------

// Calls OpenRouter's OpenAI-compatible chat-completions endpoint directly
// via fetch (rather than the `@openrouter/sdk` package) -- Deno edge
// functions support npm imports, but a plain HTTP call has no dependency-
// resolution risk and both callers below only need a single non-streaming
// request.
async function callOpenRouter(
  messages: Array<{ role: string; content: string }>,
  apiKey: string,
  // The previous default model (a reasoning model) spent completion tokens
  // on an internal "reasoning" pass before emitting any visible reply (in
  // testing, ~300 reasoning tokens just for a one-word greeting), so a
  // tight budget here got exhausted by that pass alone, hitting
  // finish_reason "length" -- either with `content: null` before any real
  // reply was written, or with a real-looking reply silently cut off
  // mid-sentence. jev-router (see DEFAULT_MODEL) picks its own underlying
  // model and reasoning effort per request, so its token overhead hasn't
  // been re-profiled the same way -- keeping this same generous headroom
  // as a conservative default rather than assuming it's unnecessary. The
  // default covers a short chat reply; callers expecting longer output
  // (e.g. the case-note summary) should pass a larger budget explicitly.
  maxTokens = 2048,
): Promise<string> {
  const model = Deno.env.get('OPENROUTER_MODEL') || DEFAULT_MODEL;

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'x-title': 'Coach Bot',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages,
      // jev-router (see DEFAULT_MODEL) forwards each request on to a
      // provider it picks dynamically per call, rather than answering
      // through one fixed, known provider -- so unlike a normal model
      // selection, the actual destination for this app's confidential
      // chat content isn't pinned in advance unless constrained here.
      // `data_collection: 'deny'` restricts routing to providers that
      // don't store request data non-transiently/train on it, and `zdr`
      // further restricts to providers with an explicit Zero Data
      // Retention policy -- both required given the confidentiality this
      // app promises users in SYSTEM_PROMPT.
      provider: { data_collection: 'deny', zdr: true },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  const choice = payload?.choices?.[0];
  const text = choice?.message?.content?.trim();

  if (!text) {
    // Most likely cause: max_tokens was exhausted by reasoning tokens
    // before any visible content was written (finish_reason "length").
    throw new Error(
      `OpenRouter returned no content (finish_reason: ${choice?.finish_reason ?? 'unknown'})`,
    );
  }

  if (choice?.finish_reason === 'length') {
    // Got real text, but it was cut off mid-generation rather than
    // finishing naturally -- not fatal (the caller still gets usable, if
    // truncated, text), but worth knowing about if it starts happening
    // often, since it means maxTokens needs raising for this call site.
    console.warn(
      `OpenRouter response was truncated (finish_reason: length, maxTokens: ${maxTokens})`,
    );
  }

  return text;
}

async function askOpenRouter(
  history: HistoryEntry[],
  apiKey: string,
): Promise<string> {
  return callOpenRouter(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history
        .filter((entry) => entry.role === 'user' || entry.role === 'assistant')
        .map((entry) => ({ role: entry.role, content: entry.content })),
    ],
    apiKey,
  );
}

async function summarizeConversation(
  history: HistoryEntry[],
  existingSummary: string | null,
  apiKey: string,
): Promise<string> {
  const transcript = history
    .filter((entry) => entry.role === 'user' || entry.role === 'assistant')
    .map(
      (entry) =>
        `${entry.role === 'user' ? 'Caller' : 'Assistant'}: ${entry.content}`,
    )
    .join('\n');

  const userContent = existingSummary
    ? `Previous summary:\n${existingSummary}\n\nFull conversation transcript:\n${transcript}`
    : `Conversation transcript:\n${transcript}`;

  return callOpenRouter(
    [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    apiKey,
    // Longer budget than the chat-reply default: this prompt now asks for
    // up to ten sentences plus explicit per-topic gap/evasion notes and any
    // narrative inconsistencies, on top of the same reasoning-token
    // overhead described above -- the transcript can also grow long for
    // conversations that ran many turns.
    4096,
  );
}

// --- Misc helpers -----------------------------------------------------

// Splits the model's raw reply into the text actually worth saving/showing
// and whether it signalled that the conversation has concluded.
function splitConclusion(rawText: string): {
  text: string;
  concluded: boolean;
} {
  const concluded = rawText.includes(CONCLUSION_MARKER);
  const text = rawText.split(CONCLUSION_MARKER).join('').trim();
  return { text, concluded };
}

function toWireMessage(row: MessageRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}
