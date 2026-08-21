import { describe, expect, it } from 'vitest';

import {
  buttonLabel,
  customerOrderStatusLabel,
  escapeHtml,
  homeInlineKeyboard,
  homeReplyKeyboard,
  homeText,
  matchMenuAction,
  MENU_LABEL,
} from './telegram-menu.js';

describe('telegram menu copy', () => {
  it('builds mixed full-width and paired rows matching the production menu layout', () => {
    expect(escapeHtml('<b>x</b> & y')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; y');
    expect(buttonLabel('الف'.repeat(70))).toHaveLength(64);
    expect(homeText(false)).toContain('<b>خوش آمدی');
    expect(matchMenuAction('/help')).toBe('help');
    expect(customerOrderStatusLabel('receipt_submitted')).toBe('رسید در حال بررسی');
    expect(matchMenuAction(MENU_LABEL.shop)).toBe('shop');
    expect(homeInlineKeyboard(false)).toEqual({
      inline_keyboard: [
        [{ text: 'خرید سرویس 🛍', callback_data: 'shop' }],
        [
          { text: 'پیگیری سفارش 📦', callback_data: 'order' },
          { text: 'تمدید سرویس ♻️', callback_data: 'renew' },
        ],
        [{ text: 'راهنما 📘', callback_data: 'help' }],
      ],
    });
    expect(homeReplyKeyboard(true)).toEqual({
      keyboard: [
        [{ text: 'وضعیت سیستم ⚙️' }],
        [{ text: 'گزارش‌ها 📣' }, { text: 'سفارش‌های باز 📋' }],
        [{ text: 'خرید سرویس 🛍' }],
        [{ text: 'پیگیری سفارش 📦' }, { text: 'تمدید سرویس ♻️' }],
        [{ text: 'راهنما 📘' }],
        [{ text: 'بخش ادمین 👨‍💻' }],
      ],
      resize_keyboard: true,
      is_persistent: true,
      input_field_placeholder: 'از منو انتخاب کن',
    });
  });
});
