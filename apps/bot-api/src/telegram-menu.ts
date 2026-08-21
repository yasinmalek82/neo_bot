import type { SalesOrder, SalesOrderStatus, SellableProductVariant } from '@neo-bot/domain';

import type {
  TelegramInlineButton,
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
export const ADMIN_SUMMARY_CALLBACK = 'admin:summary';
export const ADMIN_FAILED_CALLBACK = 'admin:failed';
export const ADMIN_CATALOG_CALLBACK = 'admin:catalog';

export const MENU_LABEL = {
  shop: 'خرید سرویس 🛍',
  order: 'پیگیری سفارش 📦',
  renew: 'تمدید سرویس ♻️',
  help: 'راهنما 📘',
  status: 'وضعیت سیستم ⚙️',
  reports: 'گزارش‌ها 📣',
  queue: 'سفارش‌های باز 📋',
  failed: 'ساخت ناموفق ⚠️',
  catalog: 'سلامت کاتالوگ 🗂️',
  admin: 'بخش ادمین 👨‍💻',
} as const;

export type MenuAction =
  'home' | 'shop' | 'order' | 'renew' | 'help' | 'status' | 'reports' | 'queue' | 'admin';

interface CallbackButton {
  readonly text: string;
  readonly callback_data: string;
}
interface WebAppButton {
  readonly text: string;
  readonly web_app: { readonly url: string };
}
type InlineButton = CallbackButton | WebAppButton;
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
      isButton(row) ? [serializeInlineButton(row)] : row.map(serializeInlineButton),
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
    input_field_placeholder: 'از دکمه‌های پایین انتخاب کن',
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
    normalized === MENU_LABEL.order ||
    normalized === 'پیگیری سفارش'
  ) {
    return 'order';
  }
  if (
    normalized === '/renew' ||
    normalized.startsWith('/renew@') ||
    normalized === MENU_LABEL.renew ||
    normalized === 'تمدید سرویس'
  ) {
    return 'renew';
  }
  if (
    normalized === '/help' ||
    normalized.startsWith('/help@') ||
    normalized === MENU_LABEL.help ||
    normalized === 'راهنما'
  ) {
    return 'help';
  }
  if (normalized === MENU_LABEL.status || normalized === 'وضعیت سیستم') {
    return 'status';
  }
  if (normalized === MENU_LABEL.reports || normalized === 'گزارش‌ها') {
    return 'reports';
  }
  if (normalized === MENU_LABEL.queue || normalized === 'سفارش‌های باز') {
    return 'queue';
  }
  if (normalized === MENU_LABEL.admin || normalized === 'بخش ادمین') {
    return 'admin';
  }
  return null;
}

export function homeText(isAdmin: boolean): string {
  const lines = [
    '<b>سلام، خوش آمدی</b>',
    'از این گفتگو می‌توانی سرویس بخری، سفارش باز را پیگیری کنی، یا سرویس فعال را تمدید کنی.',
    '',
    'دکمه‌های پایین صفحه را لمس کن؛ لازم نیست دستوری تایپ کنی.',
  ];
  if (isAdmin) {
    lines.push('', 'برای وضعیت سیستم، گزارش‌ها و صف رسید، «بخش ادمین» را بزن.');
  }
  return lines.join('\n');
}

export function homeInlineKeyboard(isAdmin: boolean): TelegramInlineKeyboardMarkup {
  return inlineMenu([
    { text: MENU_LABEL.shop, callback_data: SHOP_CALLBACK },
    [
      { text: MENU_LABEL.order, callback_data: ORDER_CALLBACK },
      { text: MENU_LABEL.renew, callback_data: RENEW_CALLBACK },
    ],
    { text: MENU_LABEL.help, callback_data: HELP_CALLBACK },
    ...(isAdmin ? [{ text: MENU_LABEL.admin, callback_data: ADMIN_HUB_CALLBACK }] : []),
  ]);
}

export function homeReplyKeyboard(isAdmin: boolean): TelegramPersistentKeyboardMarkup {
  return persistentKeyboard([
    [MENU_LABEL.shop],
    [MENU_LABEL.order, MENU_LABEL.renew],
    [MENU_LABEL.help],
    ...(isAdmin ? [[MENU_LABEL.admin]] : []),
  ]);
}

