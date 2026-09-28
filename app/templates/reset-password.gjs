import { pageTitle } from 'ember-page-title';
import ResetPasswordForm from 'coach-bot/components/reset-password-form';

<template>
  {{pageTitle "Reset password"}}
  <div class="mx-auto flex max-w-sm flex-col gap-6 px-4 py-12">
    <h1 class="text-2xl font-semibold">Reset password</h1>
    <ResetPasswordForm />
  </div>
</template>
