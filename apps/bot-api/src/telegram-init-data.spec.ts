import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyTelegramInitData } from './telegram-init-data.js';

const botToken = '12345:abcdefghijklmnopqrstuvwxyz';

function signTelegramInitDataForTest(
  fields: Readonly<Record<string, string>>,
  token: string,
): string {
  const dataCheckString = Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

describe('verifyTelegramInitData', () => {
  it('accepts a fresh signed payload and rejects a forged hash', () => {
    const user = JSON.stringify({ id: 10001, first_name: 'خریدار' });
    const initData = signTelegramInitDataForTest(
      { auth_date: String(Math.floor(Date.now() / 1_000)), user },
      botToken,
    );
    expect(verifyTelegramInitData(initData, botToken).id).toBe(10001);
    expect(() =>
      verifyTelegramInitData(
        initData.replace(/hash=[a-f0-9]+/u, `hash=${'a'.repeat(64)}`),
        botToken,
      ),
    ).toThrow('INIT_DATA_INVALID');
  });

  it('rejects expired init data', () => {
    const initData = signTelegramInitDataForTest(
      {
        auth_date: '1',
        user: JSON.stringify({ id: 10001, first_name: 'خریدار' }),
      },
      botToken,
    );
    expect(() => verifyTelegramInitData(initData, botToken)).toThrow('INIT_DATA_EXPIRED');
  });
});
