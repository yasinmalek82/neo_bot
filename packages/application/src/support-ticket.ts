import {
  DomainConflictError,
  validateTelegramCustomerInput,
  validateTicketBody,
  type SupportTicketWriteResult,
  type TelegramCustomerInput,
} from '@neo-bot/domain';

import type { CommerceRepository } from './commerce-ports.js';

export class SupportTicketUseCase {
  public constructor(private readonly repository: CommerceRepository) {}

  public async create(command: {
    readonly customer: TelegramCustomerInput;
    readonly body: string;
    readonly idempotencyKey: string;
  }): Promise<SupportTicketWriteResult> {
    validateTelegramCustomerInput(command.customer);
    requireIdempotencyKey(command.idempotencyKey);
    const body = validateTicketBody(command.body);
    const { customer } = await this.repository.upsertTelegramCustomer(command.customer);
    return this.repository.createSupportTicket({
      customerId: customer.id,
      body,
      idempotencyKey: command.idempotencyKey,
    });
  }

  public async followUp(command: {
    readonly customer: TelegramCustomerInput;
    readonly ticketId: string;
    readonly body: string;
    readonly idempotencyKey: string;
  }): Promise<SupportTicketWriteResult> {
    validateTelegramCustomerInput(command.customer);
    requireIdempotencyKey(command.idempotencyKey);
    if (!/^\d{1,20}$/u.test(command.ticketId)) {
      throw new DomainConflictError('TICKET_NOT_FOUND');
    }
    const body = validateTicketBody(command.body);
    const { customer } = await this.repository.upsertTelegramCustomer(command.customer);
    return this.repository.followUpSupportTicket({
      customerId: customer.id,
      ticketId: command.ticketId,
      body,
      idempotencyKey: command.idempotencyKey,
    });
  }
}

function requireIdempotencyKey(value: string): void {
  if (value.length < 8 || value.length > 200 || !/^[a-zA-Z0-9:._-]+$/u.test(value)) {
    throw new DomainConflictError('INVALID_IDEMPOTENCY_KEY');
  }
}
