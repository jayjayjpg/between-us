import Route from '@ember/routing/route';
import { service } from '@ember/service';

export default class SignedInAdminChatsChatRoute extends Route {
  @service admin;

  // Caught here rather than left to throw — see chats/index.js's model()
  // for why.
  async model(params) {
    try {
      const conversation = await this.admin.loadConversationDetail(
        params.conversation_id,
      );
      return { conversation, error: null };
    } catch (error) {
      return { conversation: null, error: error.message };
    }
  }
}
