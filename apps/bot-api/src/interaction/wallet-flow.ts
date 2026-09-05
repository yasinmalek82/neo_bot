import { randomUUID } from 'node:crypto';

import {
  continueConversationSession,
  startConversationSession,
  type ConversationSessionStore,
} from '@neo-bot/application';
import {
  DomainConflictError,
  parseWalletAmountIrr,
  validateDiscountCode,
  type DurableConversationSession,
  type TelegramCustomerInput,
  type WalletLedgerEntry,
  type WalletTopUpPayload,
} from '@neo-bot/domain';

import {
  defaultRecover,
  FLOW_SKIP_COUPON_CALLBACK,
  isGlobalCancelInput,
  type ConversationFlowHandler,
  type ConversationInput,
  type ConversationRecovery,
  type FlowTransition,
} from './conversation-flow.js';

interface WalletFlowPorts {
  previewDiscount(code: string): Promise<string>;
  creditTopUp(command: {
    readonly customer: TelegramCustomerInput;
    readonly amountIrr: bigint;
    readonly idempotencyKey: string;
    readonly discountCode?: string;
  }): Promise<WalletLedgerEntry>;
}

export class WalletFlowHandler implements ConversationFlowHandler {
  public readonly flowId = 'wallet.topup' as const;
  public readonly schemaVersion = 1;

  public constructor(
    private readonly wallet: WalletFlowPorts,
    private readonly customer: TelegramCustomerInput,
  ) {}

  public static async start(
    store: ConversationSessionStore,
    input: { readonly telegramUserId: string; readonly now: Date },
  ): Promise<DurableConversationSession> {
    const session = startConversationSession({
      id: randomUUID(),
      telegramUserId: input.telegramUserId,
      flowId: 'wallet.topup',
      step: 'amount',
      payload: {},
      now: input.now,
    });
    return store.put(session);
  }

  public ownsInput(session: DurableConversationSession, input: ConversationInput): boolean {
    if (isGlobalCancelInput(input)) {
      return true;
    }
    if (session.step === 'amount') {
      return input.kind === 'text' && (input.text ?? '').trim().length > 0;
    }
    return (
      (input.kind === 'callback' && input.callbackData === FLOW_SKIP_COUPON_CALLBACK) ||
      (input.kind === 'text' && (input.text ?? '').trim().length > 0)
    );
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
    const payload = session.payload as WalletTopUpPayload;
    if (session.step === 'amount') {
      try {
        const amountIrr = parseWalletAmountIrr(input.text ?? '');
        const next = continueConversationSession(session, {
          step: 'coupon',
          payload: { ...payload, amountIrr: amountIrr.toString() },
          now,
        });
        return { kind: 'continue', session: next, screen: { id: 'wallet.coupon' } };
      } catch (error: unknown) {
        if (error instanceof DomainConflictError && error.code === 'INVALID_WALLET_AMOUNT') {
          return { kind: 'reject', session, screen: { id: 'wallet.invalid-amount' } };
        }
        throw error;
      }
    }
    if (payload.amountIrr === undefined) {
      return { kind: 'malformed', screen: { id: 'malformed' } };
    }
    let discountCode: string | undefined;
    if (!(input.kind === 'callback' && input.callbackData === FLOW_SKIP_COUPON_CALLBACK)) {
      try {
        validateDiscountCode(input.text ?? '');
        discountCode = await this.wallet.previewDiscount(input.text ?? '');
      } catch (error: unknown) {
        if (error instanceof DomainConflictError && error.code === 'INVALID_DISCOUNT_CODE') {
          return { kind: 'reject', session, screen: { id: 'wallet.invalid-coupon' } };
        }
        throw error;
      }
    }
    const entry = await this.wallet.creditTopUp({
      customer: this.customer,
      amountIrr: BigInt(payload.amountIrr),
      idempotencyKey: `telegram:${input.updateId}:wallet:topup`,
      ...(discountCode === undefined ? {} : { discountCode }),
    });
    return {
      kind: 'complete',
      screen: { id: 'wallet.credited', replayed: entry.replayed },
      effect: { type: 'wallet-credit', entryId: entry.id, replayed: entry.replayed },
    };
  }
}