export function shopText(): string {
  return ['<b>خرید سرویس</b>', 'دسته را انتخاب کن تا پلن‌ها و مبلغ دقیق را ببینی.'].join('\n');
}

export function emptyShopText(isAdmin: boolean): string {
  if (isAdmin) {
    return [
      '<b>فروشگاه خالی است</b>',
      'از کنسول کاتالوگ دسته و پلن را ذخیره و منتشر کن. بعد از انتشار، همین منوی خرید به‌روز می‌شود.',
    ].join('\n');
  }
  return [
    '<b>فروشگاه خالی است</b>',
    'هنوز پلنی برای فروش منتشر نشده. بعداً از منوی خرید دوباره سر بزن.',
  ].join('\n');
}

export function categoryText(input: {
  readonly name: string;
  readonly description: string;
  readonly parentName: string | null;
  readonly hasItems: boolean;
}): string {
  const lines = [`<b>${escapeHtml(input.name)}</b>`];
  if (input.parentName !== null) {
    lines.push(`زیرمجموعهٔ ${escapeHtml(input.parentName)}`);
  }
  const description = input.description.trim();
  if (description.length > 0) {
    lines.push(escapeHtml(description));
  }
  lines.push('');
  lines.push(
    input.hasItems
      ? 'یکی از پلن‌ها را لمس کن تا مدت، حجم و مبلغ را ببینی.'
      : 'در این دسته پلنی برای فروش نیست. از دکمهٔ بازگشت دستهٔ دیگری را باز کن.',
  );
  return lines.join('\n');
}

export function shopBackButton(): InlineButton {
  return { text: 'فروشگاه ⬅️', callback_data: SHOP_CALLBACK };
}

export function categoryBackButton(
  parent: { readonly id: string; readonly name: string } | null,
): InlineButton {
  if (parent === null) {
    return shopBackButton();
  }
  return { text: `${parent.name} ⬅️`, callback_data: `cat:${parent.id}` };
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
    '',
    'اگر همین پلن را می‌خواهی، «ادامه و دریافت شماره کارت» را بزن.',
  ].join('\n');
}

export function helpText(): string {
  return [
    '<b>راهنمای خرید</b>',
    '۱. از منوی پایین «خرید سرویس» را بزن، دسته و پلن را انتخاب کن.',
    '۲. مبلغ نمایش‌داده‌شده را <b>دقیقاً</b> کارت‌به‌کارت کن؛ همین عدد، نه گردشده.',
    '۳. فقط <b>عکس رسید</b> را در همین گفتگو بفرست. فایل PDF، سند یا ویدیو قبول نیست.',
    '۴. نتیجهٔ تأیید و لینک سرویس همین‌جا می‌آید؛ لینک را در انجمن گزارش نمی‌فرستیم.',
  ].join('\n');
}

