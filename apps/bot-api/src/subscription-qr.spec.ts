import { describe, expect, it } from 'vitest';

import { renderSubscriptionQrPng } from './subscription-qr.js';

describe('subscription QR', () => {
  it('renders a PNG in memory and never accepts a non-https URL', () => {
    const png = renderSubscriptionQrPng('https://panel.example/sub/abc');
    expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(() => renderSubscriptionQrPng('http://panel.example/sub/abc')).toThrow(
      'INVALID_SUBSCRIPTION_QR',
    );
  });
});
