import type { TelegramCustomerInput, WalletLedgerEntry } from '@neo-bot/domain';
import { describe, expect, it, vi } from 'vitest';

import type { CommerceRepository } from './commerce-ports.js';
import { WalletUseCase } from './wallet.js';

const customer: TelegramCustomerInput = {
  telegramUserId: '10001',
  privateChatId: '10001',
  username: 'buyer',
  displayName: 'خریدار',
};

describe('WalletUseCase', () => {
  it('credits a top-up once for the same Telegram update key', async () => {
    const entry: WalletLedgerEntry = {
      id: '10',
      customerId: '1',
      amountIrr: 50_000n,
      kind: 'topup',
      idempotencyKey: 'telegram:44:wallet:topup',
      discountCode: null,
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
      replayed: false,
    };
    const creditWalletTopUp = vi
      .fn()
      .mockResolvedValueOnce(entry)
      .mockResolvedValueOnce({ ...entry, replayed: true });
    const repository = {
      upsertTelegramCustomer: vi.fn().mockResolvedValue({
        customer: { ...customer, id: '1', username: 'buyer' },
        created: false,
      }),
      findDiscountCode: vi.fn().mockResolvedValue(null),
      creditWalletTopUp,
    } as unknown as CommerceRepository;
    const useCase = new WalletUseCase(repository);

    await expect(
      useCase.creditTopUp({
        customer,
        amountIrr: 50_000n,
        idempotencyKey: 'telegram:44:wallet:topup',
      }),
    ).resolves.toEqual(entry);
    await expect(
      useCase.creditTopUp({
        customer,
        amountIrr: 50_000n,
        idempotencyKey: 'telegram:44:wallet:topup',
      }),
    ).resolves.toMatchObject({ replayed: true, amountIrr: 50_000n });
    expect(creditWalletTopUp).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-positive top-up before touching the ledger', async () => {
    const creditWalletTopUp = vi.fn();
    const useCase = new WalletUseCase({
      upsertTelegramCustomer: vi.fn(),
      findDiscountCode: vi.fn(),
      creditWalletTopUp,
    } as unknown as CommerceRepository);

    await expect(
      useCase.creditTopUp({
        customer,
        amountIrr: 0n,
        idempotencyKey: 'telegram:45:wallet:topup',
      }),
    ).rejects.toThrow('INVALID_WALLET_AMOUNT');
    expect(creditWalletTopUp).not.toHaveBeenCalled();
  });
});
