import { DomainConflictError } from './errors.js';

export const REPRESENTATIVE_WALLET_LEDGER_KINDS = [
  'owner_credit',
  'purchase_debit',
  'adjustment',
] as const;

export type RepresentativeWalletLedgerKind = (typeof REPRESENTATIVE_WALLET_LEDGER_KINDS)[number];

export type RepresentativeWalletDirection = 'credit' | 'debit';

export interface RepresentativeWallet {
  readonly representativeId: string;
  readonly balanceIrr: bigint;
  readonly updatedAt: Date;
}

export interface RepresentativeWalletLedgerEntry {
  readonly id: string;
  readonly representativeId: string;
  readonly amountIrr: bigint;
  readonly direction: RepresentativeWalletDirection;
  readonly kind: RepresentativeWalletLedgerKind;
  readonly idempotencyKey: string;
  readonly salesOrderId: string | null;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly replayed: boolean;
  readonly balanceAfterIrr: bigint;
}

export function requirePositiveRepresentativeCredit(amountIrr: bigint): void {
  if (amountIrr <= 0n) {
    throw new DomainConflictError('INVALID_REPRESENTATIVE_WALLET_AMOUNT');
  }
}

export function requirePositiveRepresentativeDebit(amountIrr: bigint): void {
  if (amountIrr <= 0n) {
    throw new DomainConflictError('INVALID_REPRESENTATIVE_WALLET_AMOUNT');
  }
}

export function assertRepresentativeWalletNonNegative(balanceIrr: bigint): void {
  if (balanceIrr < 0n) {
    throw new DomainConflictError('INSUFFICIENT_REPRESENTATIVE_WALLET');
  }
}
