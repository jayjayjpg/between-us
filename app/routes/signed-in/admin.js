import Route from '@ember/routing/route';
import { service } from '@ember/service';

// Guards every route nested under here (`chats` and `user`) on the
// signed-in user having the admin role. `signed-in`'s own `beforeModel`
// already guarantees the visitor is authenticated and `session.user` is
// loaded by the time this runs, so no need to re-check that here.
export default class SignedInAdminRoute extends Route {
  @service session;
  @service router;

  beforeModel() {
    if (!this.session.user?.isAdmin) {
      // A 404, not a redirect to login or a "forbidden" message — a
      // non-admin shouldn't be able to tell this route exists at all.
      // `replaceWith` so the blocked URL doesn't linger in back-button
      // history.
      this.router.replaceWith('not-found');
    }
  }
}
