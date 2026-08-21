import type { SalesOrder, SalesOrderStatus, SellableProductVariant } from '@neo-bot/domain';

import type {
  TelegramInlineKeyboardMarkup,
  TelegramPersistentKeyboardMarkup,
} from './telegram-api.js';

export const HOME_CALLBACK = 'menu';
export const SHOP_CALLBACK = 'shop';
export const ORDER_CALLBACK = 'order';
export const RENEW_CALLBACK = 'renew';
export const HELP_CALLBACK = 'help';
export const ADMIN_STATUS_CALLBACK = 'admin:status';
export const ADMIN_REPORTS_CALLBACK = 'admin:reports';
export const ADMIN_QUEUE_CALLBACK = 'admin:queue';
export const ADMIN_HUB_CALLBACK = 'admin:hub';

export const MENU_LABEL = {
  shop: 'خرید سرویس 🛍',
  order: 'پیگیری سفارش 📦',
  renew: 'تمدید سرویس ♻️',
  help: 'راهنما 📘',
  status: 'وضعیت سیستم ⚙️',
  reports: 'گزارش‌ها 📣',
  queue: 'سفارش‌های باز 📋',
  admin: 'بخش ادمین 👨‍💻',
} as const;

export type MenuAction =
  'home' | 'shop' | 'order' | 'renew' | 'help' | 'status' | 'reports' | 'queue' | 'admin';

interface InlineButton {
  readonly text: string;
  readonly callback_data: string;
}
type InlineRow = InlineButton | readonly InlineButton[];

export function escapeHtml(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

export function buttonLabel(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 64) {
    return trimmed.length === 0 ? 'گزینه' : trimmed;
  }
  return `${trimmed.slice(0, 63)}…`;
}

export function inlineMenu(rows: readonly InlineRow[]): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: rows.map((row) =>
      isButton(row)
        ? [{ text: buttonLabel(row.text), callback_data: row.callback_data }]
        : row.map((button) => ({
            text: buttonLabel(button.text),
            callback_data: button.callback_data,
          })),
    ),
  };
}

export function columnKeyboard(buttons: readonly InlineButton[]): TelegramInlineKeyboardMarkup {
  return inlineMenu(buttons);
}

export function pairedKeyboard(buttons: readonly InlineButton[]): TelegramInlineKeyboardMarkup {
  return inlineMenu(pairButtons(buttons));
}

export function persistentKeyboard(
  rows: readonly (readonly string[])[],
): TelegramPersistentKeyboardMarkup {
  return {
    keyboard: rows.map((row) => row.map((text) => ({ text: buttonLabel(text) }))),
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'از منو انتخاب کن',
  };
}

export function matchMenuAction(text: string): MenuAction | null {
  const normalized = text.trim();
  if (normalized === '/start' || normalized.startsWith('/start@') || normalized === 'منوی اصلی') {
    return 'home';
  }
  if (normalized === '/buy' || normalized === MENU_LABEL.shop || normalized === 'خرید سرویس') {
    return 'shop';
  }
  if (
    normalized === '/order' ||
    normalized.startsWith('/order@') ||
    normalized === MENU_LABEL.order
  ) {
    return 'order';
  }
  if (
    normalized === '/renew' ||
    normalized.startsWith('/renew@') ||
    normalized === MENU_LABEL.renew
  ) {
    return 'renew';
  }
  if (normalized === '/help' || normalized.startsWith('/help@') || normalized === MENU_LABEL.help) {
    return 'help';
  }
  if (normalized === MENU_LABEL.status) {
    return 'status';
  }
  if (normalized === MENU_LABEL.reports) {
    return 'reports';
  }
  if (normalized === MENU_LABEL.queue) {
    return 'queue';
  }
  if (normalized === MENU_LABEL.admin) {
    return 'admin';
  }
  return null;
}

export function homeText(isAdmin: boolean): string {
  return [
    '<b>خوش آمدی</b>',
    isAdmin
      ? 'از منوی زیر مدیریت کن؛ لازم نیست دستوری تایپ کنی.'
      : 'از منوی زیر انتخاب کن؛ لازم نیست دستوری تایپ کنی.',
  ].join('\n');
}

