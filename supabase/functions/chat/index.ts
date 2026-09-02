// Relays an authenticated user's chat message to an LLM via OpenRouter and
// persists both sides of the exchange in `conversations` / `messages`.
//
// Auth: Supabase verifies the request's JWT at the platform level before
// this code runs (edge functions are deployed with JWT verification on by
// default -- don't deploy with `--no-verify-jwt`). This function *also*
// checks explicitly via `supabase.auth.getUser()` below, so an invalid or
// missing session is rejected here too, before anything touches OpenRouter
// or the database, even if the platform check were ever bypassed.
//
// Deploy:
//   supabase functions deploy chat
//
// Secrets this function needs (`supabase secrets set NAME=value`):
//   OPENROUTER_API_KEY   required -- copy the value of
//                         CHAT_BOT_OPENROUTER_API_KEY from coach-bot/.env.
//                         This is a *separate* secret store from that .env
//                         file (which ships to the browser) -- the key must
//                         only ever live here, never in the Ember app.
//   OPENROUTER_MODEL      optional -- defaults to
//                         "inception/mercury-2.5-preview"
//
// SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically by the
// platform for every edge function -- no need to set those yourself.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'inception/mercury-2.5-preview';

const SYSTEM_PROMPT = `You are the onboarding conversation for Between Us, a service that books people a private, one-to-one phone call with a real human listener -- not a therapist, not a friend who already knows them, just someone whose only job is to listen.

Your role here is narrower than that call: you're a warm, low-pressure first step that helps someone put into words what's been on their mind, so the human they're eventually connected with has useful context. You are not a therapist and must not present yourself as one. 
Don't try to solve their problem, give advice, or diagnose anything -- just listen and ask short, gentle, open-ended follow-up questions. 
Keep replies brief, a few sentences at most. 
No judgment, no performance, no pressure to have it all figured out. 
If someone describes an immediate risk to their safety or someone else's, gently encourage them to contact local emergency services or a crisis line right away.
Try to collect enough information to give enough information to start a follow-up conversation in call afterwards, but do not overdo it.
If you get the impression that the general problem, the person wants to talk about has already been outlined sufficiently,
thank them for sharing this information with you in a warm tone and inform them, that they will be contacted for a follow up phone call soon.`;

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
  // what actually enforces "only your own conversations/messages" -- this
  // function never uses a service-role key.
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

  // Nothing above this line does any work on the user's behalf. Only an
  // authenticated request reaches here, and only from here on do we touch
  // the database or call OpenRouter.

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

  let replyText: string;
  try {
    replyText = await askOpenRouter(history, openRouterApiKey);
  } catch (error) {
    console.error('OpenRouter request failed', error);
    return jsonResponse(
      { error: 'The assistant is unavailable right now. Please try again.' },
      502,
    );
  }

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

  return jsonResponse({
    conversationId,
    userMessage: toWireMessage(userMessage),
    assistantMessage: toWireMessage(assistantMessage),
  });
});

// Calls OpenRouter's OpenAI-compatible chat-completions endpoint directly
// via fetch (rather than the `@openrouter/sdk` package) -- Deno edge
// functions support npm imports, but a plain HTTP call has no dependency-
// resolution risk and this only needs a single non-streaming request.
async function askOpenRouter(
  history: Array<{ role: string; content: string }>,
  apiKey: string,
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
      // Mercury is a reasoning model: it spends completion tokens on an
      // internal "reasoning" pass before emitting any visible reply (in
      // testing, ~300 reasoning tokens just for a one-word greeting). A
      // tight budget here gets exhausted by that pass alone, hitting
      // finish_reason "length" with `content: null` before any real reply
      // is written -- so this needs real headroom, not just enough for a
      // few sentences of visible text.
      max_tokens: 2048,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history
          .filter(
            (entry) => entry.role === 'user' || entry.role === 'assistant',
          )
          .map((entry) => ({ role: entry.role, content: entry.content })),
      ],
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

  return text;
}

function toWireMessage(row: MessageRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
