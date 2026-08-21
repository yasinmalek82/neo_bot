import { createHmac } from 'node:crypto';

import type { CatalogAdminUseCase, CommerceUseCase } from '@neo-bot/application';
import type { SalesOrder, StorefrontCatalog } from '@neo-bot/domain';
import { describe, expect, it, vi } from 'vitest';

import { CustomerOrderService } from './customer-order.service.js';

const botToken = '12345:abcdefghijklmnopqrstuvwxyz';

function signInitData(userId: number, firstName: string): string {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1_000)),
    user: JSON.stringify({ id: userId, first_name: firstName }),
  };
  const dataCheckString = Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

const order: SalesOrder = {
  id: '3',
  customerId: '1',
  productVariantId: '2',
  productName: 'اقتصادی',
  variantName: 'یک‌ماهه',
  amountIrr: 1_500_000n,
  status: 'awaiting_receipt',
  serviceId: null,
  failureCode: null,
  createdAt: new Date('2026-08-21T00:00:00.000Z'),
  updatedAt: new Date('2026-08-21T00:00:00.000Z'),
};

const catalog: StorefrontCatalog = {
  settings: {
    brandName: 'نئو',
    heroTitle: 'عنوان',
    heroSubtitle: '',
    deliveryNote: '',
    supportNote: '',
    volumeHelper: '',
    cardNumber: '0000000000000000',
    cardHolder: 'صاحب کارت',
  },
  products: [],
  updatedAt: new Date('2026-08-21T00:00:00.000Z'),
};

describe('CustomerOrderService', () => {
  it('creates an order from valid init data and hides card until checkout is open', async () => {
    const commerce = {
      beginCheckout: vi.fn().mockResolvedValue(order),
      recordCustomerActivity: vi.fn().mockResolvedValue({
        customer: {
          id: '1',
          telegramUserId: '10001',
          privateChatId: '10001',
          displayName: 'خریدار',
        },
        firstContact: false,
      }),
      getOpenOrderForCustomer: vi.fn().mockResolvedValue(order),
    } as unknown as CommerceUseCase;
    const catalogUseCase = {
      getPublicCatalog: vi.fn().mockResolvedValue(catalog),
    } as unknown as CatalogAdminUseCase;
    const service = new CustomerOrderService(commerce, catalogUseCase, botToken);

    await expect(
      service.createOrder(signInitData(10001, 'خریدار'), '2', undefined),
    ).resolves.toEqual({
      order,
      payment: { cardNumber: '0000000000000000', cardHolder: 'صاحب کارت' },
    });
    expect(commerce.beginCheckout).toHaveBeenCalledWith({
      customer: {
        telegramUserId: '10001',
        privateChatId: '10001',
        displayName: 'خریدار',
      },
      productVariantId: '2',
      idempotencyKey: 'telegram:miniapp:10001:2',
    });

    const current = await service.currentOrder(signInitData(10001, 'خریدار'));
    expect(current.payment).toEqual({
      cardNumber: '0000000000000000',
      cardHolder: 'صاحب کارت',
    });
  });

  it('rejects a second user from reading another customer order', async () => {
    const commerce = {
      recordCustomerActivity: vi.fn().mockResolvedValue({
        customer: { id: '9', telegramUserId: '20002', privateChatId: '20002', displayName: 'دیگر' },
        firstContact: false,
      }),
      getOpenOrderForCustomer: vi.fn().mockResolvedValue(null),
    } as unknown as CommerceUseCase;
    const service = new CustomerOrderService(
      commerce,
      { getPublicCatalog: vi.fn() } as unknown as CatalogAdminUseCase,
      botToken,
    );
    await expect(service.currentOrder(signInitData(20002, 'دیگر'))).resolves.toEqual({
      order: null,
      payment: null,
    });
    expect(commerce.getOpenOrderForCustomer).toHaveBeenCalledWith('9');
  });

  it('does not create an order when published card details are missing', async () => {
    const commerce = {
      beginCheckout: vi.fn(),
    } as unknown as CommerceUseCase;
    const service = new CustomerOrderService(
      commerce,
      {
        getPublicCatalog: vi.fn().mockResolvedValue({
          ...catalog,
          settings: { ...catalog.settings, cardNumber: '', cardHolder: '' },
        }),
      } as unknown as CatalogAdminUseCase,
      botToken,
    );
    await expect(
      service.createOrder(signInitData(10001, 'خریدار'), '2', undefined),
    ).rejects.toThrow('PAYMENT_DETAILS_MISSING');
    expect(commerce.beginCheckout).not.toHaveBeenCalled();
  });
});
