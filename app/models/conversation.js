import Model, { attr, belongsTo, hasMany } from '@warp-drive/legacy/model';

// Mirrors the `conversations` table. Never fetched over the network via
// this model — the `chat` service pushes rows straight into the store from
// direct Supabase queries and from the `chat` edge function's response.
export default class ConversationModel extends Model {
  @belongsTo('user', { async: false, inverse: null }) user;
  @hasMany('message', { async: false, inverse: 'conversation' }) messages;

  @attr('string') createdAt;
  @attr('string') updatedAt;

  // The chat edge function's AI-generated recap of this conversation, for
  // the admin chat-log detail view — see the `add_conversation_summary`
  // migration and `updateOnboardingAndSummary` in the edge function. Only
  // ever populated by `admin.js`; `null` until the bot concludes the
  // conversation at least once.
  @attr('string') summary;

  get sortedMessages() {
    return [...this.messages].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }
}
