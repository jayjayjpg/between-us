import EmberRouter from '@embroider/router';
import config from 'coach-bot/config/environment';

export default class Router extends EmberRouter {
  location = config.locationType;
  rootURL = config.rootURL;
}

Router.map(function () {
  this.route('index', { path: '/' })
  this.route('login');
  this.route('forgot-password');
  this.route('reset-password');
  this.route('signed-in', function() {
    this.route('onboarding');
    this.route('admin', function() {
      this.route('chats', function() {
        this.route('chat', { path: '/:conversation_id' });
      });
    });
  });
  this.route('not-found');
});
