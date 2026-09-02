import { pageTitle } from 'ember-page-title';
import { LinkTo } from '@ember/routing';
import AuthForm from 'coach-bot/components/auth-form';

<template>
  {{pageTitle "Login"}}
  <div class="mx-auto flex max-w-sm flex-col gap-6 px-4 py-12">
    <h1 class="text-2xl font-semibold">Login</h1>
    <AuthForm />
    <LinkTo @route="index">Back to home</LinkTo>
  </div>
  {{outlet}}
</template>
