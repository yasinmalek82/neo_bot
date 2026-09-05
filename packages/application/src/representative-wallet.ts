import {
  DomainConflictError,
  assertRepresentativeWalletNonNegative,
  requirePositiveRepresentativeCredit,
  requirePositiveRepresentativeDebit,
  type RepresentativeWallet,
  type RepresentativeWalletLedgerEntry,
} from '@neo-bot/domain';

export interface RepresentativeWalletRepository {
  findRepresentativeByCodeOrTelegram(input: {
    readonly code?: string;
    readonly telegramUserId?: number;
  }): Promise<{ id: string; code: string; telegramUserId: number; active: boolean } | null>;
  getRepresentativeWallet(representativeId: string): Promise<RepresentativeWallet | null>;
  creditRepresentativeWallet(input: {
    readonly representativeId: string;
    readonly amountIrr: bigint;
    readonly kind: 'owner_credit' | 'adjustment';
    readonly idempotencyKey: string;
    readonly note?: string;
  }): Promise<RepresentativeWalletLedgerEntry>;
  debitRepresentativeWallet(input: {
    readonly representativeId: string;
    readonly amountIrr: bigint;
    readonly kind: 'purchase_debit' | 'adjustment';
    readonly idempotencyKey: string;
    readonly salesOrderId?: string;
    readonly note?: string;
  }): Promise<RepresentativeWalletLedgerEntry>;
}

export class RepresentativeWalletUseCase {
  public constructor(private readonly repository: RepresentativeWalletRepository) {}

  public async getBalance(input: {
    readonly code?: string;
    readonly telegramUserId?: number;
  }): Promise<RepresentativeWallet> {
    const rep = await this.requireRepresentative(input);
    const wallet = await this.repository.getRepresentativeWallet(rep.id);
    if (wallet === null) {
      return {
        representativeId: rep.id,
        balanceIrr: 0n,
        updatedAt: new Date(0),
      };
    }
    return wallet;
  }

  public async ownerCredit(command: {
    readonly code?: string;
    readonly telegramUserId?: number;
    readonly amountIrr: bigint;
    readonly idempotencyKey: string;
    readonly note?: string;
  }): Promise<RepresentativeWalletLedgerEntry> {
    requirePositiveRepresentativeCredit(command.amountIrr);
    requireIdempotencyKey(command.idempotencyKey);
    const rep = await this.requireRepresentative(command);
    if (!rep.active) {
      throw new DomainConflictError('REPRESENTATIVE_INACTIVE');
    }
    return this.repository.creditRepresentativeWallet({
      representativeId: rep.id,
      amountIrr: command.amountIrr,
      kind: 'owner_credit',
      idempotencyKey: command.idempotencyKey,
      ...(command.note === undefined ? {} : { note: command.note }),
    });
  }

  public async debitForPurchase(command: {
    readonly representativeId: string;
    readonly amountIrr: bigint;
    readonly salesOrderId: string;
    readonly idempotencyKey: string;
  }): Promise<RepresentativeWalletLedgerEntry> {
    requirePositiveRepresentativeDebit(command.amountIrr);
    requireIdempotencyKey(command.idempotencyKey);
    if (command.representativeId.length < 1) {
      throw new DomainConflictError('INVALID_REPRESENTATIVE');
    }
    if (command.salesOrderId.length < 1) {
      throw new DomainConflictError('INVALID_SALES_ORDER');
    }
    const entry = await this.repository.debitRepresentativeWallet({
      representativeId: command.representativeId,
      amountIrr: command.amountIrr,
      kind: 'purchase_debit',
      idempotencyKey: command.idempotencyKey,
      salesOrderId: command.salesOrderId,
    });
    assertRepresentativeWalletNonNegative(entry.balanceAfterIrr);
    return entry;
  }

  private async requireRepresentative(input: {
    readonly code?: string;
    readonly telegramUserId?: number;
  }): Promise<{ id: string; code: string; telegramUserId: number; active: boolean }> {
    if (input.code === undefined && input.telegramUserId === undefined) {
      throw new DomainConflictError('INVALID_REPRESENTATIVE_LOOKUP');
    }
    const found = await this.repository.findRepresentativeByCodeOrTelegram(input);
    if (found === null) {
      throw new DomainConflictError('REPRESENTATIVE_NOT_FOUND');
    }
    return found;
  }
}

function requireIdempotencyKey(value: string): void {
  if (value.length < 8 || value.length > 200 || !/^[a-zA-Z0-9:._-]+$/u.test(value)) {
    throw new DomainConflictError('INVALID_IDEMPOTENCY_KEY');
  }
}
