import { pageTitle } from 'ember-page-title';
import { LinkTo } from '@ember/routing';
import OnboardingChat from 'coach-bot/components/onboarding-chat';

<template>
  {{pageTitle "Onboarding"}}
  <div class="mx-auto max-w-5xl px-4 py-12">
    <h1 class="text-2xl font-semibold">Onboarding Start</h1>
    <LinkTo @route="index" class="text-sm">Back to home</LinkTo>

    <div class="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div class="flex flex-col gap-4">
        <h2 class="text-lg font-semibold text-ink">Before we book your call</h2>
        <p class="text-sm text-muted">
          Between Us isn't a therapist, and it isn't a friend who already knows
          you — it's a private space to say the things you don't usually say
          anywhere else. A relationship, work, family, a decision you're stuck
          on, or just a general feeling of loneliness — there's room for it
          here.
        </p>
        <p class="text-sm text-muted">
          There's no right way to start. Even "There's something I've been
          thinking about…" is enough.
        </p>
        <p class="border-l-2 border-accent pl-3 text-sm font-medium text-ink">
          No judgment. No performance. No need to have it all figured out.
        </p>
        <p class="text-sm text-muted">
          This chat is part of getting you set up. Once you've shared a little
          about what brought you here, we'll help you book a follow-up call —
          about an hour, one-to-one, with a real person whose only job is to
          listen.
        </p>
      </div>

      <OnboardingChat />
    </div>
  </div>
  {{outlet}}
</template>
