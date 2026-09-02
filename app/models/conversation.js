import Model, { attr, belongsTo, hasMany } from '@warp-drive/legacy/model';

// Mirrors the `conversations` table. Never fetched over the network via
// this model — the `chat` service pushes rows straight into the store from
// direct Supabase queries and from the `chat` edge function's response.
export default class ConversationModel extends Model {
  @belongsTo('user', { async: false, inverse: null }) user;
  @hasMany('message', { async: false, inverse: 'conversation' }) messages;

  @attr('string') createdAt;
  @attr('string') updatedAt;
}
