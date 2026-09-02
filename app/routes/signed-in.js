import Route from '@ember/routing/route';
import { service } from '@ember/service';

export default class SignedInRoute extends Route {
  @service session;
  @service router;

  async beforeModel() {
    await this.session.loaded;
    if (!this.session.isAuthenticated) {
      this.router.transitionTo('login');
    }
  }

  model() {
    return this.session.user;
  }
}
