import { module, test } from 'qunit';
import { setupTest } from 'coach-bot/tests/helpers';

module('Unit | Route | signed-in/admin/chats/chat', function (hooks) {
  setupTest(hooks);

  test('it exists', function (assert) {
    let route = this.owner.lookup('route:signed-in/admin/chats/chat');
    assert.ok(route);
  });
});
