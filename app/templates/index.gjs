import { pageTitle } from 'ember-page-title';
import PageContainer from 'coach-bot/components/page-container';

<template>
  {{pageTitle "Home"}}
  <PageContainer>
    <h1 class="text-2xl font-semibold">Home</h1>
    <p class="mt-2 text-sm text-muted">Welcome to Coach Bot.</p>
  </PageContainer>
  {{outlet}}
</template>
