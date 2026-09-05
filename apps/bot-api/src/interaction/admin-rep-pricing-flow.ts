import { randomUUID } from 'node:crypto';

import {
  continueConversationSession,
  startConversationSession,
  type ConversationSessionStore,
  type RepresentativePricingUseCase,
} from '@neo-bot/application';
import {
  DomainConflictError,
  parseWalletAmountIrr,
  type AdminRepPricingAction,
  type AdminRepPricingPayload,
  type DurableConversationSession,
} from '@neo-bot/domain';

import {
  defaultRecover,
  isGlobalCancelInput,
  type ConversationFlowHandler,
  type ConversationInput,
  type ConversationRecovery,
  type FlowTransition,
} from './conversation-flow.js';

export class AdminRepPricingFlowHandler implements ConversationFlowHandler {
  public readonly flowId = 'admin.rep-pricing' as const;
  public readonly schemaVersion = 1;

  public constructor(private readonly pricing: RepresentativePricingUseCase) {}

  public static async start(
    store: ConversationSessionStore,
    input: {
      readonly telegramUserId: string;
      readonly action: AdminRepPricingAction;
      readonly now: Date;
    },
  ): Promise<DurableConversationSession> {
    return store.put(
      startConversationSession({
        id: randomUUID(),
        telegramUserId: input.telegramUserId,
        flowId: 'admin.rep-pricing',
        step: 'create',
        payload: { action: input.action },
        now: input.now,
      }),
    );
  }

  public ownsInput(session: DurableConversationSession, input: ConversationInput): boolean {
    if (isGlobalCancelInput(input)) return true;
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
    if (recovery.kind === 'expired') return { kind: 'expire', screen: { id: 'expired' } };
    if (recovery.kind === 'malformed') return { kind: 'malformed', screen: { id: 'malformed' } };
    if (isGlobalCancelInput(input)) return { kind: 'cancel', screen: { id: 'cancelled' } };
    if (!this.ownsInput(session, input)) return { kind: 'ignore' };
    if (input.kind !== 'text') return { kind: 'ignore' };

    const payload = session.payload as AdminRepPricingPayload;
    try {
      if (session.step === 'create') {
        return await this.handleFirstValue(session, payload, input.text ?? '', now);
      }
      if (session.step !== 'amount') return { kind: 'malformed', screen: { id: 'malformed' } };
      return await this.handleAmount(session, payload, input.text ?? '', now);
    } catch (error: unknown) {
      if (!(error instanceof DomainConflictError)) throw error;
      return { kind: 'reject', session, screen: { id: 'admin.rep-pricing.invalid' } };
    }
  }

  private async handleFirstValue(
    session: DurableConversationSession,
    payload: AdminRepPricingPayload,
    raw: string,
    now: Date,
  ): Promise<FlowTransition> {
    const value = raw.trim();
    if (!/^\d{1,20}$/u.test(value)) {
      throw new DomainConflictError('INVALID_REPRESENTATIVE_LOOKUP');
    }
    const repAction =
      payload.action === 'grant-access' ||
      payload.action === 'revoke-access' ||
      payload.action === 'set-override-price' ||
      payload.action === 'clear-override-price';
    if (repAction) {
      const next = continueConversationSession(session, {
        step: 'amount',
        payload: { action: payload.action, representativeId: value },
        now,
      });
      return { kind: 'continue', session: next, screen: { id: 'admin.rep-pricing.variant' } };
    }
    const nextPayload = { action: payload.action, variantId: value };
    if (payload.action === 'clear-base-price') {
      await this.apply(payload.action, undefined, value);
      return { kind: 'complete', screen: { id: 'admin.rep-pricing.saved', field: payload.action } };
    }
    const next = continueConversationSession(session, {
      step: 'amount',
      payload: nextPayload,
      now,
    });
    return { kind: 'continue', session: next, screen: { id: 'admin.rep-pricing.price' } };
  }

  private async handleAmount(
    session: DurableConversationSession,
    payload: AdminRepPricingPayload,
    raw: string,
    now: Date,
  ): Promise<FlowTransition> {
    const value = raw.trim();
    if (payload.variantId === undefined) {
      if (!/^\d{1,20}$/u.test(value)) throw new DomainConflictError('INVALID_VARIANT');
      if (payload.action === 'clear-override-price') {
        await this.apply(payload.action, payload.representativeId, value);
        return {
          kind: 'complete',
          screen: { id: 'admin.rep-pricing.saved', field: payload.action },
        };
      }
      if (payload.action === 'grant-access' || payload.action === 'revoke-access') {
        await this.apply(payload.action, payload.representativeId, value);
        return {
          kind: 'complete',
          screen: { id: 'admin.rep-pricing.saved', field: payload.action },
        };
      }
      const next = continueConversationSession(session, {
        step: 'amount',
        payload: { ...payload, variantId: value },
        now,
      });
      return { kind: 'continue', session: next, screen: { id: 'admin.rep-pricing.price' } };
    }
    const priceIrr = parseWalletAmountIrr(value);
    await this.apply(payload.action, payload.representativeId, payload.variantId, priceIrr);
    return { kind: 'complete', screen: { id: 'admin.rep-pricing.saved', field: payload.action } };
  }

  private async apply(
    action: AdminRepPricingAction,
    representativeId: string | undefined,
    variantId: string,
    priceIrr?: bigint,
  ): Promise<void> {
    await this.pricing.apply({
      operation: action,
      ...(representativeId === undefined ? {} : { representativeId }),
      variantId,
      ...(priceIrr === undefined ? {} : { priceIrr }),
    });
  }
}
