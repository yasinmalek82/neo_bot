import { DomainConflictError } from './errors.js';

export const WALLET_LEDGER_KINDS = ['topup', 'referral'] as const;

export type WalletLedgerKind = (typeof WALLET_LEDGER_KINDS)[number];

export interface CustomerWallet {
  readonly customerId: string;
  readonly balanceIrr: bigint;
  readonly updatedAt: Date;
}

export interface WalletLedgerEntry {
  readonly id: string;
  readonly customerId: string;
  readonly amountIrr: bigint;
  readonly kind: WalletLedgerKind;
  readonly idempotencyKey: string;
  readonly discountCode: string | null;
  readonly createdAt: Date;
  readonly replayed: boolean;
}

export function requireNonNegativeWalletBalance(balanceIrr: bigint): void {
  if (balanceIrr < 0n) {
    throw new DomainConflictError('NEGATIVE_WALLET_BALANCE');
  }
}

export function requirePositiveWalletCredit(amountIrr: bigint): void {
  if (amountIrr <= 0n) {
    throw new DomainConflictError('INVALID_WALLET_AMOUNT');
  }
}