export function homeInlineKeyboard(isAdmin: boolean): TelegramInlineKeyboardMarkup {
  if (!isAdmin) {
    return inlineMenu([
      { text: MENU_LABEL.shop, callback_data: SHOP_CALLBACK },
      [
        { text: MENU_LABEL.order, callback_data: ORDER_CALLBACK },
        { text: MENU_LABEL.renew, callback_data: RENEW_CALLBACK },
      ],
      { text: MENU_LABEL.help, callback_data: HELP_CALLBACK },
    ]);
  }
  return inlineMenu([
    { text: MENU_LABEL.status, callback_data: ADMIN_STATUS_CALLBACK },
    [
      { text: MENU_LABEL.reports, callback_data: ADMIN_REPORTS_CALLBACK },
      { text: MENU_LABEL.queue, callback_data: ADMIN_QUEUE_CALLBACK },
    ],
    { text: MENU_LABEL.shop, callback_data: SHOP_CALLBACK },
    [
      { text: MENU_LABEL.order, callback_data: ORDER_CALLBACK },
      { text: MENU_LABEL.renew, callback_data: RENEW_CALLBACK },
    ],
    { text: MENU_LABEL.help, callback_data: HELP_CALLBACK },
    { text: MENU_LABEL.admin, callback_data: ADMIN_HUB_CALLBACK },
  ]);
}

export function homeReplyKeyboard(isAdmin: boolean): TelegramPersistentKeyboardMarkup {
  if (!isAdmin) {
    return persistentKeyboard([
      [MENU_LABEL.shop],
      [MENU_LABEL.order, MENU_LABEL.renew],
      [MENU_LABEL.help],
    ]);
  }
  return persistentKeyboard([
    [MENU_LABEL.status],
    [MENU_LABEL.reports, MENU_LABEL.queue],
    [MENU_LABEL.shop],
    [MENU_LABEL.order, MENU_LABEL.renew],
    [MENU_LABEL.help],
    [MENU_LABEL.admin],
  ]);
}

export function shopText(): string {
  return ['<b>خرید سرویس</b>', 'دسته را انتخاب کن.'].join('\n');
}

export function emptyShopText(): string {
  return ['<b>فروشگاه خالی است</b>', 'هنوز پلن فعالی برای فروش تنظیم نشده.'].join('\n');
}

export function categoryText(hasItems: boolean): string {
  return hasItems
    ? ['<b>انتخاب پلن</b>', 'یکی از گزینه‌ها را لمس کن.'].join('\n')
    : ['<b>این دسته خالی است</b>', 'از منو دسته دیگری را انتخاب کن.'].join('\n');
}

export function catalogKeyboard(
  items: readonly InlineButton[],
  extras: readonly InlineButton[],
): TelegramInlineKeyboardMarkup {
  return inlineMenu([...pairButtons(items), ...extras]);
}

export function variantText(variant: SellableProductVariant): string {
  const traffic =
    variant.dataLimitBytes === 0n
      ? 'نامحدود'
      : `${String(variant.dataLimitBytes / 1024n ** 3n)} گیگابایت`;
  const devices = variant.deviceLimit === 0 ? 'نامحدود' : String(variant.deviceLimit);
  return [
    `<b>${escapeHtml(variant.productName)}</b>`,
    `<i>${escapeHtml(variant.name)}</i>`,
    escapeHtml(variant.description),
    '',
    `⏱ مدت: ${String(variant.durationDays)} روز`,
    `📶 حجم: ${escapeHtml(traffic)}`,
    `📱 دستگاه: ${escapeHtml(devices)}`,
    `💰 مبلغ: <b>${escapeHtml(formatMoney(variant.priceIrr))}</b>`,
  ].join('\n');
}

export function helpText(): string {
  return [
    '<b>راهنمای خرید</b>',
    '۱. «خرید سرویس» را بزن و پلن را انتخاب کن. مینی‌اپ هم همین سفارش را می‌سازد.',
    '۲. مبلغ نمایش‌داده‌شده را <b>دقیقاً</b> کارت‌به‌کارت کن.',
    '۳. فقط <b>عکس رسید</b> را در همین گفتگو بفرست؛ فایل PDF یا ویدیو قبول نیست.',
    '۴. نتیجه تأیید و لینک سرویس همین‌جا اعلام می‌شود.',
  ].join('\n');
}

