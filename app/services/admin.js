import Service, { service } from '@ember/service';

const EXCERPT_LENGTH = 120;

// Read-only (aside from `markUserOnboarded`) queries for the admin area.
//
// `loadConversationSummaries` deliberately returns plain data rather than
// WarpDrive `conversation`/`message` records — reusing those types for
// *every* user's conversations would risk colliding with `chat.js`'s own
// `conversation`, which specifically means "the signed-in user's own chat".
//
// `loadConversationDetail`, by contrast, is exactly the shape those models
// already represent (a conversation, its messages, its owning user), so it
// pushes real records — there's no ambiguity there since it's keyed by the
// conversation's own id, distinct from whatever `chat.js` is tracking.
export default class AdminService extends Service {
  @service supabase;
  @service store;

  // Returns one summary per conversation the caller is allowed to see
  // (RLS: admins see every conversation — see the
  // `20260924160921_admins_can_view_all_conversations.sql` migration),
  // newest-activity first, each with a truncated excerpt of its most
  // recent *user* message (not the assistant's).
  async loadConversationSummaries() {
    const { data: conversations, error } = await this.supabase.client
      .from('conversations')
      .select('id, user_id, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    const conversationIds = (conversations ?? []).map((row) => row.id);
    const lastUserMessageByConversation =
      await this.#loadLastUserMessages(conversationIds);

    return (conversations ?? []).map((conversation) => {
      const lastUserMessage = lastUserMessageByConversation.get(
        conversation.id,
      );
      return {
        id: conversation.id,
        userId: conversation.user_id,
        updatedAt: conversation.updated_at,
        lastUserMessageExcerpt: lastUserMessage
          ? truncate(lastUserMessage.content, EXCERPT_LENGTH)
          : null,
      };
    });
  }

  // Loads one conversation's full message log, its AI-generated summary
  // (if the bot has concluded it at least once — see the chat edge
  // function), and its owning user's profile (email, name, last login,
  // onboarding status — from `public.profiles`), and pushes all of it into
  // the store. Returns the pushed `conversation` record; read its messages
  // via `conversation.sortedMessages`, its summary via `conversation.summary`,
  // and its owner via `conversation.user`.
  async loadConversationDetail(conversationId) {
    const { data: conversationRow, error: conversationError } =
      await this.supabase.client
        .from('conversations')
        .select('id, user_id, created_at, updated_at, summary')
        .eq('id', conversationId)
        .single();

    if (conversationError || !conversationRow) {
      throw new Error(conversationError?.message ?? 'Conversation not found');
    }

    const [messagesResult, profileResult] = await Promise.all([
      this.supabase.client
        .from('messages')
        .select('id, role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true }),
      this.supabase.client
        .from('profiles')
        .select('id, email, full_name, last_sign_in_at, onboarding_status')
        .eq('id', conversationRow.user_id)
        .maybeSingle(),
    ]);

    if (messagesResult.error) {
      throw new Error(messagesResult.error.message);
    }
    if (profileResult.error) {
      throw new Error(profileResult.error.message);
    }

    if (profileResult.data) {
      this.#pushUser(profileResult.data);
    }

    const conversation = this.#pushConversation(conversationRow);
    for (const messageRow of messagesResult.data ?? []) {
      this.#pushMessage(messageRow, conversationRow.id);
    }

    return conversation;
  }

  // Moves a user from 'pending' to 'onboarded'. Only succeeds if they're
  // currently 'pending' (guarded server-side, not just in the UI) — throws
  // otherwise, including if they were never in that state to begin with.
  async markUserOnboarded(userId) {
    const { data, error } = await this.supabase.client
      .from('profiles')
      .update({ onboarding_status: 'onboarded' })
      .eq('id', userId)
      .eq('onboarding_status', 'pending')
      .select('id, email, full_name, last_sign_in_at, onboarding_status')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error('This user is not currently pending onboarding.');
    }

    return this.#pushUser(data);
  }

  async #loadLastUserMessages(conversationIds) {
    const lastUserMessageByConversation = new Map();
    if (conversationIds.length === 0) {
      return lastUserMessageByConversation;
    }

    const { data: userMessages, error } = await this.supabase.client
      .from('messages')
      .select('conversation_id, content, created_at')
      .eq('role', 'user')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    for (const message of userMessages ?? []) {
      // Rows come back newest-first, so the first one seen per
      // conversation is that conversation's most recent user message.
      if (!lastUserMessageByConversation.has(message.conversation_id)) {
        lastUserMessageByConversation.set(message.conversation_id, message);
      }
    }

    return lastUserMessageByConversation;
  }

  #pushUser(profileRow) {
    return this.store.push({
      data: {
        type: 'user',
        id: profileRow.id,
        attributes: {
          email: profileRow.email,
          fullName: profileRow.full_name,
          lastSignInAt: profileRow.last_sign_in_at,
          onboardingStatus: profileRow.onboarding_status,
          // `role` is deliberately omitted, not set to null: it isn't part
          // of `profiles`, so this service has no opinion on it either
          // way, and omitting the key (vs. nulling it) means an existing
          // cached value for this same user id — e.g. from `session.js`,
          // if an admin happens to be viewing their own conversation —
          // isn't clobbered.
        },
      },
    });
  }

  #pushConversation(row) {
    return this.store.push({
      data: {
        type: 'conversation',
        id: row.id,
        attributes: {
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          summary: row.summary ?? null,
        },
        relationships: {
          user: {
            data: { type: 'user', id: row.user_id },
          },
        },
      },
    });
  }

  #pushMessage(row, conversationId) {
    return this.store.push({
      data: {
        type: 'message',
        id: row.id,
        attributes: {
          role: row.role,
          content: row.content,
          createdAt: row.created_at,
        },
        relationships: {
          conversation: {
            data: { type: 'conversation', id: conversationId },
          },
        },
      },
    });
  }
}

function truncate(text, maxLength) {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength).trimEnd()}…`;
}
