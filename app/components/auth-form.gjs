import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;

// Accessible login / signup form. Validates email + password client-side,
// then hands valid submissions to the `session` service, which talks to
// Supabase and mirrors the result into the `user` model.
export default class AuthForm extends Component {
  @service session;
  @service router;

  @tracked mode = 'login';
  @tracked email = '';
  @tracked password = '';
  @tracked confirmPassword = '';

  @tracked emailTouched = false;
  @tracked passwordTouched = false;
  @tracked confirmPasswordTouched = false;
  @tracked submitAttempted = false;

  @tracked isSubmitting = false;
  @tracked serverError = null;
  @tracked infoMessage = null;

  get isSignup() {
    return this.mode === 'signup';
  }

  get isLogin() {
    return !this.isSignup;
  }

  get emailError() {
    const value = this.email.trim();
    if (!value) {
      return 'Enter your email address.';
    }
    if (!EMAIL_PATTERN.test(value)) {
      return 'Enter a valid email address, like name@example.com.';
    }
    return null;
  }

  get passwordError() {
    if (!this.password) {
      return 'Enter a password.';
    }
    if (this.password.length < PASSWORD_MIN_LENGTH) {
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
    }
    if (!/[A-Z]/.test(this.password)) {
      return 'Password must include at least one capital letter.';
    }
    if (!/[0-9]/.test(this.password)) {
      return 'Password must include at least one number.';
    }
    return null;
  }

  get confirmPasswordError() {
    if (!this.isSignup) {
      return null;
    }
    if (!this.confirmPassword) {
      return 'Confirm your password.';
    }
    if (this.confirmPassword !== this.password) {
      return 'Passwords do not match.';
    }
    return null;
  }

  get showEmailError() {
    return Boolean(
      (this.emailTouched || this.submitAttempted) && this.emailError,
    );
  }

  get showPasswordError() {
    return Boolean(
      (this.passwordTouched || this.submitAttempted) && this.passwordError,
    );
  }

  get showConfirmPasswordError() {
    return Boolean(
      this.isSignup &&
      (this.confirmPasswordTouched || this.submitAttempted) &&
      this.confirmPasswordError,
    );
  }

  get passwordDescribedBy() {
    const ids = [];
    if (this.isSignup) {
      ids.push('password-hint');
    }
    if (this.showPasswordError) {
      ids.push('password-error');
    }
    return ids.length ? ids.join(' ') : false;
  }

  get firstInvalidFieldId() {
    if (this.emailError) {
      return 'email';
    }
    if (this.passwordError) {
      return 'password';
    }
    if (this.isSignup && this.confirmPasswordError) {
      return 'confirm-password';
    }
    return null;
  }

  @action
  selectMode(mode) {
    this.mode = mode;
    this.serverError = null;
    this.infoMessage = null;
    this.submitAttempted = false;
    this.confirmPasswordTouched = false;
  }

  @action
  updateEmail(event) {
    this.email = event.target.value;
  }

  @action
  updatePassword(event) {
    this.password = event.target.value;
  }

  @action
  updateConfirmPassword(event) {
    this.confirmPassword = event.target.value;
  }

  @action
  touchEmail() {
    this.emailTouched = true;
  }

  @action
  touchPassword() {
    this.passwordTouched = true;
  }

  @action
  touchConfirmPassword() {
    this.confirmPasswordTouched = true;
  }

  @action
  async handleSubmit(event) {
    event.preventDefault();
    this.serverError = null;
    this.infoMessage = null;
    this.emailTouched = true;
    this.passwordTouched = true;
    if (this.isSignup) {
      this.confirmPasswordTouched = true;
    }
    this.submitAttempted = true;

    const { firstInvalidFieldId } = this;
    if (firstInvalidFieldId) {
      document.getElementById(firstInvalidFieldId)?.focus();
      return;
    }

    this.isSubmitting = true;
    try {
      const credentials = { email: this.email.trim(), password: this.password };

      if (this.isSignup) {
        const { requiresEmailConfirmation } =
          await this.session.signUp(credentials);
        if (requiresEmailConfirmation) {
          this.infoMessage =
            'Almost there — check your email to confirm your account before logging in.';
          return;
        }
      } else {
        await this.session.signIn(credentials);
      }

      // Admins land on the chat-log list rather than their own onboarding
      // chat — `session.user` is populated synchronously by signIn/signUp
      // above, so this is already known by the time we get here.
      const destination = this.session.user?.isAdmin
        ? 'signed-in.admin.chats'
        : 'signed-in.onboarding';
      this.router.transitionTo(destination);
    } catch (error) {
      this.serverError = error.message;
    } finally {
      this.isSubmitting = false;
    }
  }

