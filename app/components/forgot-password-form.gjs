import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { on } from '@ember/modifier';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Requests a password-reset email. Mirrors auth-form.gjs's email field —
// same validation, same accessible-error pattern — since this is meant to
// look and behave like the same form family.
export default class ForgotPasswordForm extends Component {
  @service session;

  @tracked email = '';
  @tracked emailTouched = false;
  @tracked submitAttempted = false;

  @tracked isSubmitting = false;
  @tracked serverError = null;
  @tracked infoMessage = null;

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

  get showEmailError() {
    return Boolean(
      (this.emailTouched || this.submitAttempted) && this.emailError,
    );
  }

  @action
  updateEmail(event) {
    this.email = event.target.value;
  }

  @action
  touchEmail() {
    this.emailTouched = true;
  }

  @action
  async handleSubmit(event) {
    event.preventDefault();
    this.serverError = null;
    this.infoMessage = null;
    this.emailTouched = true;
    this.submitAttempted = true;

    if (this.emailError) {
      document.getElementById('email')?.focus();
      return;
    }

    this.isSubmitting = true;
    try {
      await this.session.requestPasswordReset({ email: this.email.trim() });
      this.infoMessage =
        "If an account exists for that email, we've sent a link to reset your password.";
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

      {{#if this.serverError}}
        <p role="alert" class="text-sm text-red-400">{{this.serverError}}</p>
      {{/if}}

      <button
        type="submit"
        disabled={{this.isSubmitting}}
        class="rounded-md bg-accent px-4 py-2 font-medium text-canvas transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
      >
        {{if this.isSubmitting "Sending…" "Send reset link"}}
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
