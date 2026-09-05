import { describe, expect, it, vi } from 'vitest';

import { RepresentativeWalletUseCase } from './representative-wallet.js';

describe('RepresentativeWalletUseCase', () => {
  it('credits an active representative idempotently via repository', async () => {
    const creditRepresentativeWallet = vi.fn().mockResolvedValue({
      id: '1',
      representativeId: '9',
      amountIrr: 100_000n,
      direction: 'credit',
      kind: 'owner_credit',
      idempotencyKey: 'credit:1',
      salesOrderId: null,
      note: null,
      createdAt: new Date('2026-09-05T00:00:00Z'),
      replayed: false,
      balanceAfterIrr: 100_000n,
    });
    const useCase = new RepresentativeWalletUseCase({
      findRepresentativeByCodeOrTelegram: vi.fn().mockResolvedValue({
        id: '9',
        code: 'alpha',
        telegramUserId: 42,
        active: true,
      }),
      getRepresentativeWallet: vi.fn(),
      creditRepresentativeWallet,
      debitRepresentativeWallet: vi.fn(),
    });

    const entry = await useCase.ownerCredit({
      code: 'alpha',
      amountIrr: 100_000n,
      idempotencyKey: 'credit:1',
    });

    expect(entry.balanceAfterIrr).toBe(100_000n);
    expect(creditRepresentativeWallet).toHaveBeenCalledWith({
      representativeId: '9',
      amountIrr: 100_000n,
      kind: 'owner_credit',
      idempotencyKey: 'credit:1',
    });
  });

  it('rejects inactive representatives for owner credit', async () => {
    const useCase = new RepresentativeWalletUseCase({
      findRepresentativeByCodeOrTelegram: vi.fn().mockResolvedValue({
        id: '9',
        code: 'alpha',
        telegramUserId: 42,
        active: false,
      }),
      getRepresentativeWallet: vi.fn(),
      creditRepresentativeWallet: vi.fn(),
      debitRepresentativeWallet: vi.fn(),
    });

    await expect(
      useCase.ownerCredit({
        code: 'alpha',
        amountIrr: 1000n,
        idempotencyKey: 'credit:inactive',
      }),
    ).rejects.toThrow('REPRESENTATIVE_INACTIVE');
  });

  it('debits purchase amounts with order-scoped idempotency', async () => {
    const debitRepresentativeWallet = vi.fn().mockResolvedValue({
      id: '2',
      representativeId: '9',
      amountIrr: -50_000n,
      direction: 'debit',
      kind: 'purchase_debit',
      idempotencyKey: 'order:77:debit',
      salesOrderId: '77',
      note: null,
      createdAt: new Date('2026-09-05T00:00:00Z'),
      replayed: false,
      balanceAfterIrr: 50_000n,
    });
    const useCase = new RepresentativeWalletUseCase({
      findRepresentativeByCodeOrTelegram: vi.fn(),
      getRepresentativeWallet: vi.fn(),
      creditRepresentativeWallet: vi.fn(),
      debitRepresentativeWallet,
    });

    const entry = await useCase.debitForPurchase({
      representativeId: '9',
      amountIrr: 50_000n,
      salesOrderId: '77',
      idempotencyKey: 'order:77:debit',
    });

    expect(entry.amountIrr).toBe(-50_000n);
    expect(debitRepresentativeWallet).toHaveBeenCalledTimes(1);
  });
});
