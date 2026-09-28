import { module, test } from 'qunit';
import { setupTest } from 'coach-bot/tests/helpers';

module('Unit | Route | reset-password', function (hooks) {
  setupTest(hooks);

  test('it exists', function (assert) {
    let route = this.owner.lookup('route:reset-password');
    assert.ok(route);
  });
});
