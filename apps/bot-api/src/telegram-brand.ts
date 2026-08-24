const NEO_NETWORK_BRAND = {
  name: 'NEO NETWORK',
  accessLabel: 'PRIVATE ACCESS',
  monogram: 'NN',
} as const;

export function brandWelcomeCaption(): string {
  return [
    `<b>${NEO_NETWORK_BRAND.name}</b>`,
    `<i>${NEO_NETWORK_BRAND.accessLabel}</i>`,
    '',
    'خرید سریع و پیگیری سفارش، در همین گفتگو.',
  ].join('\n');
}

export function brandDeliveryCaption(): string {
  return [
    `<b>${NEO_NETWORK_BRAND.name}</b>`,
    `<i>${NEO_NETWORK_BRAND.accessLabel}</i>`,
    '',
    'سرویس آماده است؛ اطلاعات دسترسی در پیام بعدی می‌آید.',
  ].join('\n');
}
