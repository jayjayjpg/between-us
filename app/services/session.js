import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

// Owns Supabase auth state and keeps it mirrored into the `user` model in
// the store. UI code should go through this service rather than talking to
// `supabase.client.auth` directly.
export default class SessionService extends Service {
  @service supabase;
  @service store;

  @tracked user = null;

  // Resolves once any previously-persisted Supabase session has been
  // restored. Routes that require auth should `await` this before checking
  // `isAuthenticated`, so a page refresh doesn't bounce a signed-in user.
  loaded;

  constructor() {
    super(...arguments);
    this.loaded = this.restore();
  }

  get isAuthenticated() {
    return Boolean(this.user);
  }

  // Whether this browser is here via a password-recovery link — see
  // `supabase.js`. `reset-password-form.gjs` uses this to decide whether to
  // show the "set a new password" form or an "invalid/expired link"
  // message.
  get isPasswordRecovery() {
    return this.supabase.passwordRecoveryDetected;
  }

  async restore() {
    const {
      data: { session },
    } = await this.supabase.client.auth.getSession();
    this.#applySession(session);

    // Keep in sync with token refreshes, sign-outs in other tabs, etc.
    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      this.#applySession(session);
    });
  }

  // Returns `{ requiresEmailConfirmation }`. When a Supabase project has
  // "Confirm email" enabled, signUp succeeds but issues no session until the
  // user clicks the confirmation link — callers should not treat that as a
  // completed sign-in.
  async signUp({ email, password }) {
    const { data, error } = await this.supabase.client.auth.signUp({
      email,
      password,
    });

    if (error) {
      throw new Error(error.message);
    }

    // Supabase returns a user with no identities (rather than an error) when
    // the email is already registered, to avoid leaking which emails exist.
    if (data.user && data.user.identities?.length === 0) {
      throw new Error(
        'An account with this email already exists. Try logging in instead.',
      );
    }

    if (data.user) {
      this.#pushUser(data.user);
    }

    if (data.session) {
      this.#applySession(data.session);
      return { requiresEmailConfirmation: false };
    }

    return { requiresEmailConfirmation: true };
  }

  async signIn({ email, password }) {
    const { data, error } = await this.supabase.client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new Error(error.message);
    }

    this.#applySession(data.session);
  }

  async signOut() {
    await this.supabase.client.auth.signOut();
    this.user = null;
  }

  // Emails a reset-your-password link. Supabase deliberately doesn't
  // distinguish "no account for this email" from success here (to avoid
  // leaking which emails are registered) — callers should show the same
  // generic "check your email" message regardless.
  async requestPasswordReset({ email }) {
    const { error } = await this.supabase.client.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${window.location.origin}/reset-password` },
    );

    if (error) {
      throw new Error(error.message);
    }
  }

  // Only succeeds while `isPasswordRecovery` is true — Supabase applies
  // this to whichever account the recovery link's session belongs to.
  async updatePassword({ password }) {
    const { error } = await this.supabase.client.auth.updateUser({
      password,
    });

    if (error) {
      throw new Error(error.message);
    }

    this.supabase.clearPasswordRecovery();
  }

  #applySession(session) {
    this.user = session?.user ? this.#pushUser(session.user) : null;
  }

  #pushUser(supabaseUser) {
    return this.store.push({
      data: {
        type: 'user',
        id: supabaseUser.id,
        attributes: {
          email: supabaseUser.email,
          role: supabaseUser.app_metadata?.role ?? null,
        },
      },
    });
  }
}
