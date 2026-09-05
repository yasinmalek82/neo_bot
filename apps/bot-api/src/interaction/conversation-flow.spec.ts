import { describe, expect, it } from 'vitest';

import {
  isCustomerNavigationInput,
  isGlobalCancelInput,
  isHomeInput,
} from './conversation-flow.js';

describe('conversation navigation helpers', () => {
  it('treats Home reply-keyboard and /start text as home and cancel', () => {
    expect(
      isHomeInput({ kind: 'text', updateId: '1', telegramUserId: '1', text: 'منوی اصلی 🏠' }),
    ).toBe(true);
    expect(isHomeInput({ kind: 'text', updateId: '1', telegramUserId: '1', text: '/start' })).toBe(
      true,
    );
    expect(
      isGlobalCancelInput({
        kind: 'callback',
        updateId: '1',
        telegramUserId: '1',
        callbackData: 'flow:cancel',
      }),
    ).toBe(true);
    expect(
      isGlobalCancelInput({
        kind: 'callback',
        updateId: '1',
        telegramUserId: '1',
        callbackData: 'menu',
      }),
    ).toBe(true);
  });

  it('treats shop, wallet, and catalog callbacks as navigation, not flow input', () => {
    expect(
      isCustomerNavigationInput({
        kind: 'callback',
        updateId: '1',
        telegramUserId: '1',
        callbackData: 'shop',
      }),
    ).toBe(true);
    expect(
      isCustomerNavigationInput({
        kind: 'text',
        updateId: '1',
        telegramUserId: '1',
        text: 'خرید سریع 🛍',
      }),
    ).toBe(true);
    expect(
      isCustomerNavigationInput({
        kind: 'callback',
        updateId: '1',
        telegramUserId: '1',
        callbackData: 'wallet:topup',
      }),
    ).toBe(true);
    expect(
      isCustomerNavigationInput({
        kind: 'callback',
        updateId: '1',
        telegramUserId: '1',
        callbackData: 'flow:skip-coupon',
      }),
    ).toBe(false);
    expect(
      isCustomerNavigationInput({
        kind: 'callback',
        updateId: '1',
        telegramUserId: '1',
        callbackData: 'renew:confirm',
      }),
    ).toBe(false);
  });
});
