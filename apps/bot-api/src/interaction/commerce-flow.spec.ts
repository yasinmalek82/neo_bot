import { InMemoryConversationSessionStore } from '@neo-bot/application';
import {
  CONVERSATION_SESSION_TTL_MS,
  type DurableConversationSession,
  type SalesOrder,
  type TelegramCustomerInput,
} from '@neo-bot/domain';
import { describe, expect, it, vi } from 'vitest';

import { CommerceFlowHandler } from './commerce-flow.js';
import {
  applyFlowTransition,
  FLOW_CANCEL_CALLBACK,
  FLOW_SKIP_COUPON_CALLBACK,
  type ConversationInput,
} from './conversation-flow.js';

const customer: TelegramCustomerInput = {
  telegramUserId: '10001',
  privateChatId: '10001',
  displayName: 'خریدار',
};

const order: SalesOrder = {
  id: '3',
  customerId: '1',
  productVariantId: '2',
  productName: 'اقتصادی',
  variantName: 'یک‌ماهه',
  amountIrr: 1_500_000n,
  kind: 'purchase',
  status: 'awaiting_receipt',
  serviceId: null,
  targetServiceId: null,
  serviceUsernameBase: 'ali_reza',
  failureCode: null,
  createdAt: new Date('2026-09-05T00:00:00.000Z'),
  updatedAt: new Date('2026-09-05T00:00:00.000Z'),
};

const now = new Date('2026-09-05T08:00:00.000Z');

