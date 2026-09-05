export const SUPPORT_TICKET_STATUSES = ['open', 'closed'] as const;

export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export interface SupportTicket {
  readonly id: string;
  readonly customerId: string;
  readonly status: SupportTicketStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SupportTicketWriteResult {
  readonly ticket: SupportTicket;
  readonly replayed: boolean;
}
