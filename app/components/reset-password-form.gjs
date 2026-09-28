import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';

const PASSWORD_MIN_LENGTH = 8;

// Three states, reactive to `session.isPasswordRecovery` (which can flip
// true a moment *after* this first renders — Supabase processes the
// recovery link's URL asynchronously) rather than decided once in a route
// hook:
//   - not a valid recovery visit: an "invalid/expired link" message
//   - valid recovery visit: the set-a-new-password form
//   - submitted successfully: a confirmation + link to log in
export default class ResetPasswordForm extends Component {
  @service session;

  @tracked password = '';
  @tracked confirmPassword = '';
  @tracked passwordTouched = false;
  @tracked confirmPasswordTouched = false;
  @tracked submitAttempted = false;

  @tracked isSubmitting = false;
  @tracked serverError = null;
  @tracked isComplete = false;

  get passwordError() {
    if (!this.password) {
      return 'Enter a new password.';
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
    if (!this.confirmPassword) {
      return 'Confirm your new password.';
    }
    if (this.confirmPassword !== this.password) {
      return 'Passwords do not match.';
    }
    return null;
  }

  get showPasswordError() {
    return Boolean(
      (this.passwordTouched || this.submitAttempted) && this.passwordError,
    );
  }

  get showConfirmPasswordError() {
    return Boolean(
      (this.confirmPasswordTouched || this.submitAttempted) &&
      this.confirmPasswordError,
    );
  }

  get firstInvalidFieldId() {
    if (this.passwordError) {
      return 'password';
    }
    if (this.confirmPasswordError) {
      return 'confirm-password';
    }
    return null;
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
    this.passwordTouched = true;
    this.confirmPasswordTouched = true;
    this.submitAttempted = true;

    const { firstInvalidFieldId } = this;
    if (firstInvalidFieldId) {
      document.getElementById(firstInvalidFieldId)?.focus();
      return;
    }

    this.isSubmitting = true;
    try {
      await this.session.updatePassword({ password: this.password });
      this.isComplete = true;
    } catch (error) {
      this.serverError = error.message;
    } finally {
      this.isSubmitting = false;
    }
  }

  <template>
    {{#if this.isComplete}}
      <p role="status" class="text-sm text-accent">
        Your password has been updated.
      </p>
      <LinkTo @route="login" class="text-sm">Continue to login</LinkTo>
    {{else if this.session.isPasswordRecovery}}
      <form
        novalidate
        aria-busy={{if this.isSubmitting "true" "false"}}
        {{on "submit" this.handleSubmit}}
        class="mx-auto flex w-full max-w-sm flex-col gap-6"
      >
        <div class="flex flex-col gap-1.5">
          <label for="password" class="text-sm font-medium text-ink">New
            password</label>
          {{! template-lint-disable no-unsupported-role-attributes }}
          <input
            type="password"
            id="password"
            name="password"
            autocomplete="new-password"
            required
            value={{this.password}}
            aria-invalid={{if this.showPasswordError "true" "false"}}
            aria-describedby={{if
              this.showPasswordError
              "password-hint password-error"
              "password-hint"
            }}
            {{on "input" this.updatePassword}}
            {{on "blur" this.touchPassword}}
            class="rounded-md border
              {{if this.showPasswordError 'border-red-400' 'border-border'}}
              bg-canvas px-3 py-2 text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {{! template-lint-enable no-unsupported-role-attributes }}
          <p id="password-hint" class="text-sm text-muted">
            Use at least 8 characters, including one capital letter and one
            number.
          </p>
          {{#if this.showPasswordError}}
            <p
              id="password-error"
              role="alert"
              class="text-sm text-red-400"
            >{{this.passwordError}}</p>
          {{/if}}
        </div>

        <div class="flex flex-col gap-1.5">
          <label
            for="confirm-password"
            class="text-sm font-medium text-ink"
          >Confirm new password</label>
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

        {{#if this.serverError}}
          <p role="alert" class="text-sm text-red-400">{{this.serverError}}</p>
        {{/if}}

        <button
          type="submit"
          disabled={{this.isSubmitting}}
          class="rounded-md bg-accent px-4 py-2 font-medium text-canvas transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{if this.isSubmitting "Updating…" "Update password"}}
        </button>
      </form>
    {{else}}
      <p class="text-sm text-muted">
        This password reset link is invalid or has expired.
      </p>
      <LinkTo @route="forgot-password" class="text-sm">Request a new link</LinkTo>
    {{/if}}
  </template>
}
