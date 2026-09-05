import { describe, expect, it } from 'vitest';

import {
  parseConversationPayload,
  parseWalletAmountIrr,
  validateDiscountCode,
  validateTicketBody,
} from './conversation-session.js';

describe('conversation session payload rules', () => {
  it('rejects a ticket body inside a durable session payload', () => {
    expect(() =>
      parseConversationPayload('support.ticket', 'create', { mode: 'create', body: 'secret' }),
    ).toThrow('MALFORMED_CONVERSATION_SESSION');
  });

  it('parses Persian wallet amounts and discount codes', () => {
    expect(parseWalletAmountIrr('۵۰٬۰۰۰')).toBe(50_000n);
    expect(validateDiscountCode('save10')).toBe('SAVE10');
    expect(validateTicketBody('سرویس قطع است')).toBe('سرویس قطع است');
  });
});
