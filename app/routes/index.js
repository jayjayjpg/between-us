import Route from '@ember/routing/route';
import { service } from '@ember/service';

// The landing page is only meaningful for a signed-out visitor -- an
// already-authenticated one gets sent straight to their actual landing
// page instead, the same place `site-header.gjs`'s clickable title
// already sends them for in-app navigation. Mirrors `signed-in.js`'s own
// guard shape (await `session.loaded` first, so a page refresh doesn't
// flash this page before the persisted session has been restored), just
// with the condition and destination inverted.
export default class IndexRoute extends Route {
  @service session;
  @service router;

  async beforeModel() {
    await this.session.loaded;
    if (this.session.isAuthenticated) {
      this.router.transitionTo('signed-in.onboarding');
    }
  }
}
