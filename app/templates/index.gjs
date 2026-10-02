import { pageTitle } from 'ember-page-title';
import { LinkTo } from '@ember/routing';
import PageContainer from 'coach-bot/components/page-container';

<template>
  {{pageTitle "Home"}}
  <PageContainer class="relative overflow-hidden">
    {{! Purely decorative ambient glow behind the hero -- hidden from
      screen readers and never intercepts clicks/taps. }}
    <div
      class="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-accent/20 blur-3xl"
      aria-hidden="true"
    ></div>

    <div class="relative mx-auto max-w-2xl text-center">
      <p
        class="text-xs font-semibold tracking-wide text-accent uppercase"
      >Between Us</p>
      <h1 class="mt-3 text-4xl font-semibold text-ink sm:text-5xl">
        A space to say the things you don't usually say
      </h1>
      <p class="mt-4 text-base text-muted">
        Not a therapist. Not a friend who already knows you. Just a real person
        whose only job is to listen — private, one-to-one, in confidence.
      </p>
      <LinkTo
        @route="login"
        class="mt-8 inline-block rounded-md bg-accent px-8 py-3 text-base font-semibold text-canvas transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >Get started</LinkTo>
    </div>

    <div class="relative mt-16 grid gap-6 sm:grid-cols-3">
      <div class="rounded-lg border border-border bg-surface p-5">
        <h2 class="text-sm font-semibold text-ink">Say it in your own time</h2>
        <p class="mt-2 text-sm text-muted">
          A short, private chat helps you put what's on your mind into words —
          there's no wrong way to start.
        </p>
      </div>
      <div class="rounded-lg border border-border bg-surface p-5">
        <h2 class="text-sm font-semibold text-ink">Talk to a real person</h2>
        <p class="mt-2 text-sm text-muted">
          We'll help you book a follow-up call — about an hour, one-to-one, with
          someone whose only job is to listen.
        </p>
      </div>
      <div class="rounded-lg border border-border bg-surface p-5">
        <h2 class="text-sm font-semibold text-ink">Completely confidential</h2>
        <p class="mt-2 text-sm text-muted">
          What you share stays between you and your listener — never sold,
          published, or shared anywhere else.
        </p>
      </div>
    </div>
  </PageContainer>
  {{outlet}}
</template>
