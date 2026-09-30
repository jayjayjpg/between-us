import Component from '@glimmer/component';
import { service } from '@ember/service';
import { LinkTo } from '@ember/routing';
import LogoutButton from 'coach-bot/components/logout-button';

// Present on every route (rendered from application.gjs). Reactive to
// `session` rather than anything route-specific, so it stays correct
// regardless of which page it's rendered above.
export default class SiteHeader extends Component {
  @service session;

  get homeRoute() {
    return this.session.isAuthenticated ? 'signed-in.onboarding' : 'index';
  }

  <template>
    <header class="border-b border-border bg-surface">
      <nav
        aria-label="Main"
        class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4"
      >
        <LinkTo
          @route={{this.homeRoute}}
          class="text-lg font-semibold text-ink"
        >
          Between Us
        </LinkTo>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {{#if this.session.isAuthenticated}}
            <LinkTo @route="signed-in.onboarding">Onboarding</LinkTo>
            {{#if this.session.user.isAdmin}}
              <LinkTo @route="signed-in.admin.chats">Chat logs</LinkTo>
            {{/if}}
            <span class="text-muted">{{this.session.user.email}}</span>
            <LogoutButton class="px-3 py-1.5 text-sm" />
          {{else}}
            <LinkTo @route="login">Login</LinkTo>
          {{/if}}
        </div>
      </nav>
    </header>
  </template>
}