  <template>
    <form
      novalidate
      aria-busy={{if this.isSubmitting "true" "false"}}
      {{on "submit" this.handleSubmit}}
      class="mx-auto flex w-full max-w-sm flex-col gap-6"
    >
      <fieldset
        class="flex gap-1 rounded-lg border border-border bg-surface p-1"
      >
        <legend class="sr-only">Choose whether to log in or sign up</legend>
        <label
          class="flex-1 cursor-pointer rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors
            {{if
              this.isLogin
              'bg-accent text-canvas'
              'text-muted hover:text-ink'
            }}"
        >
          <input
            type="radio"
            name="auth-mode"
            value="login"
            checked={{this.isLogin}}
            class="sr-only"
            {{on "change" (fn this.selectMode "login")}}
          />
          Log in
        </label>
        <label
          class="flex-1 cursor-pointer rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors
            {{if
              this.isSignup
              'bg-accent text-canvas'
              'text-muted hover:text-ink'
            }}"
        >
          <input
            type="radio"
            name="auth-mode"
            value="signup"
            checked={{this.isSignup}}
            class="sr-only"
            {{on "change" (fn this.selectMode "signup")}}
          />
          Sign up
        </label>
      </fieldset>

      <div class="flex flex-col gap-1.5">
        <label for="email" class="text-sm font-medium text-ink">Email address</label>
        <input
          type="email"
          id="email"
          name="email"
          autocomplete="email"
          required
          value={{this.email}}
          aria-invalid={{if this.showEmailError "true" "false"}}
          aria-describedby={{if this.showEmailError "email-error" false}}
          {{on "input" this.updateEmail}}
          {{on "blur" this.touchEmail}}
          class="rounded-md border
            {{if this.showEmailError 'border-red-400' 'border-border'}}
            bg-canvas px-3 py-2 text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {{#if this.showEmailError}}
          <p
            id="email-error"
            role="alert"
            class="text-sm text-red-400"
          >{{this.emailError}}</p>
        {{/if}}
      </div>

      <div class="flex flex-col gap-1.5">
        <label
          for="password"
          class="text-sm font-medium text-ink"
        >Password</label>
        {{! template-lint-disable no-unsupported-role-attributes }}
        <input
          type="password"
          id="password"
          name="password"
          autocomplete={{if this.isSignup "new-password" "current-password"}}
          required
          value={{this.password}}
          aria-invalid={{if this.showPasswordError "true" "false"}}
          aria-describedby={{this.passwordDescribedBy}}
          {{on "input" this.updatePassword}}
          {{on "blur" this.touchPassword}}
          class="rounded-md border
            {{if this.showPasswordError 'border-red-400' 'border-border'}}
            bg-canvas px-3 py-2 text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {{! template-lint-enable no-unsupported-role-attributes }}
        {{#if this.isSignup}}
          <p id="password-hint" class="text-sm text-muted">
            Use at least 8 characters, including one capital letter and one
            number.
          </p>
        {{/if}}
        {{#if this.showPasswordError}}
          <p
            id="password-error"
            role="alert"
            class="text-sm text-red-400"
          >{{this.passwordError}}</p>
        {{/if}}
        {{#if this.isLogin}}
          <LinkTo @route="forgot-password" class="self-start text-sm">
            Forgot your password?
          </LinkTo>
        {{/if}}
      </div>

      {{#if this.isSignup}}
        <div class="flex flex-col gap-1.5">
          <label
            for="confirm-password"
            class="text-sm font-medium text-ink"
          >Confirm password</label>
          {{! template-lint-disable no-unsupported-role-attributes }}
          <input
            type="password"
            id="confirm-password"
            name="confirm-password"
            autocomplete="new-password"
            required
            value={{this.confirmPassword}}
            aria-invalid={{if this.showConfirmPasswordError "true" "false"}}
            aria-describedby={{if
              this.showConfirmPasswordError
              "confirm-password-error"
              false
            }}
            {{on "input" this.updateConfirmPassword}}
            {{on "blur" this.touchConfirmPassword}}
            class="rounded-md border
              {{if
                this.showConfirmPasswordError
                'border-red-400'
                'border-border'
              }}
              bg-canvas px-3 py-2 text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {{! template-lint-enable no-unsupported-role-attributes }}
          {{#if this.showConfirmPasswordError}}
            <p
              id="confirm-password-error"
              role="alert"
              class="text-sm text-red-400"
            >{{this.confirmPasswordError}}</p>
          {{/if}}
        </div>
      {{/if}}

      {{#if this.serverError}}
        <p role="alert" class="text-sm text-red-400">{{this.serverError}}</p>
      {{/if}}

      <button
        type="submit"
        disabled={{this.isSubmitting}}
        class="rounded-md bg-accent px-4 py-2 font-medium text-canvas transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
      >
        {{#if this.isSubmitting}}
          {{if this.isSignup "Creating account…" "Logging in…"}}
        {{else}}
          {{if this.isSignup "Create account" "Log in"}}
        {{/if}}
      </button>

      {{#if this.infoMessage}}
        <p
          role="status"
          aria-live="polite"
          class="text-sm text-accent"
        >{{this.infoMessage}}</p>
      {{/if}}
    </form>
  </template>
}
