import { pageTitle } from 'ember-page-title';
import SiteHeader from 'coach-bot/components/site-header';

<template>
  {{pageTitle "CoachBot"}}
  <SiteHeader />
  {{outlet}}
</template>
