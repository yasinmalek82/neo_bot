import { InMemoryConversationSessionStore } from '@neo-bot/application';
import { describe, expect, it, vi } from 'vitest';

import { AdminRepWalletCreditFlowHandler } from './admin-rep-wallet-flow.js';

describe('AdminRepWalletCreditFlowHandler', () => {
  it.each([
    [{ code: 'rep-a' }, 'code lookup'],
    [{ telegramUserId: 70001 }, 'telegram lookup'],
  ])('credits a representative by %s', async (lookup, label) => {
    const store = new InMemoryConversationSessionStore();
    const ownerCredit = vi.fn().mockResolvedValue({
      id: '99',
      representativeId: '8',
      amountIrr: 900000n,
      direction: 'credit',
      kind: 'owner_credit',
      idempotencyKey: 'telegram:2:rep-wallet-credit',
      salesOrderId: null,
      note: null,
      createdAt: new Date(),
      replayed: false,
      balanceAfterIrr: 900000n,
    });
    const handler = new AdminRepWalletCreditFlowHandler({ ownerCredit });
    await AdminRepWalletCreditFlowHandler.start(store, {
      telegramUserId: '70000',
      now: new Date(),
    });
    const session = await store.getPending('70000');
    expect(session).not.toBeNull();
    const first = await handler.handle(
      session!,
      {
        kind: 'text',
        updateId: '1',
        telegramUserId: '70000',
        text: label === 'code lookup' ? 'rep-a' : '70001',
      },
      new Date(),
    );
    expect(first.kind).toBe('continue');
    const second = await handler.handle(
      first.kind === 'continue' ? first.session : session!,
      { kind: 'text', updateId: '2', telegramUserId: '70000', text: '900000' },
      new Date(),
    );
    expect(second.kind).toBe('complete');
    expect(ownerCredit).toHaveBeenCalledWith({
      ...lookup,
      amountIrr: 900000n,
      idempotencyKey: 'telegram:2:rep-wallet-credit',
    });
  });

  it('rejects an insufficient or invalid amount without crediting', async () => {
    const store = new InMemoryConversationSessionStore();
    const ownerCredit = vi.fn();
    const handler = new AdminRepWalletCreditFlowHandler({ ownerCredit });
    await AdminRepWalletCreditFlowHandler.start(store, {
      telegramUserId: '70000',
      now: new Date(),
    });
    const session = await store.getPending('70000');
    const first = await handler.handle(
      session!,
      { kind: 'text', updateId: '1', telegramUserId: '70000', text: 'rep-a' },
      new Date(),
    );
    const rejected = await handler.handle(
      first.kind === 'continue' ? first.session : session!,
      { kind: 'text', updateId: '2', telegramUserId: '70000', text: '0' },
      new Date(),
    );
    expect(rejected).toMatchObject({
      kind: 'reject',
      screen: { id: 'admin.rep-wallet.invalid-amount' },
    });
    expect(ownerCredit).not.toHaveBeenCalled();
  });
});
