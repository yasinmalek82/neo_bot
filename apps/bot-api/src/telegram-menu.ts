import type { SalesOrder, SalesOrderStatus, SellableProductVariant } from '@neo-bot/domain';

import type {
  TelegramInlineButton,
  TelegramInlineKeyboardMarkup,
  TelegramPersistentKeyboardMarkup,
  TelegramReplyKeyboardButton,
} from './telegram-api.js';

export const HOME_CALLBACK = 'menu';
export const SHOP_CALLBACK = 'shop';
export const ORDER_CALLBACK = 'order';
export const RENEW_CALLBACK = 'renew';
export const RENEW_CONFIRM_CALLBACK = 'renew:confirm';
export const HELP_CALLBACK = 'help';
export const GUIDE_CALLBACK = 'guide';
export const ADMIN_STATUS_CALLBACK = 'admin:status';
export const ADMIN_REPORTS_CALLBACK = 'admin:reports';
export const ADMIN_QUEUE_CALLBACK = 'admin:queue';
export const ADMIN_HUB_CALLBACK = 'admin:hub';
export const ADMIN_SUMMARY_CALLBACK = 'admin:summary';
export const ADMIN_FAILED_CALLBACK = 'admin:failed';
export const ADMIN_CATALOG_CALLBACK = 'admin:catalog';
export const ADMIN_STORE_CALLBACK = 'admin:store';
const FLOW_CANCEL_CALLBACK = 'flow:cancel';
const FLOW_SKIP_COUPON_CALLBACK = 'flow:skip-coupon';
export const WALLET_TOPUP_CALLBACK = 'wallet:topup';
export const TICKET_NEW_CALLBACK = 'ticket:new';
export const TICKET_FOLLOW_PREFIX = 'ticket:follow:';
export const TRIAL_CALLBACK = 'trial';
export const SERVICES_CALLBACK = 'services';
export const JOIN_REFRESH_CALLBACK = 'join:refresh';
export const ADMIN_OPS_CALLBACK = 'admin:ops';
export const ADMIN_BROADCAST_CALLBACK = 'admin:broadcast';
export const ADMIN_BROADCAST_CANCEL_PREFIX = 'admin:broadcast:cancel:';

export const MENU_LABEL = {
  home: 'منوی اصلی 🏠',
  shop: 'خرید سریع 🛍',
  guide: 'راهنمای انتخاب 🧭',
  order: 'پیگیری سفارش 📦',
  renew: 'تمدید سرویس ♻️',
  wallet: 'شارژ کیف پول 💳',
  ticket: 'تیکت پشتیبانی 🎫',
  trial: 'سرویس تست 🎁',
  services: 'سرویس‌های من 📡',
  help: 'راهنما 📘',
  status: 'وضعیت سیستم ⚙️',
  reports: 'گزارش‌ها 📣',
  queue: 'سفارش‌های باز 📋',
  failed: 'ساخت ناموفق ⚠️',
  catalog: 'سلامت کاتالوگ 🗂️',
  store: 'مدیریت فروشگاه 🏪',
  admin: 'بخش ادمین 👨‍💻',
} as const;

export type MenuAction =
  | 'home'
  | 'shop'
  | 'guide'
  | 'order'
  | 'renew'
  | 'wallet'
  | 'ticket'
  | 'trial'
  | 'services'
  | 'help'
  | 'status'
  | 'reports'
  | 'queue'
  | 'admin'
  | 'store';

interface CallbackButton {
  readonly text: string;
  readonly callback_data?: string;
  readonly url?: string;
}
type InlineButton = CallbackButton;
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

