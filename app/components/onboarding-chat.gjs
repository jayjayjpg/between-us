import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { on } from '@ember/modifier';

// Every message typed here is sent to the `chat` edge function, which
// relays it to Claude (authenticated as the signed-in user) and persists
// both sides of the exchange — see `app/services/chat.js`.
export default class OnboardingChat extends Component {
  @service chat;

  @tracked draft = '';
  @tracked isSending = false;
  @tracked sendError = null;
  // Shown immediately on submit, before the real (persisted) message comes
  // back from the `chat` service — so the user sees what they just sent
  // right away instead of waiting on the full round trip.
  @tracked pendingUserMessage = null;

  constructor(owner, args) {
    super(owner, args);
    this.chat.loadConversation();
  }

  get messages() {
    const messages = this.chat.conversation?.messages;
    return messages
      ? [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      : [];
  }

  get hasMessages() {
    return this.messages.length > 0;
  }

  get hasVisibleContent() {
    return this.hasMessages || Boolean(this.pendingUserMessage);
  }

  get canSend() {
    return this.draft.trim().length > 0 && !this.isSending;
  }

  @action
  updateDraft(event) {
    this.draft = event.target.value;
  }

  @action
  handleKeydown(event) {
    // Enter sends; Shift+Enter inserts a newline, as in most chat apps.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.target.form.requestSubmit();
    }
  }

  @action
  async handleSubmit(event) {
    event.preventDefault();

    const content = this.draft.trim();
    if (!content || this.isSending) {
      return;
    }

    this.draft = '';
    this.sendError = null;
    this.isSending = true;
    this.pendingUserMessage = content;
    this.scrollToLatest();

    try {
      await this.chat.sendMessage(content);
      // The real, persisted message is in the store now — drop the stand-in
      // so it isn't shown twice.
      this.pendingUserMessage = null;
    } catch (error) {
      this.pendingUserMessage = null;
      this.sendError = error.message;
      // The user's message may already be saved server-side even though
      // the exchange as a whole failed (e.g. Claude timed out) — resync so
      // it isn't silently lost from view.
      await this.chat.loadConversation();
    } finally {
      this.isSending = false;
      this.scrollToLatest();
    }
  }

  scrollToLatest() {
    requestAnimationFrame(() => {
      const history = document.getElementById('chat-history');
      if (history) {
        history.scrollTop = history.scrollHeight;
      }
    });
  }

  <template>
    <div
      class="flex h-[32rem] flex-col overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div
        id="chat-history"
        role="log"
        aria-live="polite"
        aria-label="Chat history"
        tabindex="0"
        class="flex-1 space-y-3 overflow-y-auto p-4"
      >
        {{#if this.chat.isLoadingHistory}}
          <p class="text-sm text-muted">Loading your conversation…</p>
        {{else if this.hasVisibleContent}}
          {{#each this.messages as |message|}}
            <div
              class="flex
                {{if message.isFromUser 'justify-end' 'justify-start'}}"
            >
              <div
                class="max-w-[85%] rounded-lg px-3 py-2 text-sm
                  {{if
                    message.isFromUser
                    'rounded-br-sm bg-accent text-canvas'
                    'rounded-bl-sm border border-border bg-canvas text-ink'
                  }}"
              >
                <p class="whitespace-pre-wrap">{{message.content}}</p>
              </div>
            </div>
          {{/each}}
          {{#if this.pendingUserMessage}}
            <div class="flex justify-end">
              <div
                class="max-w-[85%] rounded-lg rounded-br-sm bg-accent px-3 py-2 text-sm text-canvas"
              >
                <p class="whitespace-pre-wrap">{{this.pendingUserMessage}}</p>
              </div>
            </div>
          {{/if}}
        {{else}}
          <p class="text-sm text-muted">
            Your messages will show up here once you send one.
          </p>
        {{/if}}

        {{#if this.isSending}}
          <div class="flex justify-start">
            <div
              class="max-w-[85%] rounded-lg rounded-bl-sm border border-border bg-canvas px-3 py-2 text-muted"
            >
              <p class="text-sm italic">Thinking…</p>
            </div>
          </div>
        {{/if}}
      </div>

      {{#if this.sendError}}
        <p
          role="alert"
          class="border-t border-border px-4 py-2 text-sm text-red-400"
        >{{this.sendError}}</p>
      {{/if}}

      <form
        {{on "submit" this.handleSubmit}}
        class="flex items-end gap-2 border-t border-border p-3"
      >
        <div class="flex-1">
          <label for="chat-message" class="sr-only">Message</label>
          <textarea
            id="chat-message"
            name="message"
            rows="1"
            placeholder="Type a message…"
            disabled={{this.isSending}}
            value={{this.draft}}
            {{on "input" this.updateDraft}}
            {{on "keydown" this.handleKeydown}}
            class="w-full resize-none rounded-md border border-border bg-canvas px-3 py-2 text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          ></textarea>
        </div>
        <button
          type="submit"
          disabled={{unless this.canSend true}}
          class="rounded-md bg-accent px-4 py-2 font-medium text-canvas transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{if this.isSending "Sending…" "Send"}}
        </button>
      </form>
    </div>
  </template>
}
