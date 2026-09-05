import { InMemoryConversationSessionStore } from '@neo-bot/application';
import { DomainConflictError, CONVERSATION_SESSION_TTL_MS } from '@neo-bot/domain';
import type { DurableConversationSession, TelegramCustomerInput } from '@neo-bot/domain';
import { describe, expect, it, vi } from 'vitest';

import {
  applyFlowTransition,
  FLOW_CANCEL_CALLBACK,
  FLOW_SKIP_COUPON_CALLBACK,
  type ConversationInput,
} from './conversation-flow.js';
import { WalletFlowHandler } from './wallet-flow.js';

const customer: TelegramCustomerInput = {
  telegramUserId: '10001',
  privateChatId: '10001',
  displayName: 'خریدار',
};

const now = new Date('2026-09-05T08:00:00.000Z');

describe('WalletFlowHandler', () => {
  it('resumes amount collection after reconstruction and does not credit yet', async () => {
    const store = new InMemoryConversationSessionStore();
    const wallet = createWallet();
    await WalletFlowHandler.start(store, { telegramUserId: customer.telegramUserId, now });
    const reconstructed = new WalletFlowHandler(wallet, customer);
    const session = requiredSession(await store.getPending(customer.telegramUserId));
    const transition = await reconstructed.handle(session, textInput('31', '50000'), now);
    expect(transition.kind).toBe('continue');
    if (transition.kind === 'continue') {
      expect(transition.screen.id).toBe('wallet.coupon');
      expect(transition.session.payload).toMatchObject({ amountIrr: '50000' });
    }
    expect(wallet.creditTopUp).not.toHaveBeenCalled();
  });

  it('credits once after a reconstructed coupon skip', async () => {
    const store = new InMemoryConversationSessionStore();
    const wallet = createWallet();
    const first = new WalletFlowHandler(wallet, customer);
    let session = await WalletFlowHandler.start(store, {
      telegramUserId: customer.telegramUserId,
      now,
    });
    const amount = await first.handle(session, textInput('32', '۵۰٬۰۰۰'), now);
    if (amount.kind === 'continue') {
      await store.put(amount.session);
    }
    const reconstructed = new WalletFlowHandler(wallet, customer);
    session = requiredSession(await store.getPending(customer.telegramUserId));
    const completed = await reconstructed.handle(
      session,
      callbackInput('33', FLOW_SKIP_COUPON_CALLBACK),
      now,
    );
    expect(completed.kind).toBe('complete');
    if (completed.kind === 'complete') {
      await applyFlowTransition(store, session, completed, now);
    }
    expect(wallet.creditTopUp).toHaveBeenCalledTimes(1);
    expect(wallet.creditTopUp).toHaveBeenCalledWith({
      customer,
      amountIrr: 50_000n,
      idempotencyKey: 'telegram:33:wallet:topup',
    });
    const replay = await reconstructed.handle(
      session,
      callbackInput('33', FLOW_SKIP_COUPON_CALLBACK),
      now,
    );
    if (replay.kind === 'complete') {
      await applyFlowTransition(store, session, replay, now);
    }
    expect(wallet.creditTopUp).toHaveBeenCalledTimes(2);
    expect(wallet.creditTopUp).toHaveBeenNthCalledWith(2, {
      customer,
      amountIrr: 50_000n,
      idempotencyKey: 'telegram:33:wallet:topup',
    });
  });

  it('cancels amount entry on Home without a ledger write', async () => {
    const wallet = createWallet();
    const handler = new WalletFlowHandler(wallet, customer);
    const session = amountSession();
    await expect(handler.handle(session, callbackInput('34', 'menu'), now)).resolves.toEqual({
      kind: 'cancel',
      screen: { id: 'cancelled' },
    });
    expect(wallet.creditTopUp).not.toHaveBeenCalled();
  });

  it('cancels coupon entry without a ledger write', async () => {
    const wallet = createWallet();
    const handler = new WalletFlowHandler(wallet, customer);
    await expect(
      handler.handle(couponSession(), callbackInput('35', FLOW_CANCEL_CALLBACK), now),
    ).resolves.toEqual({ kind: 'cancel', screen: { id: 'cancelled' } });
    expect(wallet.creditTopUp).not.toHaveBeenCalled();
  });

  it('expires a stale wallet session instead of crediting later text', async () => {
    const wallet = createWallet();
    const handler = new WalletFlowHandler(wallet, customer);
    const session = amountSession({ expiresAt: new Date(now.getTime() - 1) });
    await expect(handler.handle(session, textInput('36', '50000'), now)).resolves.toEqual({
      kind: 'expire',
      screen: { id: 'expired' },
    });
    expect(wallet.creditTopUp).not.toHaveBeenCalled();
  });

  it('rejects a malformed wallet payload without a ledger write', async () => {
    const wallet = createWallet();
    const handler = new WalletFlowHandler(wallet, customer);
    const session = {
      ...amountSession(),
      payload: { ticketBody: 'do not persist' },
    } as unknown as DurableConversationSession;
    await expect(handler.handle(session, textInput('37', '50000'), now)).resolves.toEqual({
      kind: 'malformed',
      screen: { id: 'malformed' },
    });
    expect(wallet.creditTopUp).not.toHaveBeenCalled();
  });

  it('ignores an out-of-order coupon skip while waiting for an amount', async () => {
    const wallet = createWallet();
    const handler = new WalletFlowHandler(wallet, customer);
    await expect(
      handler.handle(amountSession(), callbackInput('38', FLOW_SKIP_COUPON_CALLBACK), now),
    ).resolves.toEqual({ kind: 'ignore' });
    expect(wallet.creditTopUp).not.toHaveBeenCalled();
  });
});

function createWallet() {
  return {
    previewDiscount: vi.fn().mockRejectedValue(new DomainConflictError('INVALID_DISCOUNT_CODE')),
    creditTopUp: vi.fn().mockResolvedValue({
      id: '40',
      customerId: '1',
      amountIrr: 50_000n,
      kind: 'topup' as const,
      idempotencyKey: 'telegram:33:wallet:topup',
      discountCode: null,
      createdAt: now,
      replayed: false,
    }),
  };
}

function amountSession(
  overrides: Partial<DurableConversationSession> = {},
): DurableConversationSession {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    telegramUserId: customer.telegramUserId,
    flowId: 'wallet.topup',
    step: 'amount',
    schemaVersion: 1,
    payload: {},
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + CONVERSATION_SESSION_TTL_MS),
    ...overrides,
  };
}

function couponSession(): DurableConversationSession {
  return { ...amountSession(), step: 'coupon', payload: { amountIrr: '50000' } };
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