function inlineMenu(rows: readonly InlineRow[]): TelegramInlineKeyboardMarkup {
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

export function isHomeMenuText(text: string): boolean {
  const normalized = text.trim();
  return (
    normalized === '/start' ||
    normalized.startsWith('/start@') ||
    normalized === 'منوی اصلی' ||
    normalized === MENU_LABEL.home
  );
}

export function matchMenuAction(text: string): MenuAction | null {
  const normalized = text.trim();
  if (isHomeMenuText(normalized)) {
    return 'home';
  }
  if (
    normalized === '/buy' ||
    normalized === MENU_LABEL.shop ||
    normalized === 'خرید سرویس' ||
    normalized === 'خرید سریع' ||
    normalized === 'خرید'
  ) {
    return 'shop';
  }
  if (normalized === MENU_LABEL.guide || normalized === 'راهنمای انتخاب') {
    return 'guide';
  }
  if (
    normalized === '/order' ||
    normalized.startsWith('/order@') ||
    normalized === MENU_LABEL.order ||
    normalized === 'پیگیری سفارش' ||
    normalized === 'سفارش'
  ) {
    return 'order';
  }
  if (
    normalized === '/renew' ||
    normalized.startsWith('/renew@') ||
    normalized === MENU_LABEL.renew ||
    normalized === 'تمدید سرویس' ||
    normalized === 'تمدید'
  ) {
    return 'renew';
  }
  if (normalized === MENU_LABEL.wallet || normalized === 'شارژ کیف پول') {
    return 'wallet';
  }
  if (normalized === MENU_LABEL.ticket || normalized === 'تیکت پشتیبانی') {
    return 'ticket';
  }
  if (
    normalized === MENU_LABEL.trial ||
    normalized === 'سرویس تست' ||
    normalized === 'تست رایگان'
  ) {
    return 'trial';
  }
  if (normalized === MENU_LABEL.services || normalized === 'سرویس‌های من') {
    return 'services';
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
  if (normalized === MENU_LABEL.store || normalized === 'مدیریت فروشگاه') {
    return 'store';
  }
  return null;
}

export function homeText(isAdmin: boolean): string {
  const lines = [
    '<b>NEO NETWORK</b>',
    '<i>PRIVATE ACCESS</i>',
    '',
    'خرید سریع، پرداخت و ارسال رسید همه در همین گفتگو است.',
    'شارژ کیف پول، سرویس‌های من و تیکت پشتیبانی از دکمه‌های پایین در دسترس است.',
    '',
    'دکمه‌های پایین صفحه را لمس کن؛ لازم نیست دستوری تایپ کنی.',
  ];
  if (isAdmin) {
    lines.push('', 'برای وضعیت سیستم، گزارش‌ها، صف رسید و مدیریت فروشگاه، «بخش ادمین» را بزن.');
  }
  return lines.join('\n');
}

export function homeReplyKeyboard(
  isAdmin: boolean,
  extras: { readonly trialEligible?: boolean } = {},
): TelegramPersistentKeyboardMarkup {
  const rows: TelegramReplyKeyboardButton[][] = [[{ text: buttonLabel(MENU_LABEL.shop) }]];
  if (extras.trialEligible === true) {
    rows.push([{ text: buttonLabel(MENU_LABEL.trial) }]);
  }
  rows.push(
    [{ text: buttonLabel(MENU_LABEL.services) }],
    [{ text: buttonLabel(MENU_LABEL.guide) }],
    [{ text: buttonLabel(MENU_LABEL.order) }, { text: buttonLabel(MENU_LABEL.renew) }],
    [{ text: buttonLabel(MENU_LABEL.wallet) }, { text: buttonLabel(MENU_LABEL.ticket) }],
    [{ text: buttonLabel(MENU_LABEL.help) }],
    [{ text: buttonLabel(MENU_LABEL.home) }],
  );
  if (isAdmin) {
    rows.push([{ text: buttonLabel(MENU_LABEL.admin) }]);
  }
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'از دکمه‌های پایین انتخاب کن',
  };
}

export function shopText(): string {
  return ['<b>خرید سریع</b>', 'یک دسته انتخاب کن تا پلن‌ها و قیمت هر پلن را ببینی.'].join('\n');
}

export function homeReturnText(): string {
  return 'به منوی اصلی برگشتی. از دکمه‌های پایین صفحه انتخاب کن.';
}

export function productPlansText(input: {
  readonly productName: string;
  readonly planCount: number;
  readonly page: number;
  readonly pageCount: number;
  readonly variants: readonly SellableProductVariant[];
}): string {
  return [
    `<b>${escapeWithin(input.productName, 300)}</b>`,
    `پلن مناسب را انتخاب کن · صفحه ${String(input.page + 1)} از ${String(input.pageCount)}`,
    `${String(input.planCount)} پلن فعال با قیمت نهایی نمایش داده می‌شود.`,
    '',
    ...input.variants.slice(0, 3).flatMap((variant, index) => productPlanBlock(variant, index + 1)),
  ].join('\n');
}

function productPlanBlock(variant: SellableProductVariant, index: number): readonly string[] {
  const devices = variant.deviceLimit === 0 ? 'نامحدود' : `${String(variant.deviceLimit)} دستگاه`;
  return [
    `<b>${String(index)}. ${escapeWithin(variant.name, 100)}</b>`,
    ...(variant.description.trim().length === 0 ? [] : [escapeWithin(variant.description, 160)]),
    ...(variant.evidenceBadge === undefined
      ? []
      : [`نشان: <b>${escapeHtml(variant.evidenceBadge.label)}</b>`]),
    `حجم: <b>${escapeHtml(formatTrafficLabel(variant.dataLimitBytes))}</b> · مدت: <b>${String(variant.durationDays)} روز</b> · اتصال: <b>${escapeHtml(devices)}</b>`,
    ...(variant.displayAttributes ?? [])
      .slice(0, 4)
      .map(
        (attribute) =>
          `${escapeWithin(attribute.label, 40)}: <b>${escapeWithin(attribute.value, 80)}</b>`,
      ),
    `قیمت نهایی: <b>${escapeHtml(formatMoney(variant.priceIrr))}</b>`,
    '',
  ];
}

export function escapeWithin(value: string, maxEscapedLength: number): string {
  const escaped = escapeHtml(value.trim());
  if (escaped.length <= maxEscapedLength) return escaped;
  let result = '';
  for (const character of Array.from(value.trim())) {
    const encoded = escapeHtml(character);
    if (result.length + encoded.length + 1 > maxEscapedLength) break;
    result += encoded;
  }
  return `${result}…`;
}

export function emptyShopText(isAdmin: boolean): string {
  if (isAdmin) {
    return [
      '<b>فروشگاه خالی است</b>',
      'از «مدیریت فروشگاه» دسته و پلن را بساز و منتشر کن. بعد از انتشار، همین فروشگاه به روز می شود.',
    ].join('\n');
  }
  return [
    '<b>فروشگاه خالی است</b>',
    'فعلاً پلن فعالی برای فروش منتشر نشده. کمی بعد دوباره «خرید سریع» را بزن.',
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
      ? 'یک محصول انتخاب کن تا پلن‌ها و قیمت‌ها را مقایسه کنی.'
      : 'در این دسته پلن فعالی نیست. با دکمهٔ دستهٔ قبلی یا «خرید سریع ⬅️» برگرد.',
  );
  return lines.join('\n');
}

export function missingCategoryText(): string {
  const shopBack = shopBackButton().text;
  return [
    '<b>دسته در دسترس نیست</b>',
    `این دسته حذف شده یا موقتاً غیرفعال است. با دکمهٔ «${shopBack}» به لیست دسته‌ها برگرد.`,
  ].join('\n');
}

export function shopBackButton(): InlineButton {
  return { text: 'خرید سریع ⬅️', callback_data: SHOP_CALLBACK };
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

export function serviceDeliveredText(subscriptionUrl: string): string {
  return [
    '<b>NEO NETWORK | سرویس آماده است</b>',
    'لینک اشتراک را در برنامه وارد کن.',
    '',
    `<code>${escapeHtml(subscriptionUrl)}</code>`,
  ].join('\n');
}

export function renewalCompletedText(subscriptionUrl: string): string {
  return [
    '<b>NEO NETWORK | تمدید انجام شد</b>',
    'لینک اشتراک به‌روز است و همان لینک قبلی قابل استفاده است.',
    '',
    `<code>${escapeHtml(subscriptionUrl)}</code>`,
  ].join('\n');
}

export function renewalPreviewText(): string {
  return [
    '<b>تمدید سرویس</b>',
    'آخرین سرویس فعال با مشخصات و قیمت فعلی همان پلن تمدید می‌شود.',
    'پس از تأیید، اطلاعات پرداخت نمایش داده می‌شود؛ تمدید فقط پس از تأیید رسید انجام می‌شود.',
  ].join('\n');
}

export function variantText(variant: SellableProductVariant): string {
  const traffic = formatTrafficLabel(variant.dataLimitBytes);
  const devices = variant.deviceLimit === 0 ? 'نامحدود' : `${String(variant.deviceLimit)} دستگاه`;
  const description = variant.description.trim();
  return [
    `<b>${escapeWithin(variant.productName, 250)}</b>`,
    `<b>${escapeWithin(variant.name, 300)}</b>`,
    ...(description.length === 0 ? [] : [escapeWithin(description, 1_000)]),
    '',
    `حجم: <b>${escapeHtml(traffic)}</b>`,
    `مدت: <b>${String(variant.durationDays)} روز</b>`,
    `اتصال همزمان: <b>${escapeHtml(devices)}</b>`,
    ...(variant.displayAttributes ?? [])
      .slice(0, 4)
      .map(
        (attribute) =>
          `${escapeWithin(attribute.label, 80)}: <b>${escapeWithin(attribute.value, 300)}</b>`,
      ),
    `قیمت: <b>${escapeHtml(formatMoney(variant.priceIrr))}</b>`,
    '',
    'برای ثبت سفارش، «ادامه و دریافت شماره کارت» را بزن.',
  ].join('\n');
}

export function variantListLabel(variant: SellableProductVariant): string {
  const traffic = formatTrafficLabel(variant.dataLimitBytes);
  return [
    formatCompactPrice(variant.priceIrr),
    variant.name,
    traffic,
    `${String(variant.durationDays)} روز`,
  ].join(' · ');
}

export function helpText(): string {
  return [
    '<b>راهنمای خرید</b>',
    'فروشگاه همین چت است؛ «خرید سریع» را بزن، دسته و پلن را انتخاب کن.',
    'مبلغ نمایش‌داده‌شده را کارت‌به‌کارت کن و عکس رسید را در همین چت خصوصی بفرست.',
    'PDF و ویدیو پذیرفته نمی‌شود. بررسی رسید و اعلام نتیجه حداکثر ۶۰ دقیقه زمان می‌برد.',
    'پس از تأیید، لینک سرویس در همین گفتگوی خصوصی ارسال می‌شود.',
    'شارژ کیف پول و تیکت پشتیبانی از دکمه‌های پایین صفحه یا همین پیام در دسترس است.',
  ].join('\n');
}

export function helpKeyboard(): TelegramInlineKeyboardMarkup {
  return columnKeyboard([
    { text: 'شارژ کیف پول', callback_data: WALLET_TOPUP_CALLBACK },
    { text: 'تیکت پشتیبانی', callback_data: TICKET_NEW_CALLBACK },
    backToMenuButton(),
  ]);
}

export function discountPromptText(): string {
  return [
    '<b>کد تخفیف</b>',
    'اگر کد تخفیف داری همین‌جا بفرست.',
    'اگر نداری «بدون کد تخفیف» را بزن.',
  ].join('\n');
}

export function invalidDiscountText(): string {
  return 'این کد تخفیف معتبر نیست. دوباره بفرست یا بدون کد ادامه بده.';
}

export function walletAmountPromptText(): string {
  return [
    '<b>مبلغ شارژ کیف پول</b>',
    'مبلغ را به تومان و فقط با عدد بفرست.',
    'برای انصراف «لغو» یا «منوی اصلی» را بزن.',
  ].join('\n');
}

export function invalidWalletAmountText(): string {
  return 'مبلغ نامعتبر است. یک عدد مثبت به تومان بفرست.';
}

export function walletCreditedText(): string {
  return 'شارژ کیف پول ثبت شد. اگر همین پیام تکرار شود، مبلغ دوباره کم یا زیاد نمی‌شود.';
}

export function ticketCreatePromptText(): string {
  return [
    '<b>تیکت پشتیبانی</b>',
    'شرح مشکل را همین‌جا بفرست.',
    'متن تیکت فقط در ثبت امن ذخیره می‌شود و در تاریخچه جلسه نمی‌ماند.',
  ].join('\n');
}

export function ticketFollowUpPromptText(): string {
  return 'پیام بعدی این تیکت را بفرست.';
}

export function invalidTicketBodyText(): string {
  return 'متن تیکت خالی یا خیلی طولانی است. دوباره بفرست.';
}

export function ticketSubmittedText(): string {
  return 'تیکت ثبت شد. اگر لازم بود از دکمه «پیام بعدی» ادامه بده.';
}

export function conversationExpiredText(): string {
  return 'این مرحله منقضی شد. از منو دوباره شروع کن.';
}

export function conversationMalformedText(): string {
  return 'این مرحله قابل ادامه نیست. از منو دوباره شروع کن.';
}

export function conversationCancelledText(): string {
  return 'این مرحله لغو شد.';
}

export function discountSkipButton(): { readonly text: string; readonly callback_data: string } {
  return { text: 'بدون کد تخفیف', callback_data: FLOW_SKIP_COUPON_CALLBACK };
}

export function flowCancelButton(): { readonly text: string; readonly callback_data: string } {
  return { text: 'لغو', callback_data: FLOW_CANCEL_CALLBACK };
}

export function guideText(): string {
  return [
    '<b>راهنمای انتخاب</b>',
    'حجم را بر اساس مصرف ماهانه انتخاب کن؛ اگر مطمئن نیستی از پلن کم‌حجم‌تر شروع کن.',
    'تعداد دستگاه را برابر استفاده هم‌زمان انتخاب کن.',
    'مدت بیشتر را فقط وقتی انتخاب کن که الگوی مصرفت مشخص است.',
    'برای دیدن جزئیات هر پلن، دکمه «دیدن پلن‌ها» را بزن.',
  ].join('\n');
}

export function guideInlineKeyboard(): TelegramInlineKeyboardMarkup {
  return columnKeyboard([
    { text: 'دیدن پلن‌ها', callback_data: SHOP_CALLBACK },
    backToMenuButton(),
  ]);
}

export function orderStatusText(order: SalesOrder | null): string {
  if (order === null) {
    return ['<b>سفارش باز نداری</b>', 'برای شروع، «خرید سریع» را از منوی پایین انتخاب کن.'].join(
      '\n',
    );
  }
  if (order.status === 'receipt_submitted') {
    return [
      '<b>سفارش در حال بررسی است</b>',
      `محصول: ${escapeHtml(order.productName)} — ${escapeHtml(order.variantName)}`,
      `مبلغ: ${escapeHtml(formatMoney(order.amountIrr))}`,
      'بررسی و اعلام نتیجه حداکثر ۶۰ دقیقه زمان می‌برد؛ لازم نیست دوباره پرداخت کنی.',
    ].join('\n');
  }
  if (order.status === 'rejected') {
    return [
      '<b>رسید قبلی تایید نشد</b>',
      'یک عکس واضح تر از همان پرداخت را همین جا بفرست. مبلغ را دوباره واریز نکن مگر پشتیبانی بگوید.',
    ].join('\n');
  }
  if (order.status === 'provisioning') {
    return [
      '<b>پرداخت تایید شد</b>',
      'سرویس در حال آماده سازی است. لینک را همین گفتگو دریافت می کنی.',
    ].join('\n');
  }
  if (order.status === 'provisioning_failed') {
    return [
      '<b>آماده سازی سرویس کامل نشد</b>',
      'پشتیبانی در حال بررسی است. لازم نیست دوباره پرداخت کنی.',
    ].join('\n');
  }
  if (order.status === 'fulfilled') {
    return [
      '<b>سفارش تکمیل شد</b>',
      `محصول: ${escapeHtml(order.productName)} — ${escapeHtml(order.variantName)}`,
      'اگر نیاز داشتی، از منوی پایین «تمدید سرویس» را بزن.',
    ].join('\n');
  }
  if (order.status === 'cancelled') {
    return ['<b>سفارش لغو شد</b>', 'برای شروع دوباره از منوی پایین «خرید سریع» را انتخاب کن.'].join(
      '\n',
    );
  }
  return [
    '<b>سفارش منتظر پرداخت است</b>',
    `محصول: ${escapeHtml(order.productName)} — ${escapeHtml(order.variantName)}`,
    `مبلغ دقیق: <b>${escapeHtml(formatMoney(order.amountIrr))}</b>`,
    'بعد از کارت‌به‌کارت، فقط عکس رسید را در همین گفتگو بفرست.',
  ].join('\n');
}

export function serviceUsernamePromptText(variantName: string): string {
  return [
    '<b>نام سرویس را انتخاب کن</b>',
    `برای «${escapeHtml(variantName)}» یک نام کوتاه انگلیسی بفرست تا سرویس با آن شناخته شود.`,
    'حروف کوچک انگلیسی، عدد، خط تیره و زیرخط مجاز است؛ فاصله و @ مجاز نیست.',
    'برای یکتا ماندن سرویس، یک بخش کوتاه خودکار به انتهای نام اضافه می‌شود.',
    '',
    'مثال: <code>ali_reza</code>',
  ].join('\n');
}

export function invalidServiceUsernameBaseText(): string {
  return [
    'نام کاربری نامعتبر است.',
    'فقط <code>a-z</code>، <code>0-9</code>، <code>_</code> و <code>-</code> بدون فاصله و بدون @ مجاز است.',
    'دوباره یک نام پایه بفرست.',
  ].join('\n');
}

export function checkoutText(
  order: { readonly amountIrr: bigint },
  cardNumber: string,
  cardHolder: string,
): string {
  return [
    '<b>سفارش ثبت شد؛ نوبت پرداخت است</b>',
    'مبلغ را دقیقا با همین عدد کارت به کارت کن.',
    '',
    `💰 <b>${escapeHtml(formatMoney(order.amountIrr))}</b>`,
    `💳 <code>${escapeHtml(formatCardNumber(cardNumber))}</code>`,
    `👤 ${escapeHtml(cardHolder)}`,
    '',
    'شماره کارت را لمس کن تا کپی شود. بعد از واریز، <b>فقط عکس رسید</b> را همین جا بفرست.',
    'بررسی رسید و اعلام نتیجه حداکثر ۶۰ دقیقه زمان می‌برد. برای دیدن وضعیت، «پیگیری سفارش» را بزن.',
  ].join('\n');
}

export function receiptAcceptedText(): string {
  return [
    '<b>رسید ثبت شد</b>',
    'برای بررسی ارسال شد. اعلام نتیجه حداکثر ۶۰ دقیقه زمان می‌برد؛ لازم نیست پیام دیگری تایپ کنی.',
  ].join('\n');
}

export function receiptRejectedText(): string {
  return ['<b>رسید تایید نشد</b>', 'یک عکس واضح تر از همان پرداخت را همین جا بفرست.'].join('\n');
}

function noOpenOrderText(): string {
  return [
    '<b>سفارش باز پیدا نشد</b>',
    'اول از منوی پایین «خرید سریع» را بزن، بعد عکس رسید را بفرست.',
  ].join('\n');
}

function receiptUnderReviewText(): string {
  return [
    '<b>همین سفارش در حال بررسی است</b>',
    'رسید قبلی برای بررسی رفته و اعلام نتیجه حداکثر ۶۰ دقیقه زمان می‌برد. لازم نیست دوباره عکس بفرستی.',
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
    'ادمین باید کارت را از «مدیریت فروشگاه» ذخیره و منتشر کند. الان پرداخت نکن.',
  ].join('\n');
}

export function provisioningDelayedText(): string {
  return [
    '<b>پرداخت تأیید شد</b>',
    'آماده‌سازی سرویس کامل نشد. لازم نیست دوباره پرداخت کنی؛ نتیجه را همین‌جا می‌فرستیم.',
  ].join('\n');
}

export function deliveryAnchorText(): string {
  return [
    '<b>سرویس شما آماده شد</b>',
    'لینک اشتراک در همین پیام ثبت می‌شود؛ چند لحظه صبر کن.',
  ].join('\n');
}

export function deliveryStageLabel(stage: string): string {
  switch (stage) {
    case 'pending_brand_media':
      return 'در انتظار ارسال';
    case 'pending_link':
      return 'در انتظار ثبت لینک';
    case 'delivered':
      return 'تحویل داده شد';
    case 'failed':
      return 'ارسال ناموفق — قابل تلاش مجدد';
    default:
      return 'نامشخص';
  }
}

export function renewalFailedText(): string {
  return [
    '<b>ثبت سفارش تمدید انجام نشد</b>',
    'سرویس قبلی تغییری نکرده است. کمی بعد دوباره تلاش کن.',
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
      return 'رسید تایید نشد؛ عکس واضح تر بفرست';
    case 'provisioning':
      return 'در حال آماده سازی سرویس';
    case 'provisioning_failed':
      return 'آماده سازی ناتمام؛ پشتیبانی در حال بررسی است';
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
  return adminScreenKeyboard(
    canPublishSummary ? [{ text: 'ارسال خلاصه امروز', callback_data: ADMIN_SUMMARY_CALLBACK }] : [],
  );
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
    '<b>NEO NETWORK — بخش ادمین</b>',
    'مدیریت فروشگاه، تنظیمات پرداخت، گزارش‌ها و صف رسید از همین چت خصوصی انجام می‌شود.',
    'مدیریت فروشگاه مسیر واحد ساخت، ویرایش، بایگانی و انتشار دسته و پلن است.',
    'رسیدها با عکس در چت خصوصی می‌آیند؛ تأیید و رد روی همان پیام است.',
    'اطلاعات حساس کارت فقط هنگام ورود نمایش داده نمی‌شود و پیش‌نمایش آن ماسک است.',
  ].join('\n');
}

export function adminHubKeyboard(): TelegramInlineKeyboardMarkup {
  return inlineMenu([
    { text: MENU_LABEL.status, callback_data: ADMIN_STATUS_CALLBACK },
    [
      { text: MENU_LABEL.reports, callback_data: ADMIN_REPORTS_CALLBACK },
      { text: MENU_LABEL.queue, callback_data: ADMIN_QUEUE_CALLBACK },
    ],
    { text: MENU_LABEL.store, callback_data: ADMIN_STORE_CALLBACK },
    { text: MENU_LABEL.failed, callback_data: ADMIN_FAILED_CALLBACK },
    { text: MENU_LABEL.catalog, callback_data: ADMIN_CATALOG_CALLBACK },
    { text: 'تنظیمات تجاری 🛠', callback_data: ADMIN_OPS_CALLBACK },
    { text: 'پیام همگانی 📢', callback_data: ADMIN_BROADCAST_CALLBACK },
    backToMenuButton(),
  ]);
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
      text: `${formatToman(order.amountIrr)} · ${reviewStatusLabel(order.status)}`,
      callback_data: `admin:order:${order.id}`,
    })),
    ...adminScreenNavRows(),
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
    'رقم کارت در این پیام نیست. انتشار از «مدیریت فروشگاه» انجام می‌شود.',
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
  return { text: MENU_LABEL.home, callback_data: HOME_CALLBACK };
}

