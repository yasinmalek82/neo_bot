import {
  DomainConflictError,
  parseWalletAmountIrr,
  requirePositiveWalletCredit,
  validateDiscountCode,
  validateTelegramCustomerInput,
  type TelegramCustomerInput,
  type WalletLedgerEntry,
} from '@neo-bot/domain';

import type { CommerceRepository } from './commerce-ports.js';

export class WalletUseCase {
  public constructor(private readonly repository: CommerceRepository) {}

  public async creditTopUp(command: {
    readonly customer: TelegramCustomerInput;
    readonly amountIrr: bigint | string;
    readonly idempotencyKey: string;
    readonly discountCode?: string;
  }): Promise<WalletLedgerEntry> {
    validateTelegramCustomerInput(command.customer);
    requireIdempotencyKey(command.idempotencyKey);
    const amountIrr =
      typeof command.amountIrr === 'string'
        ? parseWalletAmountIrr(command.amountIrr)
        : command.amountIrr;
    requirePositiveWalletCredit(amountIrr);
    const discountCode =
      command.discountCode === undefined ? undefined : validateDiscountCode(command.discountCode);
    if (discountCode !== undefined) {
      const found = await this.repository.findDiscountCode(discountCode);
      if (found === null) {
        throw new DomainConflictError('INVALID_DISCOUNT_CODE');
      }
    }
    const { customer } = await this.repository.upsertTelegramCustomer(command.customer);
    return this.repository.creditWalletTopUp({
      customerId: customer.id,
      amountIrr,
      idempotencyKey: command.idempotencyKey,
      ...(discountCode === undefined ? {} : { discountCode }),
    });
  }
}

function requireIdempotencyKey(value: string): void {
  if (value.length < 8 || value.length > 200 || !/^[a-zA-Z0-9:._-]+$/u.test(value)) {
    throw new DomainConflictError('INVALID_IDEMPOTENCY_KEY');
  }
}
