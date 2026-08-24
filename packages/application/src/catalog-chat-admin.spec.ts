import { describe, expect, it } from 'vitest';

import { CatalogChatAdminUseCase, type CatalogChatAdminRepository } from './catalog-chat-admin.js';

describe('CatalogChatAdminUseCase', () => {
  it('creates a 24-hour session pinned to the current revision', async () => {
    const sessions: unknown[] = [];
    const repository: CatalogChatAdminRepository = {
      getCatalogRevision: async () => 7,
      listAdminCategories: async () => [],
      getCatalogAdminReadModel: async () => ({ categories: [], products: [], variants: [] }),
      createCatalogAdminSession: async (session) => void sessions.push(session),
      getCatalogAdminSession: async () => null,
      getPendingCatalogAdminSession: async () => null,
      updateCatalogAdminSession: async () => {
        throw new Error('not used');
      },
      cancelCatalogAdminSession: async () => undefined,
      publishCatalogAdminSession: async () => ({
        revision: 8,
        delta: { kind: 'archive', entity: 'product', code: 'alpha' },
      }),
    };
    const now = new Date('2026-08-22T10:00:00.000Z');
    const session = await new CatalogChatAdminUseCase(repository).startSession({
      id: 'e4e89d8d-6aa8-4b8f-a6c3-7442a8c0db8b',
      adminTelegramUserId: '42',
      now,
    });
    expect(session.baseRevision).toBe(7);
    expect(session.expiresAt.toISOString()).toBe('2026-08-23T10:00:00.000Z');
    expect(sessions).toHaveLength(1);
  });
});
