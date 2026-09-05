import type { SupportTicket, TelegramCustomerInput } from '@neo-bot/domain';
import { describe, expect, it, vi } from 'vitest';

import type { CommerceRepository } from './commerce-ports.js';
import { SupportTicketUseCase } from './support-ticket.js';

const customer: TelegramCustomerInput = {
  telegramUserId: '10001',
  privateChatId: '10001',
  username: 'buyer',
  displayName: 'خریدار',
};

const ticket: SupportTicket = {
  id: '8',
  customerId: '1',
  status: 'open',
  createdAt: new Date('2026-09-05T00:00:00.000Z'),
  updatedAt: new Date('2026-09-05T00:00:00.000Z'),
};

describe('SupportTicketUseCase', () => {
  it('creates a ticket once for the same Telegram update key', async () => {
    const createSupportTicket = vi
      .fn()
      .mockResolvedValueOnce({ ticket, replayed: false })
      .mockResolvedValueOnce({ ticket, replayed: true });
    const useCase = new SupportTicketUseCase({
      upsertTelegramCustomer: vi.fn().mockResolvedValue({
        customer: { ...customer, id: '1', username: 'buyer' },
        created: false,
      }),
      createSupportTicket,
    } as unknown as CommerceRepository);

    await expect(
      useCase.create({
        customer,
        body: 'سرویس وصل نمی‌شود',
        idempotencyKey: 'telegram:70:ticket:create',
      }),
    ).resolves.toEqual({ ticket, replayed: false });
    await expect(
      useCase.create({
        customer,
        body: 'سرویس وصل نمی‌شود',
        idempotencyKey: 'telegram:70:ticket:create',
      }),
    ).resolves.toEqual({ ticket, replayed: true });
    expect(createSupportTicket).toHaveBeenCalledTimes(2);
    expect(createSupportTicket).toHaveBeenCalledWith({
      customerId: '1',
      body: 'سرویس وصل نمی‌شود',
      idempotencyKey: 'telegram:70:ticket:create',
    });
  });

  it('rejects an empty ticket body before writing', async () => {
    const createSupportTicket = vi.fn();
    const useCase = new SupportTicketUseCase({
      upsertTelegramCustomer: vi.fn(),
      createSupportTicket,
    } as unknown as CommerceRepository);

    await expect(
      useCase.create({
        customer,
        body: '   ',
        idempotencyKey: 'telegram:71:ticket:create',
      }),
    ).rejects.toThrow('INVALID_TICKET_BODY');
    expect(createSupportTicket).not.toHaveBeenCalled();
  });
});
