import { randomUUID } from 'node:crypto';

import { startConversationSession, type ConversationSessionStore } from '@neo-bot/application';
import {
  DomainConflictError,
  validateTicketBody,
  type DurableConversationSession,
  type SupportTicketPayload,
  type SupportTicketWriteResult,
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

interface SupportFlowPorts {
  create(command: {
    readonly customer: TelegramCustomerInput;
    readonly body: string;
    readonly idempotencyKey: string;
  }): Promise<SupportTicketWriteResult>;
  followUp(command: {
    readonly customer: TelegramCustomerInput;
    readonly ticketId: string;
    readonly body: string;
    readonly idempotencyKey: string;
  }): Promise<SupportTicketWriteResult>;
}

export class SupportFlowHandler implements ConversationFlowHandler {
  public readonly flowId = 'support.ticket' as const;
  public readonly schemaVersion = 1;

  public constructor(
    private readonly tickets: SupportFlowPorts,
    private readonly customer: TelegramCustomerInput,
  ) {}

  public static async startCreate(
    store: ConversationSessionStore,
    input: { readonly telegramUserId: string; readonly now: Date },
  ): Promise<DurableConversationSession> {
    const session = startConversationSession({
      id: randomUUID(),
      telegramUserId: input.telegramUserId,
      flowId: 'support.ticket',
      step: 'create',
      payload: { mode: 'create' },
      now: input.now,
    });
    return store.put(session);
  }

  public static async startFollowUp(
    store: ConversationSessionStore,
    input: { readonly telegramUserId: string; readonly ticketId: string; readonly now: Date },
  ): Promise<DurableConversationSession> {
    const session = startConversationSession({
      id: randomUUID(),
      telegramUserId: input.telegramUserId,
      flowId: 'support.ticket',
      step: 'followup',
      payload: { mode: 'followup', ticketId: input.ticketId },
      now: input.now,
    });
    return store.put(session);
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
    const recovery = this.recover(session, now);
    if (recovery.kind === 'expired') {
      return { kind: 'expire', screen: { id: 'expired' } };
    }
    if (recovery.kind === 'malformed') {
      return { kind: 'malformed', screen: { id: 'malformed' } };
    }
    if (isGlobalCancelInput(input)) {
      return { kind: 'cancel', screen: { id: 'cancelled' } };
    }
    if (!this.ownsInput(session, input)) {
      return { kind: 'ignore' };
    }
    const payload = session.payload as SupportTicketPayload;
    let body: string;
    try {
      body = validateTicketBody(input.text ?? '');
    } catch (error: unknown) {
      if (error instanceof DomainConflictError && error.code === 'INVALID_TICKET_BODY') {
        return {
          kind: 'reject',
          session,
          screen: { id: 'support.invalid-body' },
        };
      }
      throw error;
    }
    const result =
      payload.mode === 'create'
        ? await this.tickets.create({
            customer: this.customer,
            body,
            idempotencyKey: `telegram:${input.updateId}:ticket:create`,
          })
        : await this.tickets.followUp({
            customer: this.customer,
            ticketId: payload.ticketId ?? '',
            body,
            idempotencyKey: `telegram:${input.updateId}:ticket:followup`,
          });
    return {
      kind: 'complete',
      screen: {
        id: 'support.submitted',
        ticketId: result.ticket.id,
        replayed: result.replayed,
      },
      effect: {
        type: 'ticket-write',
        ticketId: result.ticket.id,
        replayed: result.replayed,
      },
    };
  }
}
