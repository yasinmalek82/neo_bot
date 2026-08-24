import { DomainConflictError } from '@neo-bot/domain';
import { ConflictException, GoneException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CustomerController } from './customer.controller.js';
import type { CustomerOrderService } from './customer-order.service.js';

describe('CustomerController', () => {
  it('keeps Mini App checkout and renew off the product path', () => {
    const controller = new CustomerController(null);
    expect(() => controller.createOrder()).toThrow(GoneException);
    expect(() => controller.renew()).toThrow(GoneException);
  });

  it('maps missing shop categories to a domain conflict code', async () => {
    const orders = {
      getShopCategory: vi.fn().mockRejectedValue(new DomainConflictError('CATEGORY_NOT_FOUND')),
    } as unknown as CustomerOrderService;
    const controller = new CustomerController(orders);
    await expect(controller.getShopCategory('init', '9')).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns only a boolean for the customer service probe', async () => {
    const orders = {
      hasActiveService: vi.fn().mockResolvedValue({ hasActiveService: false }),
    } as unknown as CustomerOrderService;
    const controller = new CustomerController(orders);
    await expect(controller.currentService('init')).resolves.toEqual({ hasActiveService: false });
  });
});
