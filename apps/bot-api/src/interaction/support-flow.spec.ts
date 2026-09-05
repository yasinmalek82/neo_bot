import { InMemoryConversationSessionStore } from '@neo-bot/application';
import { CONVERSATION_SESSION_TTL_MS } from '@neo-bot/domain';
import type { DurableConversationSession, TelegramCustomerInput } from '@neo-bot/domain';
import { describe, expect, it, vi } from 'vitest';

import {
  applyFlowTransition,
  FLOW_CANCEL_CALLBACK,
  type ConversationInput,
} from './conversation-flow.js';
import { SupportFlowHandler } from './support-flow.js';

const customer: TelegramCustomerInput = {
  telegramUserId: '10001',
  privateChatId: '10001',
  displayName: 'خریدار',
};

const now = new Date('2026-09-05T08:00:00.000Z');

describe('SupportFlowHandler', () => {
  it('resumes ticket create after reconstruction and writes the body only once', async () => {
    const store = new InMemoryConversationSessionStore();
    const tickets = createTickets();
    await SupportFlowHandler.startCreate(store, { telegramUserId: customer.telegramUserId, now });
    const reconstructed = new SupportFlowHandler(tickets, customer);
    const session = requiredSession(await store.getPending(customer.telegramUserId));
    expect(session.payload).toEqual({ mode: 'create' });
    expect(JSON.stringify(session.payload)).not.toMatch(/وصل|body/u);
    const completed = await reconstructed.handle(
      session,
      textInput('41', 'سرویس وصل نمی‌شود'),
      now,
    );
    expect(completed.kind).toBe('complete');
    if (completed.kind === 'complete') {
      await applyFlowTransition(store, session, completed, now);
      expect(completed.effect).toEqual({
        type: 'ticket-write',
        ticketId: '8',
        replayed: false,
      });
    }
    expect(tickets.create).toHaveBeenCalledTimes(1);
    expect(tickets.create).toHaveBeenCalledWith({
      customer,
      body: 'سرویس وصل نمی‌شود',
      idempotencyKey: 'telegram:41:ticket:create',
    });
    const replayed = await reconstructed.handle(session, textInput('41', 'سرویس وصل نمی‌شود'), now);
    expect(replayed.kind).toBe('complete');
    expect(tickets.create).toHaveBeenCalledTimes(2);
    expect(tickets.create).toHaveBeenNthCalledWith(2, {
      customer,
      body: 'سرویس وصل نمی‌شود',
      idempotencyKey: 'telegram:41:ticket:create',
    });
  });

  it('resumes follow-up after reconstruction without storing the body on the session', async () => {
    const store = new InMemoryConversationSessionStore();
    const tickets = createTickets();
    await SupportFlowHandler.startFollowUp(store, {
      telegramUserId: customer.telegramUserId,
      ticketId: '8',
      now,
    });
    const reconstructed = new SupportFlowHandler(tickets, customer);
    const session = requiredSession(await store.getPending(customer.telegramUserId));
    expect(session.payload).toEqual({ mode: 'followup', ticketId: '8' });
    expect(JSON.stringify(session)).not.toContain('قطع شد');
    const completed = await reconstructed.handle(session, textInput('42', 'هنوز قطع است'), now);
    expect(completed.kind).toBe('complete');
    expect(tickets.followUp).toHaveBeenCalledWith({
      customer,
      ticketId: '8',
      body: 'هنوز قطع است',
      idempotencyKey: 'telegram:42:ticket:followup',
    });
  });

  it('cancels ticket create on Home without writing', async () => {
    const tickets = createTickets();
    const handler = new SupportFlowHandler(tickets, customer);
    await expect(
      handler.handle(createSession(), callbackInput('43', 'menu'), now),
    ).resolves.toEqual({
      kind: 'cancel',
      screen: { id: 'cancelled' },
    });
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('cancels follow-up on explicit cancel', async () => {
    const tickets = createTickets();
    const handler = new SupportFlowHandler(tickets, customer);
    await expect(
      handler.handle(followUpSession(), callbackInput('44', FLOW_CANCEL_CALLBACK), now),
    ).resolves.toEqual({ kind: 'cancel', screen: { id: 'cancelled' } });
    expect(tickets.followUp).not.toHaveBeenCalled();
  });

  it('expires a stale ticket draft instead of consuming later text', async () => {
    const tickets = createTickets();
    const handler = new SupportFlowHandler(tickets, customer);
    const session = createSession({ expiresAt: new Date(now.getTime() - 1) });
    await expect(handler.handle(session, textInput('45', 'سرویس قطع است'), now)).resolves.toEqual({
      kind: 'expire',
      screen: { id: 'expired' },
    });
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed ticket payload that carried a body', async () => {
    const tickets = createTickets();
    const handler = new SupportFlowHandler(tickets, customer);
    const session = {
      ...createSession(),
      payload: { mode: 'create', body: 'should never persist' },
    } as unknown as DurableConversationSession;
    await expect(handler.handle(session, textInput('46', 'سرویس قطع است'), now)).resolves.toEqual({
      kind: 'malformed',
      screen: { id: 'malformed' },
    });
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('ignores an out-of-order callback while waiting for ticket text', async () => {
    const tickets = createTickets();
    const handler = new SupportFlowHandler(tickets, customer);
    await expect(
      handler.handle(createSession(), callbackInput('47', 'buy:2'), now),
    ).resolves.toEqual({ kind: 'ignore' });
    expect(tickets.create).not.toHaveBeenCalled();
  });
});

function createTickets() {
  const ticket = {
    id: '8',
    customerId: '1',
    status: 'open' as const,
    createdAt: now,
    updatedAt: now,
  };
  return {
    create: vi.fn().mockResolvedValue({ ticket, replayed: false }),
    followUp: vi.fn().mockResolvedValue({ ticket, replayed: false }),
  };
}

function createSession(
  overrides: Partial<DurableConversationSession> = {},
): DurableConversationSession {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    telegramUserId: customer.telegramUserId,
    flowId: 'support.ticket',
    step: 'create',
    schemaVersion: 1,
    payload: { mode: 'create' },
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + CONVERSATION_SESSION_TTL_MS),
    ...overrides,
  };
}

function followUpSession(): DurableConversationSession {
  return {
    ...createSession(),
    step: 'followup',
    payload: { mode: 'followup', ticketId: '8' },
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
