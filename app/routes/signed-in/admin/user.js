import Route from '@ember/routing/route';
import { service } from '@ember/service';

// Admin access is already guarded by the parent `admin` route.
export default class SignedInAdminUserRoute extends Route {
  @service admin;

  // Caught here rather than left to throw — see chats/index.js's model()
  // for why.
  async model(params) {
    try {
      const { user, latestConversationId } = await this.admin.loadUserProfile(
        params.user_id,
      );
      return { user, latestConversationId, error: null };
    } catch (error) {
      return { user: null, latestConversationId: null, error: error.message };
    }
  }
}
