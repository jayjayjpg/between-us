import { pageTitle } from 'ember-page-title';
import LogoutButton from 'coach-bot/components/logout-button';

<template>
  {{pageTitle "SignedIn"}}
  <LogoutButton />
  <h1>We are signed in</h1>
  {{#if @model}}
    <p>Signed in as {{@model.email}}</p>
  {{/if}}
  {{outlet}}
</template>
