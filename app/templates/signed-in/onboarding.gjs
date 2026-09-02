import { pageTitle } from 'ember-page-title';
import { LinkTo } from '@ember/routing';

<template>
  {{pageTitle "Onboarding"}}
  <h1>Onboarding Start</h1>
  <LinkTo @route="index">Back to home</LinkTo>
  {{outlet}}
</template>