export function orderStatusText(order: SalesOrder | null): string {
  if (order === null) {
    return ['<b>سفارش باز نداری</b>', 'برای شروع، خرید سرویس را از منو انتخاب کن.'].join('\n');
  }
  if (order.status === 'receipt_submitted') {
    return [
      '<b>سفارش در حال بررسی است</b>',
      `محصول: ${escapeHtml(order.productName)} — ${escapeHtml(order.variantName)}`,
      `مبلغ: ${escapeHtml(formatMoney(order.amountIrr))}`,
      'نتیجه را همین‌جا برات می‌فرستیم.',
    ].join('\n');
  }
  if (order.status === 'rejected') {
    return ['<b>رسید قبلی تأیید نشد</b>', 'یک عکس واضح‌تر از همان پرداخت را همین‌جا بفرست.'].join(
      '\n',
    );
  }
  if (order.status === 'provisioning') {
    return [
      '<b>پرداخت تأیید شد</b>',
      'سرویس در حال آماده‌سازی است. نتیجه را همین‌جا می‌فرستیم.',
    ].join('\n');
  }
  if (order.status === 'provisioning_failed') {
    return [
      '<b>آماده‌سازی سرویس کامل نشد</b>',
      'پشتیبانی در حال بررسی است. لازم نیست دوباره پرداخت کنی.',
    ].join('\n');
  }
  return [
    '<b>سفارش منتظر پرداخت است</b>',
    `محصول: ${escapeHtml(order.productName)} — ${escapeHtml(order.variantName)}`,
    `مبلغ دقیق: <b>${escapeHtml(formatMoney(order.amountIrr))}</b>`,
    'بعد از کارت‌به‌کارت، فقط عکس رسید را بفرست.',
  ].join('\n');
}

export function checkoutText(
  order: { readonly amountIrr: bigint },
  cardNumber: string,
  cardHolder: string,
): string {
  return [
    '<b>سفارش ثبت شد</b>',
    'مبلغ را دقیقاً با همین عدد کارت‌به‌کارت کن.',
    '',
    `💰 <b>${escapeHtml(formatMoney(order.amountIrr))}</b>`,
    `💳 <code>${escapeHtml(formatCardNumber(cardNumber))}</code>`,
    `👤 ${escapeHtml(cardHolder)}`,
    '',
    'بعد از پرداخت، <b>فقط عکس رسید</b> را در همین گفتگو بفرست.',
  ].join('\n');
}

export function receiptAcceptedText(): string {
  return ['<b>رسید ثبت شد</b>', 'برای بررسی ارسال شد. نتیجه را همین‌جا اعلام می‌کنیم.'].join('\n');
}

export function noOpenOrderText(): string {
  return [
    '<b>سفارش باز پیدا نشد</b>',
    'اول از منو یا مینی‌اپ یک سرویس انتخاب کن، بعد عکس رسید را بفرست.',
  ].join('\n');
}

export function receiptPhotoHint(): string {
  return [
    '<b>رسید را به‌صورت عکس بفرست</b>',
    'فایل، ویدیو یا PDF برای بررسی قبول نیست. از رسید اسکرین یا عکس واضح بگیر.',
  ].join('\n');
}

export function paymentDetailsMissingText(): string {
  return [
    '<b>شماره کارت هنوز منتشر نشده</b>',
    'ادمین باید کارت را از کنسول کاتالوگ ذخیره و منتشر کند. الان پرداخت نکن.',
  ].join('\n');
}

export function provisioningDelayedText(): string {
  return [
    '<b>پرداخت تأیید شد</b>',
    'آماده‌سازی سرویس کامل نشد. لازم نیست دوباره پرداخت کنی؛ نتیجه را همین‌جا می‌فرستیم.',
  ].join('\n');
}

export function customerOrderStatusLabel(status: SalesOrderStatus): string {
  switch (status) {
    case 'awaiting_receipt':
      return 'منتظر عکس رسید';
    case 'receipt_submitted':
      return 'رسید در حال بررسی';
    case 'rejected':
      return 'رسید تأیید نشد؛ عکس واضح‌تر بفرست';
    case 'provisioning':
      return 'در حال آماده‌سازی سرویس';
    case 'provisioning_failed':
      return 'آماده‌سازی ناتمام؛ پشتیبانی در حال بررسی است';
    case 'fulfilled':
      return 'سرویس آماده است؛ لینک در چت ربات';
    case 'cancelled':
      return 'سفارش لغو شد';
  }
}

