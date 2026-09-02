import Service from '@ember/service';
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

// Thin wrapper so the rest of the app injects `@service supabase` rather than
// importing the client directly — keeps call sites testable/mockable.
export default class SupabaseService extends Service {
  client = client;
}
