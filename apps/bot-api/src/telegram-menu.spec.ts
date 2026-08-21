import { describe, expect, it } from 'vitest';

import {
  adminHubKeyboard,
  buttonLabel,
  customerOrderStatusLabel,
  escapeHtml,
  homeInlineKeyboard,
  homeReplyKeyboard,
  homeText,
  matchMenuAction,
  MENU_LABEL,
  receiptConflictText,
  renewalFailedText,
  adminStatusText,
  categoryText,
  dailySummaryQueuedText,
  emptyShopText,
  adminCatalogHealthText,
  catalogConsoleUrl,
} from './telegram-menu.js';

describe('telegram menu copy', () => {
  it('builds mixed full-width and paired rows matching the production menu layout', () => {
    expect(escapeHtml('<b>x</b> & y')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; y');
    expect(buttonLabel('الف'.repeat(70))).toHaveLength(64);
    expect(homeText(false)).toContain('خوش آمدی');
    expect(homeText(false)).toContain('دکمه‌های پایین صفحه');
    expect(homeText(true)).toContain('بخش ادمین');
    expect(matchMenuAction('/help')).toBe('help');
    expect(matchMenuAction('خرید سرویس')).toBe('shop');
    expect(matchMenuAction('وضعیت سیستم')).toBe('status');
    expect(receiptConflictText('OPEN_ORDER_UNDER_REVIEW')).toContain('در حال بررسی');
    expect(receiptConflictText('NO_ORDER_AWAITING_PAYMENT')).toContain('سفارش باز پیدا نشد');
    expect(renewalFailedText()).toContain('تمدید الان تمام نشد');
    expect(
      adminStatusText({
        categoryCount: 2,
        forumConfigured: true,
        localIntake: true,
        telegramReady: false,
        telegramError: 'TELEGRAM_POLLING_CONFLICT',
        reportsPending: 1,
        reportsFailed: 2,
      }),
    ).toContain('صف گزارش: 1 در انتظار، 2 ناموفق');
    expect(dailySummaryQueuedText(true)).toContain('خلاصه امروز ثبت شد');
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
    expect(homeInlineKeyboard(true)).toEqual({
      inline_keyboard: [
        [{ text: 'خرید سرویس 🛍', callback_data: 'shop' }],
        [
          { text: 'پیگیری سفارش 📦', callback_data: 'order' },
          { text: 'تمدید سرویس ♻️', callback_data: 'renew' },
        ],
        [{ text: 'راهنما 📘', callback_data: 'help' }],
        [{ text: 'بخش ادمین 👨‍💻', callback_data: 'admin:hub' }],
      ],
    });
    expect(homeReplyKeyboard(true)).toEqual({
      keyboard: [
        [{ text: 'خرید سرویس 🛍' }],
        [{ text: 'پیگیری سفارش 📦' }, { text: 'تمدید سرویس ♻️' }],
        [{ text: 'راهنما 📘' }],
        [{ text: 'بخش ادمین 👨‍💻' }],
      ],
      resize_keyboard: true,
      is_persistent: true,
      input_field_placeholder: 'از دکمه‌های پایین انتخاب کن',
    });
    expect(adminHubKeyboard()).toEqual({
      inline_keyboard: [
        [{ text: 'وضعیت سیستم ⚙️', callback_data: 'admin:status' }],
        [
          { text: 'گزارش‌ها 📣', callback_data: 'admin:reports' },
          { text: 'سفارش‌های باز 📋', callback_data: 'admin:queue' },
        ],
        [{ text: 'ساخت ناموفق ⚠️', callback_data: 'admin:failed' }],
        [{ text: 'سلامت کاتالوگ 🗂️', callback_data: 'admin:catalog' }],
        [{ text: 'منوی اصلی 🏠', callback_data: 'menu' }],
      ],
    });
    expect(
      categoryText({
        name: 'ویژه',
        description: 'تونل چند لوکیشن <script>',
        parentName: 'اقتصادی',
        hasItems: true,
      }),
    ).toContain('زیرمجموعهٔ اقتصادی');
    expect(
      categoryText({
        name: 'ویژه',
        description: 'تونل چند لوکیشن <script>',
        parentName: 'اقتصادی',
        hasItems: true,
      }),
    ).toContain('تونل چند لوکیشن &lt;script&gt;');
    expect(emptyShopText(true)).toContain('کنسول کاتالوگ');
    expect(emptyShopText(false)).not.toContain('کنسول کاتالوگ');
    expect(catalogConsoleUrl(null)).toBeNull();
    expect(catalogConsoleUrl('https://shop.example/')).toBe('https://shop.example/console/');
    expect(adminHubKeyboard('https://shop.example/console/').inline_keyboard).toEqual(
      expect.arrayContaining([
        [{ text: 'کنسول کاتالوگ 🧩', web_app: { url: 'https://shop.example/console/' } }],
      ]),
    );
    expect(
      adminCatalogHealthText({
        categoryCount: 2,
        cardPublished: true,
      }),
    ).toContain('کارت کارت‌به‌کارت: منتشر شده');
    expect(
      JSON.stringify(
        adminCatalogHealthText({
          categoryCount: 2,
          cardPublished: true,
        }),
      ),
    ).not.toMatch(/\d{16}/u);
    expect(adminCatalogHealthText({ categoryCount: 0, cardPublished: false })).toContain(
      'هنوز منتشر نشده',
    );
  });
});
