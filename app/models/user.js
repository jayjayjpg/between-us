import Model, { attr } from '@warp-drive/legacy/model';

// Represents the signed-in Supabase auth user. Records are never fetched
// over the network via this model — the `session` service pushes them
// straight into the store from Supabase auth responses (signUp / signIn /
// getSession), since Supabase itself is the source of truth for auth.
export default class UserModel extends Model {
  @attr('string') email;
}