export function adminBackButton(): InlineButton {
  return { text: MENU_LABEL.admin, callback_data: ADMIN_HUB_CALLBACK };
}

export function adminScreenNavRows(): readonly InlineRow[] {
  return [adminBackButton(), backToMenuButton()];
}

export function adminScreenKeyboard(
  buttons: readonly InlineButton[] = [],
): TelegramInlineKeyboardMarkup {
  return columnKeyboard([...buttons, adminBackButton(), backToMenuButton()]);
}

export function storeWizardKeyboard(
  extras: readonly InlineButton[] = [],
): TelegramInlineKeyboardMarkup {
  return columnKeyboard([
    ...extras,
    { text: 'لغو', callback_data: 'store:cancel' },
    backToMenuButton(),
  ]);
}

export function adminDeniedText(): string {
  return [
    '<b>این بخش فقط برای مدیر فروشگاه است</b>',
    'از دکمه‌های پایین صفحه خرید، پیگیری سفارش یا راهنما را انتخاب کن.',
  ].join('\n');
}

export function formatMoney(amountIrr: bigint): string {
  return formatTomanAmount(amountIrr);
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

function formatToman(amountIrr: bigint): string {
  return formatCompactPrice(amountIrr);
}

function formatCompactPrice(amountIrr: bigint): string {
  return formatTomanAmount(amountIrr);
}

function formatTomanAmount(amountIrr: bigint): string {
  const formatter = new Intl.NumberFormat('fa-IR');
  const negative = amountIrr < 0n;
  const absoluteAmount = negative ? -amountIrr : amountIrr;
  const toman = absoluteAmount / 10n;
  const rialRemainder = absoluteAmount % 10n;
  const sign = negative ? '-' : '';
  if (rialRemainder === 0n) {
    return `${sign}${formatter.format(toman)} تومان`;
  }
  return `${sign}${formatter.format(toman)}٫${formatter.format(rialRemainder)} تومان`;
}

function formatTrafficLabel(dataLimitBytes: bigint): string {
  if (dataLimitBytes === 0n) {
    return 'نامحدود';
  }
  return `${String(dataLimitBytes / 1024n ** 3n)} گیگ`;
}

export function trialHomeButton(): InlineButton {
  return { text: MENU_LABEL.trial, callback_data: TRIAL_CALLBACK };
}

export function trialOfferText(input: {
  readonly durationDays: number;
  readonly dataLimitBytes: bigint;
  readonly deviceLimit: number;
}): string {
  const devices = input.deviceLimit === 0 ? 'نامحدود' : `${String(input.deviceLimit)} دستگاه`;
  return [
    '<b>سرویس تست</b>',
    'یک‌بار برای هر مشتری، بدون پرداخت کارت‌به‌کارت.',
    `مدت: <b>${String(input.durationDays)} روز</b> · حجم: <b>${escapeHtml(formatTrafficLabel(input.dataLimitBytes))}</b> · اتصال: <b>${escapeHtml(devices)}</b>`,
    'اگر قبلاً تست گرفته باشی همین دکمه دوباره سرویس جدید نمی‌سازد.',
  ].join('\n');
}

export function trialAlreadyClaimedText(): string {
  return [
    '<b>سرویس تست قبلاً استفاده شده</b>',
    'هر مشتری فقط یک تست دارد. برای ادامه از خرید یا تمدید استفاده کن.',
  ].join('\n');
}

export function trialUnavailableText(): string {
  return [
    '<b>سرویس تست الان فعال نیست</b>',
    'اگر لازم داری از خرید سریع پلن مناسب را انتخاب کن.',
  ].join('\n');
}

export function shopBlockedText(): string {
  return [
    '<b>خرید برای این حساب موقتاً بسته است</b>',
    'سرویس‌های فعلی و تیکت پشتیبانی همچنان در دسترس است.',
  ].join('\n');
}

export function forcedJoinText(reason: 'missing' | 'unavailable'): string {
  return reason === 'unavailable'
    ? [
        '<b>عضویت کانال الان قابل بررسی نیست</b>',
        'کمی بعد «بررسی مجدد» را بزن. اگر تکرار شد به پشتیبانی پیام بده.',
      ].join('\n')
    : [
        '<b>برای خرید یا تست باید عضو کانال فروشگاه باشی</b>',
        'اول عضو شو، بعد «بررسی مجدد» را بزن.',
      ].join('\n');
}

export function customerServicesText(
  services: readonly { readonly productName: string; readonly variantName: string }[],
): string {
  if (services.length === 0) {
    return ['<b>سرویس فعالی نداری</b>', 'از خرید سریع یا سرویس تست شروع کن.'].join('\n');
  }
  return [
    '<b>سرویس‌های من</b>',
    'لینک دسترسی را از همین‌جا دوباره بگیر. لینک را برای دیگران نفرست.',
    ...services.map(
      (service, index) =>
        `${String(index + 1)}. ${escapeWithin(service.productName, 80)} — ${escapeWithin(service.variantName, 80)}`,
    ),
  ].join('\n');
}

export function serviceAccessText(subscriptionUrl: string): string {
  return [
    '<b>لینک دسترسی</b>',
    `<code>${escapeHtml(subscriptionUrl)}</code>`,
    'این لینک را در کلاینت خودت وارد کن و برای دیگران نفرست.',
  ].join('\n');
}

export function platformGuideText(platform: 'ios' | 'android' | 'windows'): string {
  if (platform === 'ios') {
    return [
      '<b>اتصال آیفون</b>',
      '۱. Streisand یا V2Box را نصب کن.',
      '۲. لینک اشتراک را کپی و در برنامه وارد کن.',
      '۳. پروفایل را اضافه کن و اتصال را روشن کن.',
    ].join('\n');
  }
  if (platform === 'android') {
    return [
      '<b>اتصال اندروید</b>',
      '۱. v2rayNG یا Hiddify را نصب کن.',
      '۲. از منوی + لینک اشتراک را وارد کن.',
      '۳. پروفایل را انتخاب و دکمه اتصال را بزن.',
    ].join('\n');
  }
  return [
    '<b>اتصال ویندوز</b>',
    '۱. v2rayN یا Hiddify را نصب کن.',
    '۲. لینک اشتراک را از کلیپ‌بورد وارد کن.',
    '۳. سیستم‌پروکسی را روشن و اتصال را شروع کن.',
  ].join('\n');
}

export function commercialSettingsText(input: {
  readonly trialEnabled: boolean;
  readonly trialVariantId: string | null;
  readonly channelCount: number;
  readonly remindersEnabled: boolean;
  readonly expiryReminderDays: number;
  readonly lowTrafficPercent: number;
}): string {
  return [
    '<b>تنظیمات تجاری</b>',
    `تست رایگان: ${input.trialEnabled ? 'روشن' : 'خاموش'}`,
    `پلن تست: ${input.trialVariantId ?? 'تعیین نشده'}`,
    `کانال اجباری: ${String(input.channelCount)}`,
    `یادآوری: ${input.remindersEnabled ? 'روشن' : 'خاموش'} · ${String(input.expiryReminderDays)} روز مانده · حجم ${String(input.lowTrafficPercent)}٪`,
    'شناسه کانال یا پلن تست را از دکمه‌های زیر بفرست. توکن یا لینک اشتراک اینجا نیست.',
  ].join('\n');
}

export function broadcastPromptText(): string {
  return [
    '<b>پیام همگانی</b>',
    'متن را در یک پیام بفرست. ارسال صف می‌شود و قابل لغو است.',
    'متن کامل در گزارش‌های پایدار ذخیره نمی‌شود.',
  ].join('\n');
}

export function broadcastQueuedText(jobId: string, recipientCount: number): string {
  return [
    '<b>پیام همگانی در صف رفت</b>',
    `کار: ${escapeHtml(jobId)} · گیرنده: ${String(recipientCount)}`,
    'برای توقف، لغو همین کار را بزن.',
  ].join('\n');
}

export function reminderNoticeText(kind: 'expiry' | 'low_traffic', productName: string): string {
  return kind === 'expiry'
    ? [
        '<b>یادآوری پایان سرویس</b>',
        `سرویس ${escapeWithin(productName, 80)} به‌زودی تمام می‌شود. از تمدید ادامه بده.`,
      ].join('\n')
    : [
        '<b>حجم سرویس رو به اتمام است</b>',
        `حجم باقی‌مانده ${escapeWithin(productName, 80)} کم شده. تمدید یا خرید تازه را از منو بزن.`,
      ].join('\n');
}

function serializeInlineButton(button: InlineButton): TelegramInlineButton {
  if (button.url !== undefined) {
    return { text: buttonLabel(button.text), url: button.url };
  }
  if (button.callback_data === undefined) {
    throw new Error('INVALID_INLINE_BUTTON');
  }
  return { text: buttonLabel(button.text), callback_data: button.callback_data };
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
