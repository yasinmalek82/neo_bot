import { randomUUID } from 'node:crypto';

import { continueConversationSession, startConversationSession, type ConversationSessionStore } from '@neo-bot/application';
import {
  DomainConflictError,
  parseWalletAmountIrr,
  type AdminRepWalletCreditPayload,
  type DurableConversationSession,
  type RepresentativeWalletLedgerEntry,
} from '@neo-bot/domain';

import {
  defaultRecover,
  isGlobalCancelInput,
  type ConversationFlowHandler,
  type ConversationInput,
  type ConversationRecovery,
  type FlowTransition,
} from './conversation-flow.js';

interface RepWalletCreditPorts {
  ownerCredit(command: {
    readonly code?: string;
    readonly telegramUserId?: number;
    readonly amountIrr: bigint;
    readonly idempotencyKey: string;
  }): Promise<RepresentativeWalletLedgerEntry>;
}

export class AdminRepWalletCreditFlowHandler implements ConversationFlowHandler {
  public readonly flowId = 'admin.rep-wallet-credit' as const;
  public readonly schemaVersion = 1;

  public constructor(private readonly wallet: RepWalletCreditPorts) {}

  public static async start(
    store: ConversationSessionStore,
    input: { readonly telegramUserId: string; readonly now: Date },
  ): Promise<DurableConversationSession> {
    return store.put(
      startConversationSession({
        id: randomUUID(),
        telegramUserId: input.telegramUserId,
        flowId: 'admin.rep-wallet-credit',
        step: 'create',
        payload: {},
        now: input.now,
      }),
    );
  }

  public ownsInput(session: DurableConversationSession, input: ConversationInput): boolean {
    if (isGlobalCancelInput(input)) return true;
    return input.kind === 'text' && (input.text ?? '').trim().length > 0;
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
    if (recovery.kind === 'expired') return { kind: 'expire', screen: { id: 'expired' } };
    if (recovery.kind === 'malformed') return { kind: 'malformed', screen: { id: 'malformed' } };
    if (isGlobalCancelInput(input)) return { kind: 'cancel', screen: { id: 'cancelled' } };
    if (!this.ownsInput(session, input)) return { kind: 'ignore' };

    const payload = session.payload as AdminRepWalletCreditPayload;
    if (session.step === 'create') {
      const lookup = parseLookup(input.text ?? '');
      if (lookup === null) return { kind: 'reject', session, screen: { id: 'admin.rep-wallet.invalid-lookup' } };
      const next = continueConversationSession(session, { step: 'amount', payload: lookup, now });
      return { kind: 'continue', session: next, screen: { id: 'admin.rep-wallet.amount' } };
    }
    if (session.step !== 'amount') return { kind: 'malformed', screen: { id: 'malformed' } };

    let amountIrr: bigint;
    try {
      amountIrr = parseWalletAmountIrr(input.text ?? '');
    } catch (error: unknown) {
      if (error instanceof DomainConflictError && error.code.startsWith('INVALID_')) {
        return { kind: 'reject', session, screen: { id: 'admin.rep-wallet.invalid-amount' } };
      }
      throw error;
    }
    const command = {
      ...(payload.code === undefined ? {} : { code: payload.code }),
      ...(payload.telegramUserId === undefined ? {} : { telegramUserId: Number(payload.telegramUserId) }),
      amountIrr,
      idempotencyKey: `telegram:${input.updateId}:rep-wallet-credit`,
    };
    try {
      const entry = await this.wallet.ownerCredit(command);
      return {
        kind: 'complete',
        screen: { id: 'admin.rep-wallet.credited', replayed: entry.replayed },
      };
    } catch (error: unknown) {
      if (!(error instanceof DomainConflictError)) throw error;
      if (error.code === 'REPRESENTATIVE_NOT_FOUND' || error.code === 'REPRESENTATIVE_INACTIVE' || error.code === 'INVALID_REPRESENTATIVE_LOOKUP') {
        return { kind: 'reject', session, screen: { id: 'admin.rep-wallet.invalid-lookup' } };
      }
      if (error.code === 'INVALID_REPRESENTATIVE_WALLET_AMOUNT') {
        return { kind: 'reject', session, screen: { id: 'admin.rep-wallet.invalid-amount' } };
      }
      return { kind: 'reject', session, screen: { id: 'admin.rep-wallet.failed' } };
    }
  }
}

function parseLookup(raw: string): AdminRepWalletCreditPayload | null {
  const value = raw.trim();
  if (/^\d{1,20}$/u.test(value)) return { telegramUserId: value };
  if (value.length < 1 || value.length > 64) return null;
  return { code: value };
}
