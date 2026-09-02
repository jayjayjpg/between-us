import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

// Owns the signed-in user's onboarding conversation: loading their most
// recent conversation + its message history directly from Supabase (reads
// are plain RLS-scoped queries), and sending new messages through the
// `chat` edge function, which is the only thing that talks to Claude and
// the only writer of message rows. Both paths mirror their results into the
// `conversation` / `message` models via `store.push()`.
export default class ChatService extends Service {
  @service session;
  @service supabase;
  @service store;

  @tracked conversation = null;
  @tracked isLoadingHistory = false;

  async loadConversation() {
    const userId = this.session.user?.id;
    if (!userId) {
      this.conversation = null;
      return;
    }

    this.isLoadingHistory = true;
    try {
      const { data: rows, error } = await this.supabase.client
        .from('conversations')
        .select('id, created_at, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (error) {
        throw new Error(error.message);
      }

      const row = rows?.[0];
      if (!row) {
        this.conversation = null;
        return;
      }

      this.conversation = this.#pushConversation(row, userId);

      const { data: messageRows, error: messagesError } =
        await this.supabase.client
          .from('messages')
          .select('id, role, content, created_at')
          .eq('conversation_id', row.id)
          .order('created_at', { ascending: true });

      if (messagesError) {
        throw new Error(messagesError.message);
      }

      for (const messageRow of messageRows ?? []) {
        this.#pushMessage(messageRow, row.id);
      }
    } finally {
      this.isLoadingHistory = false;
    }
  }

  // Sends `content` through the `chat` edge function and mirrors both the
  // saved user message and Claude's reply into the store. Throws (with a
  // human-readable message) on any failure — the caller decides how to
  // recover, e.g. by re-running `loadConversation` to resync.
  async sendMessage(content) {
    const { data, error } = await this.supabase.client.functions.invoke(
      'chat',
      {
        body: {
          conversationId: this.conversation?.id ?? null,
          message: content,
        },
      },
    );

    if (error) {
      throw new Error(await readFunctionErrorMessage(error));
    }

    this.conversation = this.#pushConversation(
      { id: data.conversationId },
      this.session.user.id,
    );
    this.#pushMessage(data.userMessage, data.conversationId);
    this.#pushMessage(data.assistantMessage, data.conversationId);

    return data.assistantMessage;
  }

  #pushConversation(row, userId) {
    return this.store.push({
      data: {
        type: 'conversation',
        id: row.id,
        attributes: {
          createdAt: row.created_at ?? null,
          updatedAt: row.updated_at ?? row.created_at ?? null,
        },
        relationships: {
          user: {
            data: { type: 'user', id: userId },
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
          createdAt: row.created_at ?? row.createdAt ?? null,
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

async function readFunctionErrorMessage(error) {
  if (error?.context?.json) {
    try {
      const body = await error.context.json();
      if (body?.error) {
        return body.error;
      }
    } catch {
      // Body wasn't JSON (or was already consumed) — fall through.
    }
  }
  return error?.message ?? 'Something went wrong talking to Claude.';
}
