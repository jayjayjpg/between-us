import { module, test } from 'qunit';
import { setupTest } from 'coach-bot/tests/helpers';

module('Unit | Route | signed-in', function (hooks) {
  setupTest(hooks);

  test('it exists', function (assert) {
    let route = this.owner.lookup('route:signed-in');
    assert.ok(route);
  });
});
