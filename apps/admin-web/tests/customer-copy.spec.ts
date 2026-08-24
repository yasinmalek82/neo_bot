import { describe, expect, it } from 'vitest';

import { readInitDataFromHash, shouldUsePhonePreview } from '../src/telegram-webapp';
import {
  checkoutErrorCopy,
  customerOrderStatusLabel,
  emptyShopCopy,
  helpSteps,
  HOME_TABS,
  shopUnavailableCopy,
} from '../src/customer-copy';

describe('customer Mini App copy and viewport', () => {
  it('uses the phone frame only with preview=1', () => {
    expect(shouldUsePhonePreview('?preview=1')).toBe(true);
    expect(shouldUsePhonePreview('')).toBe(false);
    expect(shouldUsePhonePreview('?foo=1')).toBe(false);
  });

  it('reads signed Mini App identity from the Telegram hash fallback', () => {
    const fakeInitData = 'user={"id":1,"first_name":"Test"}&auth_date=1&hash=deadbeef';
    expect(readInitDataFromHash('')).toBeNull();
    expect(readInitDataFromHash('#tgWebAppVersion=8.0')).toBeNull();
    expect(readInitDataFromHash(`#tgWebAppData=${encodeURIComponent(fakeInitData)}`)).toBe(
      fakeInitData,
    );
  });

  it('exposes the four customer tabs matching the chat journey', () => {
    expect(HOME_TABS.map((tab) => tab.id)).toEqual(['shop', 'orders', 'renew', 'help']);
  });

  it('keeps empty shop, missing Telegram, and load failure as separate copy', () => {
    expect(emptyShopCopy('admin').body).toContain('کنسول کاتالوگ');
    expect(emptyShopCopy('customer').body).not.toContain('کنسول کاتالوگ');
    expect(shopUnavailableCopy('telegram').title).toBe('خرید در چت ربات است');
    expect(shopUnavailableCopy('failed').title).toBe('فروشگاه نیامد');
    expect(shopUnavailableCopy('telegram').body).toContain('چت ربات');
  });

  it('keeps help and order copy in original Persian without wallet extras', () => {
    expect(helpSteps()).toHaveLength(4);
    expect(helpSteps().join(' ')).toContain('چت ربات');
    expect(helpSteps().join(' ')).not.toContain('کیف پول');
    expect(customerOrderStatusLabel('awaiting_receipt')).toContain('رسید');
    expect(checkoutErrorCopy('NO_ACTIVE_SERVICE')).toContain('تمدید');
    expect(checkoutErrorCopy('INIT_DATA_REQUIRED')).toContain('چت ربات');
    expect(checkoutErrorCopy('CHAT_CHECKOUT_REQUIRED')).toContain('چت ربات');
  });
});