export function unknownTextHint(): string {
  return ['از دکمه‌های منو انتخاب کن.', 'لازم نیست چیزی تایپ کنی.'].join('\n');
}

export function adminStatusText(input: {
  readonly categoryCount: number;
  readonly forumConfigured: boolean;
  readonly localIntake: boolean;
}): string {
  return [
    '<b>وضعیت سیستم</b>',
    `فروشگاه: ${String(input.categoryCount)} دستهٔ ریشه`,
    `گزارش انجمن: ${input.forumConfigured ? 'فعال' : 'خاموش'}`,
    `ورودی تلگرام: ${input.localIntake ? 'محلی' : 'وب‌هوک'}`,
  ].join('\n');
}

export function adminReportsText(forumConfigured: boolean): string {
  return [
    '<b>گزارش‌ها</b>',
    forumConfigured
      ? 'رویدادها به‌صورت خودکار به انجمن خصوصی می‌روند. لینک اشتراک آنجا ارسال نمی‌شود.'
      : 'انجمن گزارش هنوز پیکربندی نشده. تا آن زمان فقط همین گفتگو را ببین.',
  ].join('\n');
}

export function adminHubText(): string {
  return [
    '<b>بخش ادمین</b>',
    'رسیدها با عکس در همین چت می‌آیند؛ تأیید و رد روی همان پیام است.',
    'کاتالوگ از کنسول جداگانه منتشر می‌شود؛ از ربات محصول جدید نساز.',
  ].join('\n');
}

export function adminQueueText(orders: readonly SalesOrder[]): string {
  if (orders.length === 0) {
    return ['<b>سفارش باز نیست</b>', 'رسید تازه‌ای در صف بررسی نیست.'].join('\n');
  }
  return ['<b>سفارش‌های باز</b>', 'یکی را برای بررسی انتخاب کن.'].join('\n');
}

export function adminQueueKeyboard(orders: readonly SalesOrder[]): TelegramInlineKeyboardMarkup {
  return inlineMenu([
    ...orders.map((order) => ({
      text: `${order.productName} — ${reviewStatusLabel(order.status)}`,
      callback_data: `admin:order:${order.id}`,
    })),
    backToMenuButton(),
  ]);
}

export function adminOrderText(order: SalesOrder): string {
  return [
    '<b>بررسی سفارش</b>',
    `محصول: ${escapeHtml(order.productName)} — ${escapeHtml(order.variantName)}`,
    `مبلغ: ${escapeHtml(formatMoney(order.amountIrr))}`,
    `وضعیت: ${escapeHtml(reviewStatusLabel(order.status))}`,
  ].join('\n');
}

export function backToMenuButton(): InlineButton {
  return { text: 'منوی اصلی 🏠', callback_data: HOME_CALLBACK };
}

export function formatMoney(amountIrr: bigint): string {
  const rial = new Intl.NumberFormat('fa-IR').format(amountIrr);
  if (amountIrr % 10n !== 0n) {
    return `${rial} ریال`;
  }
  const toman = new Intl.NumberFormat('fa-IR').format(amountIrr / 10n);
  return `${rial} ریال (${toman} تومان)`;
}

function reviewStatusLabel(status: SalesOrderStatus): string {
  switch (status) {
    case 'receipt_submitted':
      return 'رسید در صف';
    case 'provisioning_failed':
      return 'خطای ساخت';
    case 'awaiting_receipt':
      return 'منتظر رسید';
    default:
      return 'باز';
  }
}

function formatCardNumber(value: string): string {
  return value.match(/.{1,4}/gu)?.join(' ') ?? value;
}

function pairButtons(buttons: readonly InlineButton[]): readonly InlineRow[] {
  const rows: InlineRow[] = [];
  for (let index = 0; index < buttons.length; index += 2) {
    const first = buttons[index];
    const second = buttons[index + 1];
    if (first === undefined) {
      continue;
    }
    rows.push(second === undefined ? first : [first, second]);
  }
  return rows;
}

function isButton(row: InlineRow): row is InlineButton {
  return !Array.isArray(row);
}
