import { pageTitle } from 'ember-page-title';
import { LinkTo } from '@ember/routing';

<template>
  {{pageTitle "Login"}}
  <h1>Login</h1>
  <LinkTo @route="index">Back to home</LinkTo>
  {{outlet}}
</template>