describe('CommerceFlowHandler', () => {
  it('resumes purchase naming after reconstruction and does not checkout yet', async () => {
    const store = new InMemoryConversationSessionStore();
    const commerce = createCommerce();
    await CommerceFlowHandler.startPurchase(store, {
      telegramUserId: customer.telegramUserId,
      variantId: '2',
      variantName: 'یک‌ماهه',
      now,
    });
    const reconstructed = new CommerceFlowHandler('commerce.purchase', commerce, customer);
    const session = requiredSession(await store.getPending(customer.telegramUserId));
    const transition = await reconstructed.handle(session, textInput('11', 'ali_reza'), now);

    expect(transition.kind).toBe('continue');
    if (transition.kind === 'continue') {
      expect(transition.screen.id).toBe('purchase.coupon');
      expect(transition.session.payload).toMatchObject({ usernameBase: 'ali_reza' });
    }
    expect(commerce.beginCheckout).not.toHaveBeenCalled();
  });

  it('completes purchase coupon after restart without a second mutation', async () => {
    const store = new InMemoryConversationSessionStore();
    const commerce = createCommerce();
    const first = new CommerceFlowHandler('commerce.purchase', commerce, customer);
    let session = await CommerceFlowHandler.startPurchase(store, {
      telegramUserId: customer.telegramUserId,
      variantId: '2',
      variantName: 'یک‌ماهه',
      now,
    });
    const named = await first.handle(session, textInput('12', 'ali_reza'), now);
    expect(named.kind).toBe('continue');
    if (named.kind === 'continue') {
      await store.put(named.session);
    }
    const reconstructed = new CommerceFlowHandler('commerce.purchase', commerce, customer);
    session = requiredSession(await store.getPending(customer.telegramUserId));
    const completed = await reconstructed.handle(
      session,
      callbackInput('13', FLOW_SKIP_COUPON_CALLBACK),
      now,
    );
    expect(completed.kind).toBe('complete');
    if (completed.kind === 'complete') {
      await applyFlowTransition(store, session, completed, now);
    }
    const replay = await reconstructed.handle(
      requiredSession({
        ...session,
        step: 'coupon',
        payload: { variantId: '2', variantName: 'یک‌ماهه', usernameBase: 'ali_reza' },
      }),
      callbackInput('13', FLOW_SKIP_COUPON_CALLBACK),
      now,
    );
    if (replay.kind === 'complete') {
      await applyFlowTransition(store, session, replay, now);
    }
    expect(commerce.beginCheckout).toHaveBeenCalledTimes(2);
    expect(commerce.beginCheckout).toHaveBeenNthCalledWith(1, {
      customer,
      productVariantId: '2',
      idempotencyKey: 'telegram:13:buy:2',
      serviceUsernameBase: 'ali_reza',
    });
    expect(commerce.beginCheckout).toHaveBeenNthCalledWith(2, {
      customer,
      productVariantId: '2',
      idempotencyKey: 'telegram:13:buy:2',
      serviceUsernameBase: 'ali_reza',
    });
  });

  it('cancels purchase naming on Home without creating an order', async () => {
    const store = new InMemoryConversationSessionStore();
    const commerce = createCommerce();
    const handler = new CommerceFlowHandler('commerce.purchase', commerce, customer);
    const session = await CommerceFlowHandler.startPurchase(store, {
      telegramUserId: customer.telegramUserId,
      variantId: '2',
      variantName: 'یک‌ماهه',
      now,
    });
    const transition = await handler.handle(session, callbackInput('14', 'menu'), now);
    expect(transition).toEqual({ kind: 'cancel', screen: { id: 'cancelled' } });
    expect(commerce.beginCheckout).not.toHaveBeenCalled();
  });

  it('cancels a purchase coupon on explicit cancel', async () => {
    const commerce = createCommerce();
    const handler = new CommerceFlowHandler('commerce.purchase', commerce, customer);
    const session = couponSession();
    await expect(
      handler.handle(session, callbackInput('15', FLOW_CANCEL_CALLBACK), now),
    ).resolves.toEqual({ kind: 'cancel', screen: { id: 'cancelled' } });
    expect(commerce.beginCheckout).not.toHaveBeenCalled();
  });

  it('expires a stale purchase session instead of consuming later text', async () => {
    const commerce = createCommerce();
    const handler = new CommerceFlowHandler('commerce.purchase', commerce, customer);
    const session = namingSession({
      expiresAt: new Date(now.getTime() - 1),
    });
    const transition = await handler.handle(session, textInput('16', 'ali_reza'), now);
    expect(transition).toEqual({ kind: 'expire', screen: { id: 'expired' } });
    expect(commerce.beginCheckout).not.toHaveBeenCalled();
  });

  it('rejects a malformed purchase payload without checkout', async () => {
    const commerce = createCommerce();
    const handler = new CommerceFlowHandler('commerce.purchase', commerce, customer);
    const session = {
      ...namingSession(),
      payload: { body: 'secret ticket' },
    } as unknown as DurableConversationSession;
    const transition = await handler.handle(session, textInput('17', 'ali_reza'), now);
    expect(transition).toEqual({ kind: 'malformed', screen: { id: 'malformed' } });
    expect(commerce.beginCheckout).not.toHaveBeenCalled();
  });

  it('ignores an out-of-order coupon skip while still naming', async () => {
    const commerce = createCommerce();
    const handler = new CommerceFlowHandler('commerce.purchase', commerce, customer);
    const session = namingSession();
    const transition = await handler.handle(
      session,
      callbackInput('18', FLOW_SKIP_COUPON_CALLBACK),
      now,
    );
    expect(transition).toEqual({ kind: 'ignore' });
    expect(commerce.beginCheckout).not.toHaveBeenCalled();
  });

  it('resumes a renewal coupon after reconstruction and confirms once', async () => {
    const store = new InMemoryConversationSessionStore();
    const commerce = createCommerce();
    commerce.previewDiscount = vi.fn().mockResolvedValue('SAVE10');
    await CommerceFlowHandler.startRenewal(store, {
      telegramUserId: customer.telegramUserId,
      now,
    });
    const reconstructed = new CommerceFlowHandler('commerce.renewal', commerce, customer);
    let session = requiredSession(await store.getPending(customer.telegramUserId));
    const couponed = await reconstructed.handle(session, textInput('21', 'save10'), now);
    expect(couponed.kind).toBe('continue');
    if (couponed.kind === 'continue') {
      await store.put(couponed.session);
      expect(couponed.screen.id).toBe('renewal.preview');
    }
    session = requiredSession(await store.getPending(customer.telegramUserId));
    const confirmed = await reconstructed.handle(
      session,
      callbackInput('22', 'renew:confirm'),
      now,
    );
    expect(confirmed.kind).toBe('complete');
    expect(commerce.beginRenewal).toHaveBeenCalledTimes(1);
    expect(commerce.beginRenewal).toHaveBeenCalledWith({
      customer,
      idempotencyKey: 'telegram:22:renew',
      discountCode: 'SAVE10',
    });
  });

  it('ignores an out-of-order renewal confirm before the coupon is collected', async () => {
    const commerce = createCommerce();
    const handler = new CommerceFlowHandler('commerce.renewal', commerce, customer);
    const session = await CommerceFlowHandler.startRenewal(new InMemoryConversationSessionStore(), {
      telegramUserId: customer.telegramUserId,
      now,
    });
    await expect(
      handler.handle(session, callbackInput('23', 'renew:confirm'), now),
    ).resolves.toEqual({ kind: 'ignore' });
    expect(commerce.beginRenewal).not.toHaveBeenCalled();
  });

  it('expires a renewal coupon session instead of applying a late code', async () => {
    const commerce = createCommerce();
    const handler = new CommerceFlowHandler('commerce.renewal', commerce, customer);
    const session = {
      ...namingSession(),
      flowId: 'commerce.renewal' as const,
      step: 'coupon' as const,
      payload: {},
      expiresAt: new Date(now.getTime() - CONVERSATION_SESSION_TTL_MS),
    };
    await expect(handler.handle(session, textInput('24', 'SAVE10'), now)).resolves.toEqual({
      kind: 'expire',
      screen: { id: 'expired' },
    });
    expect(commerce.beginRenewal).not.toHaveBeenCalled();
  });
});

function createCommerce() {
  return {
    beginCheckout: vi.fn().mockResolvedValue(order),
    beginRenewal: vi.fn().mockResolvedValue({ ...order, kind: 'renewal' as const }),
    previewDiscount: vi.fn().mockRejectedValue(new Error('INVALID_DISCOUNT_CODE')),
  };
}

function namingSession(
  overrides: Partial<DurableConversationSession> = {},
): DurableConversationSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    telegramUserId: customer.telegramUserId,
    flowId: 'commerce.purchase',
    step: 'naming',
    schemaVersion: 1,
    payload: { variantId: '2', variantName: 'یک‌ماهه' },
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + CONVERSATION_SESSION_TTL_MS),
    ...overrides,
  };
}

function couponSession(): DurableConversationSession {
  return {
    ...namingSession(),
    step: 'coupon',
    payload: { variantId: '2', variantName: 'یک‌ماهه', usernameBase: 'ali_reza' },
  };
}

function textInput(updateId: string, text: string): ConversationInput {
  return { kind: 'text', updateId, telegramUserId: customer.telegramUserId, text };
}

function callbackInput(updateId: string, callbackData: string): ConversationInput {
  return { kind: 'callback', updateId, telegramUserId: customer.telegramUserId, callbackData };
}

function requiredSession(session: DurableConversationSession | null): DurableConversationSession {
  if (session === null) {
    throw new Error('expected pending session');
  }
  return session;
}
