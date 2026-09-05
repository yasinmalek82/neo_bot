import { randomUUID } from 'node:crypto';

import { startConversationSession, type ConversationSessionStore } from '@neo-bot/application';
import {
  DomainConflictError,
  parseForcedJoinChannelInput,
  validateBroadcastBody,
  type AdminOpsField,
  type DurableConversationSession,
  type TelegramCustomerInput,
} from '@neo-bot/domain';

import {
  defaultRecover,
  isGlobalCancelInput,
  type ConversationFlowHandler,
  type ConversationInput,
  type ConversationRecovery,
  type FlowTransition,
} from './conversation-flow.js';

export class AdminBroadcastFlowHandler implements ConversationFlowHandler {
  public readonly flowId = 'admin.broadcast' as const;
  public readonly schemaVersion = 1;

  public constructor(
    private readonly queue: (input: {
      readonly adminTelegramUserId: string;
      readonly body: string;
    }) => Promise<{ readonly id: string }>,
    private readonly admin: TelegramCustomerInput,
  ) {}

  public static async start(
    store: ConversationSessionStore,
    input: { readonly telegramUserId: string; readonly now: Date },
  ): Promise<DurableConversationSession> {
    return store.put(
      startConversationSession({
        id: randomUUID(),
        telegramUserId: input.telegramUserId,
        flowId: 'admin.broadcast',
        step: 'create',
        payload: { mode: 'create' },
        now: input.now,
      }),
    );
  }

  public ownsInput(session: DurableConversationSession, input: ConversationInput): boolean {
    if (isGlobalCancelInput(input)) {
      return true;
    }
    return input.kind === 'text' && (input.text ?? '').trim().length > 0;
  }

  public recover(session: DurableConversationSession, now: Date): ConversationRecovery {
    return defaultRecover(session, now);
  }

  public async handle(
    session: DurableConversationSession,
    input: ConversationInput,
    now: Date,
  ): Promise<FlowTransition> {
    void now;
    if (isGlobalCancelInput(input) || input.kind !== 'text') {
      return { kind: 'ignore' };
    }
    try {
      const body = validateBroadcastBody(input.text ?? '');
      const job = await this.queue({
        adminTelegramUserId: this.admin.telegramUserId,
        body,
      });
      return {
        kind: 'complete',
        screen: { id: 'admin.broadcast.queued', jobId: job.id },
      };
    } catch (error: unknown) {
      if (error instanceof DomainConflictError && error.code === 'INVALID_BROADCAST_BODY') {
        return { kind: 'reject', session, screen: { id: 'admin.broadcast.invalid' } };
      }
      throw error;
    }
  }
}

export class AdminOpsFlowHandler implements ConversationFlowHandler {
  public readonly flowId = 'admin.ops' as const;
  public readonly schemaVersion = 1;

  public constructor(
    private readonly apply: (field: AdminOpsField, text: string) => Promise<void>,
  ) {}

  public static async start(
    store: ConversationSessionStore,
    input: { readonly telegramUserId: string; readonly field: AdminOpsField; readonly now: Date },
  ): Promise<DurableConversationSession> {
    return store.put(
      startConversationSession({
        id: randomUUID(),
        telegramUserId: input.telegramUserId,
        flowId: 'admin.ops',
        step: 'settings',
        payload: { field: input.field },
        now: input.now,
      }),
    );
  }

  public ownsInput(session: DurableConversationSession, input: ConversationInput): boolean {
    if (isGlobalCancelInput(input)) {
      return true;
    }
    return input.kind === 'text' && (input.text ?? '').trim().length > 0;
  }

  public recover(session: DurableConversationSession, now: Date): ConversationRecovery {
    return defaultRecover(session, now);
  }

  public async handle(
    session: DurableConversationSession,
    input: ConversationInput,
    now: Date,
  ): Promise<FlowTransition> {
    void now;
    if (isGlobalCancelInput(input) || input.kind !== 'text') {
      return { kind: 'ignore' };
    }
    const field = 'field' in session.payload ? session.payload.field : undefined;
    if (field === undefined) {
      return { kind: 'malformed', screen: { id: 'malformed' } };
    }
    try {
      if (field === 'channel') {
        parseForcedJoinChannelInput(input.text ?? '');
      }
      await this.apply(field, input.text ?? '');
      return { kind: 'complete', screen: { id: 'admin.ops.saved', field } };
    } catch (error: unknown) {
      if (error instanceof DomainConflictError) {
        return { kind: 'reject', session, screen: { id: 'admin.ops.invalid', field } };
      }
      throw error;
    }
  }
}
