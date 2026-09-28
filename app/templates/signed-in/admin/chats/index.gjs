import { pageTitle } from 'ember-page-title';
import { LinkTo } from '@ember/routing';
import PageContainer from 'coach-bot/components/page-container';

<template>
  {{pageTitle "Chat logs"}}
  <PageContainer>
    <h1 class="text-2xl font-semibold">Chat logs</h1>
    <p class="mt-1 text-sm text-muted">
      Every user's conversation, most recently active first.
    </p>

    {{#if @model.error}}
      <p role="alert" class="mt-4 text-sm text-red-400">{{@model.error}}</p>
    {{else if @model.summaries.length}}
      <ul class="mt-6 flex flex-col gap-3">
        {{#each @model.summaries as |summary|}}
          <li>
            <LinkTo
              @route="signed-in.admin.chats.chat"
              @model={{summary.id}}
              class="block rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent"
            >
              <p class="text-xs text-muted">
                User
                {{summary.userId}}
                · updated
                {{summary.updatedAt}}
              </p>
              <p class="mt-1 text-sm text-ink">
                {{if
                  summary.lastUserMessageExcerpt
                  summary.lastUserMessageExcerpt
                  "No user messages yet."
                }}
              </p>
            </LinkTo>
          </li>
        {{/each}}
      </ul>
    {{else}}
      <p class="mt-6 text-sm text-muted">No chat logs yet.</p>
    {{/if}}
  </PageContainer>
</template>
