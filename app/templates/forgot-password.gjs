import { pageTitle } from 'ember-page-title';
import ForgotPasswordForm from 'coach-bot/components/forgot-password-form';

<template>
  {{pageTitle "Forgot password"}}
  <div class="mx-auto flex max-w-sm flex-col gap-6 px-4 py-12">
    <h1 class="text-2xl font-semibold">Forgot password</h1>
    <p class="text-sm text-muted">
      Enter your email address and we'll send you a link to reset your password.
    </p>
    <ForgotPasswordForm />
  </div>
</template>
