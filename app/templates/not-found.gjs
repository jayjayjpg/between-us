import { pageTitle } from 'ember-page-title';
import PageContainer from 'coach-bot/components/page-container';

<template>
  {{pageTitle "Not Found"}}
  <PageContainer class="text-center">
    <h1 class="text-2xl font-semibold">404 — Page not found</h1>
    <p class="mt-2 text-sm text-muted">
      The page you're looking for doesn't exist.
    </p>
  </PageContainer>
</template>
