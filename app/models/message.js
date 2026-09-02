import Model, { attr, belongsTo } from '@warp-drive/legacy/model';

// Mirrors the `messages` table. Never fetched over the network via this
// model — the `chat` service pushes rows straight into the store from
// direct Supabase queries and from the `chat` edge function's response.
export default class MessageModel extends Model {
  @belongsTo('conversation', { async: false, inverse: 'messages' })
  conversation;

  @attr('string') role;
  @attr('string') content;
  @attr('string') createdAt;

  get isFromUser() {
    return this.role === 'user';
  }
}
