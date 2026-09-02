import { pageTitle } from 'ember-page-title';
import { LinkTo } from '@ember/routing';

<template>
  {{pageTitle "Home"}}
    <h1>Home</h1>
    <LinkTo @route="login">Login</LinkTo>
    <LinkTo @route="signed-in.onboarding">Onboarding</LinkTo>
  {{outlet}}
</template>
