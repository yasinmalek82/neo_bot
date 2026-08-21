import { describe, expect, it } from 'vitest';

import { redactLogText, redactLogValue } from './safe-log.js';

describe('safe-log', () => {
  it('strips subscription URLs, bot tokens, cards and forbidden object keys', () => {
    expect(redactLogText('see https://panel.example/sub/secret now')).toBe(
      'see [redacted-url] now',
    );
    expect(redactLogText('token 123456:abcdefghijklmnopqrstuvwxyz extra')).toContain(
      '[redacted-token]',
    );
    expect(redactLogText('card 0000000000000000')).toBe('card [redacted-card]');
    expect(
      redactLogValue({ subscriptionUrl: 'https://panel.example/sub/x', orderId: '3' }),
    ).toEqual({
      subscriptionUrl: '[redacted]',
      orderId: '3',
    });
    expect(redactLogValue(new Error('https://panel.example/sub/secret'))).toEqual({
      name: 'Error',
      message: '[redacted-url]',
    });
  });
});
