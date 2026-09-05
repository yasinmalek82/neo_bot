import { randomUUID } from 'node:crypto';

import {
  continueConversationSession,
  startConversationSession,
  type ConversationSessionStore,
} from '@neo-bot/application';
import {
  DomainConflictError,
  validateDiscountCode,
  validateServiceUsernameBase,
  type CommercePurchasePayload,
  type CommerceRenewalPayload,
  type DurableConversationSession,
  type SalesOrder,
  type TelegramCustomerInput,
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

interface CommerceFlowPorts {
  beginCheckout(command: {
    readonly customer: TelegramCustomerInput;
    readonly productVariantId: string;
    readonly idempotencyKey: string;
    readonly serviceUsernameBase: string;
    readonly discountCode?: string;
  }): Promise<SalesOrder>;
  beginRenewal(command: {
    readonly customer: TelegramCustomerInput;
    readonly idempotencyKey: string;
    readonly discountCode?: string;
  }): Promise<SalesOrder>;
  previewDiscount(code: string): Promise<string>;
}

export class CommerceFlowHandler implements ConversationFlowHandler {
  public readonly flowId;
  public readonly schemaVersion = 1;

  public constructor(
    flowId: 'commerce.purchase' | 'commerce.renewal',
    private readonly commerce: CommerceFlowPorts,
    private readonly customer: TelegramCustomerInput,
  ) {
    this.flowId = flowId;
  }

  public static async startPurchase(
    store: ConversationSessionStore,
    input: {
      readonly telegramUserId: string;
      readonly variantId: string;
      readonly variantName: string;
      readonly now: Date;
    },
  ): Promise<DurableConversationSession> {
    const session = startConversationSession({
      id: randomUUID(),
      telegramUserId: input.telegramUserId,
      flowId: 'commerce.purchase',
      step: 'naming',
      payload: { variantId: input.variantId, variantName: input.variantName },
      now: input.now,
    });
    return store.put(session);
  }

  public static async startRenewal(
    store: ConversationSessionStore,
    input: { readonly telegramUserId: string; readonly now: Date },
  ): Promise<DurableConversationSession> {
    const session = startConversationSession({
      id: randomUUID(),
      telegramUserId: input.telegramUserId,
      flowId: 'commerce.renewal',
      step: 'coupon',
      payload: {},
      now: input.now,
    });
    return store.put(session);
  }

  public ownsInput(session: DurableConversationSession, input: ConversationInput): boolean {
    if (isGlobalCancelInput(input)) {
      return true;
    }
    if (session.flowId === 'commerce.purchase') {
      if (session.step === 'naming') {
        return input.kind === 'text' && (input.text ?? '').trim().length > 0;
      }
      return isCouponInput(input);
    }
    if (session.step === 'coupon') {
      return isCouponInput(input);
    }
    return input.kind === 'callback' && input.callbackData === 'renew:confirm';
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
    if (session.flowId === 'commerce.purchase') {
      return this.handlePurchase(session, input, now);
    }
    return this.handleRenewal(session, input, now);
  }

  private async handlePurchase(
    session: DurableConversationSession,
    input: ConversationInput,
    now: Date,
  ): Promise<FlowTransition> {
    const payload = session.payload as CommercePurchasePayload;
    if (session.step === 'naming') {
      const usernameBase = (input.text ?? '').trim().toLowerCase();
      try {
        validateServiceUsernameBase(usernameBase);
      } catch (error: unknown) {
        if (
          error instanceof DomainConflictError &&
          error.code === 'INVALID_SERVICE_USERNAME_BASE'
        ) {
          return {
            kind: 'reject',
            session,
            screen: { id: 'purchase.invalid-username', variantName: payload.variantName },
          };
        }
        throw error;
      }
      const next = continueConversationSession(session, {
        step: 'coupon',
        payload: { ...payload, usernameBase },
        now,
      });
      return { kind: 'continue', session: next, screen: { id: 'purchase.coupon' } };
    }
    const usernameBase = payload.usernameBase;
    if (usernameBase === undefined) {
      return { kind: 'malformed', screen: { id: 'malformed' } };
    }
    const discount = await this.readDiscount(input);
    if (discount.kind === 'reject') {
      return {
        kind: 'reject',
        session,
        screen: { id: 'purchase.invalid-coupon' },
      };
    }
    const order = await this.commerce.beginCheckout({
      customer: this.customer,
      productVariantId: payload.variantId,
      idempotencyKey: `telegram:${input.updateId}:buy:${payload.variantId}`,
      serviceUsernameBase: usernameBase,
      ...(discount.code === undefined ? {} : { discountCode: discount.code }),
    });
    return {
      kind: 'complete',
      screen: { id: 'purchase.checkout' },
      effect: { type: 'checkout', orderId: order.id },
    };
  }

  private async handleRenewal(
    session: DurableConversationSession,
    input: ConversationInput,
    now: Date,
  ): Promise<FlowTransition> {
    const payload = session.payload as CommerceRenewalPayload;
    if (session.step === 'coupon') {
      const discount = await this.readDiscount(input);
      if (discount.kind === 'reject') {
        return { kind: 'reject', session, screen: { id: 'renewal.invalid-coupon' } };
      }
      const next = continueConversationSession(session, {
        step: 'confirm',
        payload:
          discount.code === undefined ? payload : { ...payload, discountCode: discount.code },
        now,
      });
      return { kind: 'continue', session: next, screen: { id: 'renewal.preview' } };
    }
    const order = await this.commerce.beginRenewal({
      customer: this.customer,
      idempotencyKey: `telegram:${input.updateId}:renew`,
      ...(payload.discountCode === undefined ? {} : { discountCode: payload.discountCode }),
    });
    return {
      kind: 'complete',
      screen: { id: 'renewal.checkout' },
      effect: { type: 'checkout', orderId: order.id },
    };
  }

  private async readDiscount(
    input: ConversationInput,
  ): Promise<{ readonly kind: 'ok'; readonly code?: string } | { readonly kind: 'reject' }> {
    if (input.kind === 'callback' && input.callbackData === FLOW_SKIP_COUPON_CALLBACK) {
      return { kind: 'ok' };
    }
    const raw = input.text?.trim() ?? '';
    try {
      validateDiscountCode(raw);
      return { kind: 'ok', code: await this.commerce.previewDiscount(raw) };
    } catch (error: unknown) {
      if (error instanceof DomainConflictError && error.code === 'INVALID_DISCOUNT_CODE') {
        return { kind: 'reject' };
      }
      throw error;
    }
  }
}

function isCouponInput(input: ConversationInput): boolean {
  if (input.kind === 'callback') {
    return input.callbackData === FLOW_SKIP_COUPON_CALLBACK;
  }
  return (input.text ?? '').trim().length > 0;
}
