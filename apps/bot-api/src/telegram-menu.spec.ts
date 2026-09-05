import { describe, expect, it } from 'vitest';
import type { SellableProductVariant } from '@neo-bot/domain';

import {
  adminDeniedText,
  adminHubKeyboard,
  adminReportsKeyboard,
  buttonLabel,
  customerOrderStatusLabel,
  escapeHtml,
  helpText,
  guideInlineKeyboard,
  guideText,
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
  missingCategoryText,
  shopText,
  adminCatalogHealthText,
  renewalCompletedText,
  renewalPreviewText,
  serviceDeliveredText,
  formatMoney,
  variantListLabel,
  variantText,
  productPlansText,
} from './telegram-menu.js';

describe('telegram menu copy', () => {
  it('renders a bounded three-plan comparison with escaped display copy and factual badges', () => {
    const unsafeDescription = '<b>توضیح</b> ' + '🛰️'.repeat(300);
    const text = productPlansText({
      productName: '<محصول>',
      planCount: 4,
      page: 0,
      pageCount: 2,
      variants: [
        {
          id: '1',
          code: 'one',
          productName: '<محصول>',
          name: '<پلن>',
          description: unsafeDescription,
          durationDays: 30,
          dataLimitBytes: 50n * 1024n ** 3n,
          deviceLimit: 0,
          priceIrr: 1_000_000n,
          evidenceBadge: { kind: 'value', label: 'کمترین قیمت' },
          displayAttributes: [{ position: 0, label: '<پروتکل>', value: 'VLESS & XTLS' }],
        },
      ],
    });
    expect(text).toContain('&lt;محصول&gt;');
    expect(text).toContain('&lt;پلن&gt;');
    expect(text).toContain('کمترین قیمت');
    expect(text).toContain('&lt;پروتکل&gt;: <b>VLESS &amp; XTLS</b>');
    expect(text).not.toContain('<b>توضیح</b>');
    expect(text.length).toBeLessThan(4096);
  });

  it('keeps a three-plan comparison below Telegram limits for adversarial escaped fields', () => {
    const hostile = '<>&'.repeat(200);
    const text = productPlansText({
      productName: hostile,
      planCount: 3,
      page: 0,
      pageCount: 1,
      variants: Array.from({ length: 3 }, (_, index) => ({
        id: String(index + 1),
        code: `hostile-${String(index + 1)}`,
        productName: hostile,
        name: hostile,
        description: hostile,
        durationDays: 30,
        dataLimitBytes: 50n * 1024n ** 3n,
        deviceLimit: 3,
        priceIrr: 1_000_000n,
        displayAttributes: Array.from({ length: 4 }, () => ({
          position: 0,
          label: hostile,
          value: hostile,
        })),
      })),
    });
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toContain('&lt;&gt;&amp;');
    expect(text).not.toContain('<>&');
  });

  it('keeps an adversarial full variant detail below Telegram limits without cutting escaped entities', () => {
    const hostile = '<>&'.repeat(200);
    const text = variantText({
      id: 'hostile',
      code: 'hostile-detail',
      productName: hostile,
      name: hostile,
      description: hostile,
      durationDays: 30,
      dataLimitBytes: 50n * 1024n ** 3n,
      deviceLimit: 3,
      priceIrr: 1_000_000n,
      displayAttributes: Array.from({ length: 4 }, (_, position) => ({
        position,
        label: hostile,
        value: hostile,
      })),
    });
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toContain('&lt;&gt;&amp;');
    expect(text).not.toContain('<>&');
  });

  it('builds mixed full-width and paired rows matching the production menu layout', () => {
    expect(escapeHtml('<b>x</b> & y')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; y');
    expect(buttonLabel('الف'.repeat(70))).toHaveLength(64);
    expect(homeText(false)).toContain('NEO NETWORK');
    expect(homeText(false)).toContain('PRIVATE ACCESS');
    expect(homeText(false)).toContain('همین گفتگو');
    expect(homeText(true)).toContain('بخش ادمین');
    expect(helpText()).toContain('فروشگاه همین چت است');
    expect(helpText()).toContain('حداکثر ۶۰ دقیقه');
    expect(guideText()).toContain('تعداد دستگاه');
    expect(matchMenuAction('راهنمای انتخاب')).toBe('guide');
    expect(matchMenuAction('/help')).toBe('help');
    expect(matchMenuAction('خرید سرویس')).toBe('shop');
    expect(matchMenuAction('خرید سریع')).toBe('shop');
    expect(matchMenuAction(MENU_LABEL.home)).toBe('home');
    expect(matchMenuAction(MENU_LABEL.wallet)).toBe('wallet');
    expect(matchMenuAction(MENU_LABEL.ticket)).toBe('ticket');
    expect(matchMenuAction('وضعیت سیستم')).toBe('status');
    expect(receiptConflictText('OPEN_ORDER_UNDER_REVIEW')).toContain('در حال بررسی');
    expect(receiptConflictText('NO_ORDER_AWAITING_PAYMENT')).toContain('سفارش باز پیدا نشد');
    expect(renewalFailedText()).toContain('ثبت سفارش تمدید انجام نشد');
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
    expect(matchMenuAction(MENU_LABEL.store)).toBe('store');
    expect(matchMenuAction('مدیریت فروشگاه')).toBe('store');
    expect(homeReplyKeyboard(true)).toEqual({
      keyboard: [
        [{ text: 'خرید سریع 🛍' }],
        [{ text: 'راهنمای انتخاب 🧭' }],
        [{ text: 'پیگیری سفارش 📦' }, { text: 'تمدید سرویس ♻️' }],
        [{ text: 'شارژ کیف پول 💳' }, { text: 'تیکت پشتیبانی 🎫' }],
        [{ text: 'راهنما 📘' }],
        [{ text: 'منوی اصلی 🏠' }],
        [{ text: 'بخش ادمین 👨‍💻' }],
      ],
      resize_keyboard: true,
      is_persistent: true,
      input_field_placeholder: 'از دکمه‌های پایین انتخاب کن',
    });
    expect(adminReportsKeyboard(true)).toEqual({
      inline_keyboard: [
        [{ text: 'ارسال خلاصه امروز', callback_data: 'admin:summary' }],
        [{ text: 'بخش ادمین 👨‍💻', callback_data: 'admin:hub' }],
        [{ text: 'منوی اصلی 🏠', callback_data: 'menu' }],
      ],
    });
    expect(adminDeniedText()).toContain('فقط برای مدیر فروشگاه');
    expect(adminHubKeyboard()).toEqual({
      inline_keyboard: [
        [{ text: 'وضعیت سیستم ⚙️', callback_data: 'admin:status' }],
        [
          { text: 'گزارش‌ها 📣', callback_data: 'admin:reports' },
          { text: 'سفارش‌های باز 📋', callback_data: 'admin:queue' },
        ],
        [{ text: 'مدیریت فروشگاه 🏪', callback_data: 'admin:store' }],
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
    expect(
      categoryText({
        name: 'ویژه',
        description: '',
        parentName: null,
        hasItems: true,
      }),
    ).toContain('پلن‌ها و قیمت‌ها را مقایسه');
    expect(
      categoryText({
        name: 'ویژه',
        description: '',
        parentName: null,
        hasItems: false,
      }),
    ).toContain('پلن فعالی');
    expect(shopText()).toContain('خرید سریع');
    expect(shopText()).toContain('یک دسته انتخاب کن');
    expect(missingCategoryText()).toContain('دسته در دسترس نیست');
    expect(missingCategoryText()).not.toContain('پلن فعالی');
    expect(emptyShopText(true)).toContain('مدیریت فروشگاه');
    expect(emptyShopText(false)).not.toContain('کنسول کاتالوگ');
    expect(emptyShopText(false)).toContain('خرید سریع');
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
    expect(renewalCompletedText('https://panel.example/sub/x')).toContain('تمدید انجام شد');
    expect(renewalPreviewText()).toContain('تمدید فقط پس از تأیید رسید انجام می‌شود');
    expect(serviceDeliveredText('https://panel.example/sub/x')).toContain('سرویس آماده است');
    expect(guideInlineKeyboard()).toEqual({
      inline_keyboard: [
        [{ text: 'دیدن پلن‌ها', callback_data: 'shop' }],
        [{ text: 'منوی اصلی 🏠', callback_data: 'menu' }],
      ],
    });

    const sampleVariant: SellableProductVariant = {
      id: 'variant-1',
      code: 'eco-30',
      productName: 'اقتصادی',
      name: '۳۰ گیگ یک‌ماهه',
      description: 'مناسب استفاده روزمره',
      durationDays: 30,
      dataLimitBytes: 30n * 1024n ** 3n,
      deviceLimit: 2,
      priceIrr: 1_450_000n,
    };
    expect(variantListLabel(sampleVariant)).toContain('۳۰ گیگ');
    expect(variantListLabel(sampleVariant)).toContain('روز');
    expect(variantListLabel(sampleVariant)).toMatch(/^۱۴۵٬۰۰۰ تومان/u);
    expect(variantText(sampleVariant)).toContain('قیمت:');
    expect(variantText(sampleVariant)).toContain('اتصال همزمان');
    expect(formatMoney(1_450_001n)).toBe('۱۴۵٬۰۰۰٫۱ تومان');
    expect(formatMoney(1_450_001n)).not.toContain('ریال');
  });
});
