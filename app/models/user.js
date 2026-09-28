import Model, { attr } from '@warp-drive/legacy/model';

// Represents a Supabase auth user. The signed-in user's own record is
// pushed by `session.js` straight from Supabase auth responses (signUp /
// signIn / getSession); records for *other* users (as seen by an admin
// browsing chat logs) are pushed by `admin.js` from `public.profiles`
// instead — see each service for which attributes it actually populates.
export default class UserModel extends Model {
  @attr('string') email;

  // Mirrors `app_metadata.role` from the Supabase auth user (see
  // `session.js#pushUser`). `app_metadata` — unlike `user_metadata` — can't
  // be self-edited by the user, only via the Supabase dashboard/Admin API,
  // which is what makes it safe to use for a role flag. Absent for regular
  // users; `'admin'` for admins. Only ever populated by `session.js`.
  @attr('string') role;

  // The rest mirror `public.profiles` (see the `add_profiles` migration).
  // Only ever populated by `admin.js`, for users other than the caller.
  @attr('string') fullName;
  @attr('string') lastSignInAt;

  // 'new' | 'pending' | 'onboarded' — see the migration for what each
  // state means and what moves a user between them.
  @attr('string') onboardingStatus;

  get isAdmin() {
    return this.role === 'admin';
  }

  get isPending() {
    return this.onboardingStatus === 'pending';
  }

  get isOnboarded() {
    return this.onboardingStatus === 'onboarded';
  }
}
