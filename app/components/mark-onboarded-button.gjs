import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { on } from '@ember/modifier';

// Marks the user with `@userId` as onboarded. Only meaningful — and only
// ever rendered by callers — while that user is 'pending'; see
// `admin.js#markUserOnboarded` for the server-side guard on that.
export default class MarkOnboardedButton extends Component {
  @service admin;

  @tracked isSaving = false;
  @tracked error = null;

  @action
  async markOnboarded() {
    this.error = null;
    this.isSaving = true;
    try {
      await this.admin.markUserOnboarded(this.args.userId);
    } catch (error) {
      this.error = error.message;
    } finally {
      this.isSaving = false;
    }
  }

  <template>
    <button
      type="button"
      disabled={{this.isSaving}}
      {{on "click" this.markOnboarded}}
      class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
    >
      {{if this.isSaving "Marking as onboarded…" "Mark as onboarded"}}
    </button>
    {{#if this.error}}
      <p role="alert" class="mt-2 text-sm text-red-400">{{this.error}}</p>
    {{/if}}
  </template>
}
