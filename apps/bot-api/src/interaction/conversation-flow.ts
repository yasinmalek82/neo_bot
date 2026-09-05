import {
  CONVERSATION_SESSION_SCHEMA_VERSION,
  parseConversationPayload,
  parseDurableConversationSession,
  type ConversationFlowId,
  type DurableConversationSession,
} from '@neo-bot/domain';
import type { ConversationSessionStore } from '@neo-bot/application';

export const FLOW_CANCEL_CALLBACK = 'flow:cancel';
export const FLOW_SKIP_COUPON_CALLBACK = 'flow:skip-coupon';
export const WALLET_TOPUP_CALLBACK = 'wallet:topup';
export const TICKET_NEW_CALLBACK = 'ticket:new';
export const TICKET_FOLLOW_PREFIX = 'ticket:follow:';

export type ConversationInputKind = 'text' | 'callback';

export interface ConversationInput {
  readonly kind: ConversationInputKind;
  readonly updateId: string;
  readonly telegramUserId: string;
  readonly text?: string;
  readonly callbackData?: string;
}

export type ConversationRecovery =
  { readonly kind: 'resume' } | { readonly kind: 'expired' } | { readonly kind: 'malformed' };

export type FlowScreenId =
  | 'purchase.naming'
  | 'purchase.coupon'
  | 'purchase.invalid-username'
  | 'purchase.invalid-coupon'
  | 'purchase.checkout'
  | 'renewal.coupon'
  | 'renewal.invalid-coupon'
  | 'renewal.preview'
  | 'renewal.checkout'
  | 'wallet.amount'
  | 'wallet.coupon'
  | 'wallet.invalid-amount'
  | 'wallet.invalid-coupon'
  | 'wallet.credited'
  | 'support.create'
  | 'support.followup'
  | 'support.invalid-body'
  | 'support.submitted'
  | 'home'
  | 'expired'
  | 'malformed'
  | 'cancelled';

export interface BotScreenModel {
  readonly id: FlowScreenId;
  readonly variantName?: string;
  readonly ticketId?: string;
  readonly replayed?: boolean;
}

export type FlowTransition =
  | {
      readonly kind: 'continue';
      readonly session: DurableConversationSession;
      readonly screen: BotScreenModel;
    }
  | {
      readonly kind: 'complete';
      readonly screen: BotScreenModel;
      readonly effect?: FlowEffect;
    }
  | { readonly kind: 'cancel'; readonly screen: BotScreenModel }
  | { readonly kind: 'expire'; readonly screen: BotScreenModel }
  | { readonly kind: 'malformed'; readonly screen: BotScreenModel }
  | {
      readonly kind: 'reject';
      readonly session: DurableConversationSession;
      readonly screen: BotScreenModel;
    }
  | { readonly kind: 'ignore' };

export type FlowEffect =
  | { readonly type: 'checkout'; readonly orderId: string }
  | { readonly type: 'wallet-credit'; readonly entryId: string; readonly replayed: boolean }
  | { readonly type: 'ticket-write'; readonly ticketId: string; readonly replayed: boolean };

export interface ConversationFlowHandler {
  readonly flowId: ConversationFlowId;
  readonly schemaVersion: number;
  ownsInput(session: DurableConversationSession, input: ConversationInput): boolean;
  recover(session: DurableConversationSession, now: Date): ConversationRecovery;
  handle(
    session: DurableConversationSession,
    input: ConversationInput,
    now: Date,
  ): Promise<FlowTransition>;
}

export class ConversationFlowRegistry {
  private readonly handlers = new Map<ConversationFlowId, ConversationFlowHandler>();

  public register(handler: ConversationFlowHandler): void {
    this.handlers.set(handler.flowId, handler);
  }

  public get(flowId: ConversationFlowId): ConversationFlowHandler | null {
    return this.handlers.get(flowId) ?? null;
  }
}

export function recoverConversationSession(
  session: DurableConversationSession,
  now: Date,
): ConversationRecovery {
  try {
    parseDurableConversationSession(session);
    parseConversationPayload(session.flowId, session.step, session.payload);
  } catch {
    return { kind: 'malformed' };
  }
  if (session.schemaVersion !== CONVERSATION_SESSION_SCHEMA_VERSION) {
    return { kind: 'malformed' };
  }
  if (session.status !== 'pending' || session.expiresAt <= now) {
    return { kind: 'expired' };
  }
  return { kind: 'resume' };
}

export function isGlobalCancelInput(input: ConversationInput): boolean {
  if (input.kind === 'callback') {
    return input.callbackData === 'menu' || input.callbackData === FLOW_CANCEL_CALLBACK;
  }
  const text = input.text?.trim() ?? '';
  return text === '/start' || text.startsWith('/start@') || text === 'منوی اصلی';
}

export async function applyFlowTransition(
  store: ConversationSessionStore,
  session: DurableConversationSession,
  transition: FlowTransition,
  now: Date,
): Promise<void> {
  if (transition.kind === 'continue' || transition.kind === 'reject') {
    await store.put(transition.session);
    return;
  }
  if (transition.kind === 'complete') {
    await store.finish({
      id: session.id,
      telegramUserId: session.telegramUserId,
      status: 'completed',
      now,
    });
    return;
  }
  if (transition.kind === 'cancel') {
    await store.finish({
      id: session.id,
      telegramUserId: session.telegramUserId,
      status: 'canceled',
      now,
    });
    return;
  }
  if (transition.kind === 'expire') {
    await store.finish({
      id: session.id,
      telegramUserId: session.telegramUserId,
      status: 'expired',
      now,
    });
    return;
  }
  if (transition.kind === 'malformed') {
    await store.finish({
      id: session.id,
      telegramUserId: session.telegramUserId,
      status: 'canceled',
      now,
    });
  }
}

export function defaultRecover(
  session: DurableConversationSession,
  now: Date,
): ConversationRecovery {
  return recoverConversationSession(session, now);
}
