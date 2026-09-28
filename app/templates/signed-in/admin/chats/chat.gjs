import { pageTitle } from 'ember-page-title';
import PageContainer from 'coach-bot/components/page-container';
import MarkOnboardedButton from 'coach-bot/components/mark-onboarded-button';

<template>
  {{pageTitle "Chat log"}}
  <PageContainer>
    <h1 class="text-2xl font-semibold">Chat log</h1>

    {{#if @model.error}}
      <p role="alert" class="mt-4 text-sm text-red-400">{{@model.error}}</p>
    {{else}}
      {{#if @model.conversation.summary}}
        <div class="mt-4 rounded-lg border border-accent bg-accent/10 p-4">
          <h2
            class="text-xs font-semibold tracking-wide text-accent uppercase"
          >Summary</h2>
          <p
            class="mt-2 text-sm whitespace-pre-wrap text-ink"
          >{{@model.conversation.summary}}</p>
        </div>
      {{/if}}

      <div class="mt-4 grid min-w-0 gap-6 lg:grid-cols-2">
        <div
          class="h-fit min-w-0 rounded-lg border-2 border-accent bg-accent/10 p-4"
        >
          <h2 class="text-xl font-semibold break-words text-ink">
            {{if
              @model.conversation.user.fullName
              @model.conversation.user.fullName
              @model.conversation.user.email
            }}
          </h2>

          <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt class="text-muted">Email</dt>
            <dd
              class="break-words text-ink"
            >{{@model.conversation.user.email}}</dd>

            {{#if @model.conversation.user.fullName}}
              <dt class="text-muted">Name</dt>
              <dd class="text-ink">{{@model.conversation.user.fullName}}</dd>
            {{/if}}

            <dt class="text-muted">Last login</dt>
            <dd class="text-ink">
              {{if
                @model.conversation.user.lastSignInAt
                @model.conversation.user.lastSignInAt
                "Never"
              }}
            </dd>

            <dt class="text-muted">Onboarding status</dt>
            <dd
              class="text-ink"
            >{{@model.conversation.user.onboardingStatus}}</dd>
          </dl>

          {{#if @model.conversation.user.isPending}}
            <div class="mt-4">
              <MarkOnboardedButton @userId={{@model.conversation.user.id}} />
            </div>
          {{/if}}
        </div>

        <details class="h-fit rounded-lg border border-border bg-surface">
          <summary
            class="cursor-pointer px-4 py-3 text-sm font-medium text-ink select-none"
          >Full conversation ({{@model.conversation.sortedMessages.length}}
            messages)</summary>
          <div class="flex flex-col gap-3 border-t border-border p-4">
            {{#each @model.conversation.sortedMessages as |message|}}
              <div
                class="flex
                  {{if message.isFromUser 'justify-end' 'justify-start'}}"
              >
                <div
                  class="max-w-[85%] rounded-lg px-3 py-2 text-sm
                    {{if
                      message.isFromUser
                      'rounded-br-sm bg-accent text-canvas'
                      'rounded-bl-sm border border-border bg-canvas text-ink'
                    }}"
                >
                  <p class="whitespace-pre-wrap">{{message.content}}</p>
                </div>
              </div>
            {{else}}
              <p class="text-sm text-muted">No messages in this conversation.</p>
            {{/each}}
          </div>
        </details>
      </div>
    {{/if}}
  </PageContainer>
</template>
