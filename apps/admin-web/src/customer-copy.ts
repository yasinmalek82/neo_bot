export type HomeTabId = 'shop' | 'orders' | 'renew' | 'help';

export const HOME_TABS: readonly { readonly id: HomeTabId; readonly label: string }[] = [
  { id: 'shop', label: 'خرید سرویس' },
  { id: 'orders', label: 'پیگیری سفارش' },
  { id: 'renew', label: 'تمدید سرویس' },
  { id: 'help', label: 'راهنما' },
];

export function emptyShopCopy(hint: 'admin' | 'customer'): { title: string; body: string } {
  if (hint === 'admin') {
    return {
      title: 'فروشگاه خالی است',
      body: 'از کنسول کاتالوگ دسته و پلن را ذخیره و منتشر کن. بعد از انتشار، همین فروشگاه به روز می شود.',
    };
  }
  return {
    title: 'فروشگاه خالی است',
    body: 'هنوز پلنی برای فروش منتشر نشده. از چت ربات «خرید سرویس» را بعدا دوباره بزن.',
  };
}

export function shopUnavailableCopy(kind: 'telegram' | 'failed'): {
  title: string;
  body: string;
} {
  if (kind === 'telegram') {
    return {
      title: 'خرید در چت ربات است',
      body: 'این صفحه فروشگاه نیست. چت ربات را باز کن، «خرید سرویس» را بزن، و عکس فیش را همان جا بفرست.',
    };
  }
  return {
    title: 'فروشگاه نیامد',
    body: 'لیست پلن ها الان نرسید. راهنما هنوز اینجاست. کمی بعد از زبانه خرید دوباره بزن.',
  };
}

export function helpSteps(): readonly string[] {
  return [
    'در چت ربات «خرید سرویس» را بزن، دسته و پلن را انتخاب کن.',
    'همان مبلغی که می بینی را کارت به کارت کن. عدد را گرد نکن.',
    'عکس رسید را در همین چت خصوصی بفرست. PDF و ویدیو قبول نیست.',
    'تایید و لینک سرویس همان جا می آید.',
  ];
}

export function customerOrderStatusLabel(status: string): string {
  switch (status) {
    case 'awaiting_receipt':
      return 'منتظر عکس رسید';
    case 'receipt_submitted':
      return 'رسید در حال بررسی';
    case 'rejected':
      return 'رسید تایید نشد؛ عکس واضح تر را در ربات بفرست';
    case 'provisioning':
      return 'در حال آماده سازی سرویس';
    case 'provisioning_failed':
      return 'آماده سازی ناتمام؛ پشتیبانی در حال بررسی است';
    case 'fulfilled':
      return 'سرویس آماده است؛ لینک در چت ربات';
    case 'cancelled':
      return 'سفارش لغو شد';
    default:
      return 'وضعیت سفارش به روز شد';
  }
}

export function checkoutErrorCopy(code: string): string {
  switch (code) {
    case 'INIT_DATA_REQUIRED':
    case 'INIT_DATA_INVALID':
    case 'INIT_DATA_EXPIRED':
      return 'خرید و تمدید را در چت ربات انجام بده. این صفحه فروشگاه نیست.';
    case 'CHAT_CHECKOUT_REQUIRED':
      return 'خرید و تمدید فقط در چت ربات است. این صفحه را ببند و از دکمه های همان گفتگو ادامه بده.';
    case 'PAYMENT_DETAILS_MISSING':
      return 'شماره کارت هنوز منتشر نشده. الان پرداخت نکن.';
    case 'OPEN_ORDER_UNDER_REVIEW':
      return 'یک سفارش در حال بررسی داری. اول نتیجه همان را ببین.';
    case 'PRODUCT_VARIANT_NOT_SELLABLE':
      return 'این پلن دیگر قابل خرید نیست.';
    case 'NO_ACTIVE_SERVICE':
      return 'سرویس فعالی برای تمدید پیدا نشد. اول یک سرویس بخر.';
    default:
      return 'الان انجام نشد. کمی بعد دوباره تلاش کن.';
  }
}
