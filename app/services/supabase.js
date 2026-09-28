import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.CHAT_BOT_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.CHAT_BOT_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase configuration. Set CHAT_BOT_SUPABASE_URL and CHAT_BOT_SUPABASE_ANON_KEY (see .env.development).',
  );
}

// A single shared client instance, as recommended by supabase-js — it holds
// the auth session (persisted to localStorage) and should not be recreated
// per-service-instantiation.
const client = createClient(supabaseUrl, supabaseAnonKey);

// Tracks whether Supabase has told us this browser is here via a password
// recovery link (`resetPasswordForEmail`'s emailed link lands back on
// /reset-password and supabase-js processes it automatically on load,
// firing a one-off `PASSWORD_RECOVERY` auth event). Subscribed here, at
// module scope, so it's registered as early as this file can possibly run
// — before any Ember service/route exists — and can't miss that event if
// the client processes the URL during its own initialization.
class RecoveryState {
  @tracked detected = false;
}
const recoveryState = new RecoveryState();

client.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    recoveryState.detected = true;
  }
});

// Thin wrapper so the rest of the app injects `@service supabase` rather than
// importing the client directly — keeps call sites testable/mockable.
export default class SupabaseService extends Service {
  client = client;

  get passwordRecoveryDetected() {
    return recoveryState.detected;
  }

  // Called once a password reset actually completes, so a later visit to
  // /reset-password (e.g. back button) doesn't still show the "set a new
  // password" form for a session that's already served its purpose.
  clearPasswordRecovery() {
    recoveryState.detected = false;
  }
}
