import Route from '@ember/routing/route';
import { service } from '@ember/service';

export default class SignedInAdminIndexRoute extends Route {
  @service router;

  beforeModel() {
    this.router.replaceWith('signed-in.admin.chats');
  }
}
