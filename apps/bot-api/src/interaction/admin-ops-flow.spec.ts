import { InMemoryConversationSessionStore } from '@neo-bot/application';
import { describe, expect, it, vi } from 'vitest';

import { AdminBroadcastFlowHandler } from './admin-ops-flow.js';

describe('admin broadcast flow', () => {
  it('queues a one-shot body and never writes it into the session payload', async () => {
    const store = new InMemoryConversationSessionStore();
    const queue = vi.fn().mockResolvedValue({ id: '44' });
    const handler = new AdminBroadcastFlowHandler(queue, {
      telegramUserId: '70001',
      privateChatId: '70001',
      displayName: 'ادمین',
    });
    const session = await AdminBroadcastFlowHandler.start(store, {
      telegramUserId: '70001',
      now: new Date('2026-09-05T00:00:00.000Z'),
    });
    expect(session.payload).toEqual({ mode: 'create' });
    const transition = await handler.handle(
      session,
      {
        kind: 'text',
        updateId: '1',
        telegramUserId: '70001',
        text: 'اعلام قطعی موقت',
      },
      new Date('2026-09-05T00:01:00.000Z'),
    );
    expect(transition).toMatchObject({
      kind: 'complete',
      screen: { id: 'admin.broadcast.queued', jobId: '44' },
    });
    expect(queue).toHaveBeenCalledWith({
      adminTelegramUserId: '70001',
      body: 'اعلام قطعی موقت',
    });
  });
});
