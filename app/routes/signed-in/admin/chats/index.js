import Route from '@ember/routing/route';
import { service } from '@ember/service';

export default class SignedInAdminChatsIndexRoute extends Route {
  @service admin;

  // Caught here rather than left to throw, so the template can show a
  // plain in-page error box (consistent with every other API-error
  // display in this app) instead of relying on Ember's route error
  // substate, which this app doesn't set up anywhere else.
  async model() {
    try {
      const summaries = await this.admin.loadConversationSummaries();
      return { summaries, error: null };
    } catch (error) {
      return { summaries: [], error: error.message };
    }
  }
}
