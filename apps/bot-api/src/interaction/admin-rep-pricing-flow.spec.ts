import {
  InMemoryConversationSessionStore,
  RepresentativePricingUseCase,
} from '@neo-bot/application';
import { describe, expect, it, vi } from 'vitest';
import { AdminRepPricingFlowHandler } from './admin-rep-pricing-flow.js';

describe('AdminRepPricingFlowHandler', () => {
  it('durably grants access after representative and variant steps', async () => {
    const store = new InMemoryConversationSessionStore();
    const setAccess = vi.fn().mockResolvedValue(undefined);
    const pricing = new RepresentativePricingUseCase({
      listRepresentatives: vi.fn(),
      findRepresentativeById: vi
        .fn()
        .mockResolvedValue({ id: '8', code: 'rep-a', telegramUserId: 70001, active: true }),
      setRepresentativeVariantAccess: setAccess,
      setRepresentativeBasePrice: vi.fn(),
      clearRepresentativeBasePrice: vi.fn(),
      setRepresentativeOverridePrice: vi.fn(),
      clearRepresentativeOverridePrice: vi.fn(),
    });
    const handler = new AdminRepPricingFlowHandler(pricing);
    await AdminRepPricingFlowHandler.start(store, {
      telegramUserId: '70000',
      action: 'grant-access',
      now: new Date(),
    });
    const first = await store.getPending('70000');
    const next = await handler.handle(
      first!,
      { kind: 'text', updateId: '1', telegramUserId: '70000', text: '8' },
      new Date(),
    );
    expect(next.kind).toBe('continue');
    const complete = await handler.handle(
      next.kind === 'continue' ? next.session : first!,
      { kind: 'text', updateId: '2', telegramUserId: '70000', text: '12' },
      new Date(),
    );
    expect(complete).toMatchObject({ kind: 'complete', screen: { id: 'admin.rep-pricing.saved' } });
    expect(setAccess).toHaveBeenCalledWith({
      representativeId: '8',
      variantId: '12',
      active: true,
    });
  });

  it('rejects malformed base price input without writing', async () => {
    const store = new InMemoryConversationSessionStore();
    const setBasePrice = vi.fn().mockResolvedValue(undefined);
    const pricing = new RepresentativePricingUseCase({
      listRepresentatives: vi.fn(),
      findRepresentativeById: vi.fn(),
      setRepresentativeVariantAccess: vi.fn(),
      setRepresentativeBasePrice: setBasePrice,
      clearRepresentativeBasePrice: vi.fn(),
      setRepresentativeOverridePrice: vi.fn(),
      clearRepresentativeOverridePrice: vi.fn(),
    });
    const handler = new AdminRepPricingFlowHandler(pricing);
    await AdminRepPricingFlowHandler.start(store, {
      telegramUserId: '70000',
      action: 'set-base-price',
      now: new Date(),
    });
    const first = await store.getPending('70000');
    const next = await handler.handle(
      first!,
      { kind: 'text', updateId: '1', telegramUserId: '70000', text: '12' },
      new Date(),
    );
    const rejected = await handler.handle(
      next.kind === 'continue' ? next.session : first!,
      { kind: 'text', updateId: '2', telegramUserId: '70000', text: '۰' },
      new Date(),
    );
    expect(rejected).toMatchObject({ kind: 'reject', screen: { id: 'admin.rep-pricing.invalid' } });
    expect(setBasePrice).not.toHaveBeenCalled();
  });
});
