import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { on } from '@ember/modifier';

export default class LogoutButton extends Component {
  @service session;
  @service router;

  @tracked isLoggingOut = false;
  @tracked error = null;

  @action
  async logout() {
    this.error = null;
    this.isLoggingOut = true;
    try {
      await this.session.signOut();
      this.router.transitionTo('login');
    } catch (error) {
      this.error = error.message;
    } finally {
      this.isLoggingOut = false;
    }
  }

  <template>
    <button
      type="button"
      disabled={{this.isLoggingOut}}
      {{on "click" this.logout}}
      class="rounded-md bg-accent px-4 py-2 font-medium text-canvas transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
      ...attributes
    >
      {{if this.isLoggingOut "Logging out…" "Logout"}}
    </button>
    {{#if this.error}}
      <p role="alert" class="text-sm text-red-400">{{this.error}}</p>
    {{/if}}
  </template>
}