export function orderStatusText(order: SalesOrder | null): string {
  if (order === null) {
    return ['<b>سفارش باز نداری</b>', 'برای شروع، «خرید سرویس» را از منوی پایین انتخاب کن.'].join(
      '\n',
    );
  }
  if (order.status === 'receipt_submitted') {
    return [
      '<b>سفارش در حال بررسی است</b>',
      `محصول: ${escapeHtml(order.productName)} — ${escapeHtml(order.variantName)}`,
      `مبلغ: ${escapeHtml(formatMoney(order.amountIrr))}`,
      'نتیجه را همین‌جا می‌فرستیم؛ لازم نیست دوباره پرداخت کنی.',
    ].join('\n');
  }
  if (order.status === 'rejected') {
    return [
      '<b>رسید قبلی تأیید نشد</b>',
      'یک عکس واضح‌تر از همان پرداخت را همین‌جا بفرست. مبلغ را دوباره واریز نکن مگر پشتیبانی بگوید.',
    ].join('\n');
  }
  if (order.status === 'provisioning') {
    return [
      '<b>پرداخت تأیید شد</b>',
      'سرویس در حال آماده‌سازی است. لینک را همین گفتگو دریافت می‌کنی.',
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
    'بعد از کارت‌به‌کارت، فقط عکس رسید را در همین گفتگو بفرست.',
  ].join('\n');
}

export function checkoutText(
  order: { readonly amountIrr: bigint },
  cardNumber: string,
  cardHolder: string,
): string {
  return [
    '<b>سفارش ثبت شد؛ نوبت پرداخت است</b>',
    'مبلغ را دقیقاً با همین عدد کارت‌به‌کارت کن.',
    '',
    `💰 <b>${escapeHtml(formatMoney(order.amountIrr))}</b>`,
    `💳 <code>${escapeHtml(formatCardNumber(cardNumber))}</code>`,
    `👤 ${escapeHtml(cardHolder)}`,
    '',
    'شماره کارت را لمس کن تا کپی شود. بعد از واریز، <b>فقط عکس رسید</b> را همین‌جا بفرست.',
  ].join('\n');
}

export function receiptAcceptedText(): string {
  return [
    '<b>رسید ثبت شد</b>',
    'برای بررسی ارسال شد. نتیجه را همین گفتگو اعلام می‌کنیم؛ لازم نیست پیام دیگری تایپ کنی.',
  ].join('\n');
}

export function noOpenOrderText(): string {
  return [
    '<b>سفارش باز پیدا نشد</b>',
    'اول از منوی پایین «خرید سرویس» را بزن، بعد عکس رسید را بفرست.',
  ].join('\n');
}

export function receiptUnderReviewText(): string {
  return [
    '<b>همین سفارش در حال بررسی است</b>',
    'رسید قبلی برای بررسی رفته. اگر عکس واضح‌تری داری، صبر کن تا نتیجه اعلام شود.',
  ].join('\n');
}

export function receiptConflictText(code: string): string {
  if (code === 'OPEN_ORDER_UNDER_REVIEW') {
    return receiptUnderReviewText();
  }
  if (code === 'NO_ORDER_AWAITING_PAYMENT') {
    return noOpenOrderText();
  }
  return ['<b>رسید ثبت نشد</b>', 'عملیات انجام نشد؛ دوباره تلاش کن.'].join('\n');
}

export function receiptPhotoHint(): string {
  return [
    '<b>رسید را به‌صورت عکس بفرست</b>',
    'فایل، ویدیو یا PDF برای بررسی قبول نیست. از رسید اسکرین یا عکس واضح بگیر و همان را بفرست.',
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

export function renewalFailedText(): string {
  return [
    '<b>تمدید الان تمام نشد</b>',
    'سرویس قبلی هنوز پابرجاست. کمی بعد از منوی تمدید دوباره تلاش کن.',
  ].join('\n');
}

export function noActiveServiceText(): string {
  return [
    '<b>سرویس فعالی برای تمدید پیدا نشد</b>',
    'اول از منوی پایین یک سرویس بخر؛ بعد از فعال شدن می‌توانی تمدید کنی.',
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
  return ['از دکمه‌های پایین صفحه انتخاب کن.', 'لازم نیست چیزی تایپ کنی.'].join('\n');
}

export function adminStatusText(input: {
  readonly categoryCount: number;
  readonly forumConfigured: boolean;
  readonly localIntake: boolean;
  readonly telegramReady: boolean;
  readonly telegramError: string;
  readonly reportsPending: number;
  readonly reportsFailed: number;
}): string {
  const errorLine =
    input.telegramError === 'none'
      ? 'خطای ورودی: ندارد'
      : `خطای ورودی: ${escapeHtml(input.telegramError)}`;
  return [
    '<b>وضعیت سیستم</b>',
    `فروشگاه: ${String(input.categoryCount)} دستهٔ ریشه`,
    `گزارش انجمن: ${input.forumConfigured ? 'فعال' : 'خاموش'}`,
    `ورودی تلگرام: ${input.localIntake ? 'محلی' : 'وب‌هوک'}`,
    `آمادگی ورودی: ${input.telegramReady ? 'آماده' : 'قطع'}`,
    errorLine,
    `صف گزارش: ${String(input.reportsPending)} در انتظار، ${String(input.reportsFailed)} ناموفق`,
  ].join('\n');
}

export function adminReportsText(input: {
  readonly forumConfigured: boolean;
  readonly reportsPending: number;
  readonly reportsFailed: number;
}): string {
  return [
    '<b>گزارش‌ها</b>',
    input.forumConfigured
      ? 'رویدادها به‌صورت خودکار به انجمن خصوصی می‌روند. لینک اشتراک آنجا ارسال نمی‌شود.'
      : 'انجمن گزارش هنوز پیکربندی نشده. تا آن زمان فقط همین گفتگو را ببین.',
    `صف: ${String(input.reportsPending)} در انتظار، ${String(input.reportsFailed)} ناموفق`,
  ].join('\n');
}

export function adminReportsKeyboard(canPublishSummary: boolean): TelegramInlineKeyboardMarkup {
  return columnKeyboard([
    ...(canPublishSummary
      ? [{ text: 'ارسال خلاصه امروز', callback_data: ADMIN_SUMMARY_CALLBACK }]
      : []),
    backToMenuButton(),
  ]);
}

export function dailySummaryQueuedText(created: boolean): string {
  return created
    ? [
        '<b>خلاصه امروز ثبت شد</b>',
        'اگر انجمن فعال باشد، همین متن بدون لینک اشتراک به موضوع خلاصه روزانه می‌رود.',
      ].join('\n')
    : ['<b>خلاصه امروز از قبل ثبت بود</b>', 'ارسال تکراری به انجمن انجام نمی‌شود.'].join('\n');
}

export function adminHubText(): string {
  return [
    '<b>بخش ادمین</b>',
    'وضعیت سیستم، گزارش انجمن، صف رسید و ساخت ناموفق از همین‌جا باز می‌شود.',
    'سلامت کاتالوگ فقط تعداد دسته و وضعیت انتشار کارت را نشان می‌دهد؛ رقم کارت اینجا نیست.',
    'رسیدها با عکس در چت خصوصی می‌آیند؛ تأیید و رد روی همان پیام است.',
    'کاتالوگ از کنسول جداگانه منتشر می‌شود؛ از ربات محصول جدید نساز.',
  ].join('\n');
}

export function adminHubKeyboard(catalogConsoleUrl?: string | null): TelegramInlineKeyboardMarkup {
  return inlineMenu([
    { text: MENU_LABEL.status, callback_data: ADMIN_STATUS_CALLBACK },
    [
      { text: MENU_LABEL.reports, callback_data: ADMIN_REPORTS_CALLBACK },
      { text: MENU_LABEL.queue, callback_data: ADMIN_QUEUE_CALLBACK },
    ],
    { text: MENU_LABEL.failed, callback_data: ADMIN_FAILED_CALLBACK },
    { text: MENU_LABEL.catalog, callback_data: ADMIN_CATALOG_CALLBACK },
    ...(catalogConsoleUrl === undefined ||
    catalogConsoleUrl === null ||
    catalogConsoleUrl.length === 0
      ? []
      : [{ text: 'کنسول کاتالوگ 🧩', web_app: { url: catalogConsoleUrl } }]),
    backToMenuButton(),
  ]);
}

export function catalogConsoleUrl(miniAppUrl: string | null): string | null {
  if (miniAppUrl === null || miniAppUrl.length === 0) {
    return null;
  }
  return new URL('console/', miniAppUrl.endsWith('/') ? miniAppUrl : `${miniAppUrl}/`).href;
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
    { text: MENU_LABEL.admin, callback_data: ADMIN_HUB_CALLBACK },
  ]);
}

export function adminFailedProvisioningText(orders: readonly SalesOrder[]): string {
  if (orders.length === 0) {
    return ['<b>ساخت ناموفق نیست</b>', 'سفارشی در انتظار تلاش مجدد ساخت سرویس نیست.'].join('\n');
  }
  return ['<b>ساخت ناموفق</b>', 'یکی را برای تلاش مجدد انتخاب کن. پرداخت دوباره لازم نیست.'].join(
    '\n',
  );
}

export function adminCatalogHealthText(input: {
  readonly categoryCount: number;
  readonly cardPublished: boolean;
}): string {
  return [
    '<b>سلامت کاتالوگ</b>',
    `دسته‌های ریشهٔ منتشرشده: ${String(input.categoryCount)}`,
    input.cardPublished ? 'کارت کارت‌به‌کارت: منتشر شده' : 'کارت کارت‌به‌کارت: هنوز منتشر نشده',
    'رقم کارت در این پیام نیست. انتشار از کنسول کاتالوگ است، نه از همین گفتگو.',
  ].join('\n');
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

function serializeInlineButton(button: InlineButton): TelegramInlineButton {
  const text = buttonLabel(button.text);
  if ('web_app' in button) {
    return { text, web_app: button.web_app };
  }
  return { text, callback_data: button.callback_data };
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
