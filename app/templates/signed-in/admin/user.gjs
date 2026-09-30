import { pageTitle } from 'ember-page-title';
import { LinkTo } from '@ember/routing';
import PageContainer from 'coach-bot/components/page-container';

<template>
  {{pageTitle "User profile"}}
  <PageContainer>
    <h1 class="text-2xl font-semibold">User profile</h1>

    {{#if @model.error}}
      <p role="alert" class="mt-4 text-sm text-red-400">{{@model.error}}</p>
    {{else}}
      {{#if @model.latestConversationId}}
        <LinkTo
          @route="signed-in.admin.chats.chat"
          @model={{@model.latestConversationId}}
          class="mt-2 inline-block text-sm text-accent hover:underline"
        >← View chat log</LinkTo>
      {{/if}}

      <div
        class="mt-4 min-w-0 rounded-lg border-2 border-accent bg-accent/10 p-4"
      >
        <h2 class="text-xl font-semibold break-words text-ink">
          {{if @model.user.fullName @model.user.fullName @model.user.email}}
        </h2>

        <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt class="text-muted">Email</dt>
          <dd class="break-words text-ink">{{@model.user.email}}</dd>

          {{#if @model.user.fullName}}
            <dt class="text-muted">Name</dt>
            <dd class="text-ink">{{@model.user.fullName}}</dd>
          {{/if}}

          <dt class="text-muted">Last login</dt>
          <dd class="text-ink">
            {{if @model.user.lastSignInAt @model.user.lastSignInAt "Never"}}
          </dd>

          <dt class="text-muted">Onboarding status</dt>
          <dd class="text-ink">{{@model.user.onboardingStatus}}</dd>
        </dl>
      </div>

      <div class="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 class="text-lg font-semibold text-ink">Personality profile</h2>

        {{#if @model.user.callerProfile}}
          {{#let @model.user.callerProfile as |profile|}}
            <p class="mt-1 text-xs text-muted">
              AI-estimated from
              {{profile.messagesAnalyzedLabel}}
              — a signal for the listener, not a diagnosis.
            </p>

            <div class="mt-4 grid gap-4 sm:grid-cols-2">
              {{#each profile.scoreBars as |bar|}}
                <div>
                  <div class="flex items-baseline justify-between text-sm">
                    <span class="text-muted">{{bar.label}}</span>
                    <span class="font-medium text-ink">{{bar.valueLabel}}</span>
                  </div>
                  <div
                    class="mt-1 h-2 w-full rounded-full
                      {{if bar.hasValue 'bg-border' 'bg-disabled'}}"
                  >
                    <div
                      class="h-2 rounded-full bg-accent {{bar.barWidthClass}}"
                    ></div>
                  </div>
                  <div class="mt-1 flex justify-between text-xs text-muted">
                    <span>Low</span>
                    <span>High</span>
                  </div>
                </div>
              {{/each}}
            </div>

            <dl
              class="mt-6 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border pt-4 text-sm"
            >
              {{#each profile.estimatedFields as |field|}}
                <dt class="text-muted">{{field.label}}</dt>
                <dd class="text-ink">{{field.value}}</dd>
              {{/each}}
            </dl>
          {{/let}}
        {{else}}
          <p class="mt-2 text-sm text-muted">
            No personality profile yet — one is generated once this user sends
            their first onboarding message.
          </p>
        {{/if}}
      </div>
    {{/if}}
  </PageContainer>
</template>
