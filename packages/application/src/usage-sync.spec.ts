import { describe, expect, it, vi } from 'vitest';

import { UsageSyncUseCase } from './usage-sync.js';

describe('UsageSyncUseCase', () => {
  it('is a no-op when the PasarGuard reader is gated off', async () => {
    const persistServiceUsedTraffic = vi.fn();
    const useCase = new UsageSyncUseCase({
      listServicesDueForUsageSync: vi.fn(),
      persistServiceUsedTraffic,
      countDueUsageSync: vi.fn().mockResolvedValue(0),
    });
    await expect(useCase.syncDue()).resolves.toEqual({
      scanned: 0,
      updated: 0,
      missing: 0,
      failed: 0,
    });
    expect(persistServiceUsedTraffic).not.toHaveBeenCalled();
  });

  it('reads remote used traffic and persists only that local column', async () => {
    const persistServiceUsedTraffic = vi.fn().mockResolvedValue(true);
    const getUserById = vi.fn().mockResolvedValue({ usedTrafficBytes: 80n });
    const useCase = new UsageSyncUseCase(
      {
        listServicesDueForUsageSync: vi
          .fn()
          .mockResolvedValue([{ serviceId: '4', targetUserId: 6, usedTrafficBytes: null }]),
        persistServiceUsedTraffic,
        countDueUsageSync: vi.fn().mockResolvedValue(1),
      },
      { getUserById },
    );
    await expect(useCase.syncDue()).resolves.toEqual({
      scanned: 1,
      updated: 1,
      missing: 0,
      failed: 0,
    });
    expect(getUserById).toHaveBeenCalledWith(6);
    expect(persistServiceUsedTraffic).toHaveBeenCalledWith({
      serviceId: '4',
      targetUserId: 6,
      usedTrafficBytes: 80n,
      remoteFound: true,
    });
    const persisted = persistServiceUsedTraffic.mock.calls[0]?.[0] as
      | {
          readonly serviceId: string;
          readonly targetUserId: number;
          readonly usedTrafficBytes: bigint;
          readonly remoteFound: boolean;
        }
      | undefined;
    expect(persisted).toEqual({
      serviceId: '4',
      targetUserId: 6,
      usedTrafficBytes: 80n,
      remoteFound: true,
    });
    expect(persisted).not.toHaveProperty('expiresAt');
    expect(persisted).not.toHaveProperty('groupIds');
    expect(persisted).not.toHaveProperty('subscriptionUrl');
  });

  it('marks a missing remote user synced without inventing usage', async () => {
    const persistServiceUsedTraffic = vi.fn().mockResolvedValue(true);
    const useCase = new UsageSyncUseCase(
      {
        listServicesDueForUsageSync: vi
          .fn()
          .mockResolvedValue([{ serviceId: '4', targetUserId: 6, usedTrafficBytes: 10n }]),
        persistServiceUsedTraffic,
        countDueUsageSync: vi.fn().mockResolvedValue(0),
      },
      { getUserById: vi.fn().mockResolvedValue(null) },
    );
    await expect(useCase.syncDue()).resolves.toEqual({
      scanned: 1,
      updated: 0,
      missing: 1,
      failed: 0,
    });
    expect(persistServiceUsedTraffic).toHaveBeenCalledWith({
      serviceId: '4',
      targetUserId: 6,
      usedTrafficBytes: null,
      remoteFound: false,
    });
  });

  it('continues the batch when one remote read fails', async () => {
    const persistServiceUsedTraffic = vi.fn().mockResolvedValue(true);
    const getUserById = vi
      .fn()
      .mockRejectedValueOnce(new Error('PASARGUARD_HTTP_500'))
      .mockResolvedValueOnce({ usedTrafficBytes: 12n });
    const useCase = new UsageSyncUseCase(
      {
        listServicesDueForUsageSync: vi.fn().mockResolvedValue([
          { serviceId: '4', targetUserId: 6, usedTrafficBytes: null },
          { serviceId: '5', targetUserId: 7, usedTrafficBytes: null },
        ]),
        persistServiceUsedTraffic,
        countDueUsageSync: vi.fn().mockResolvedValue(0),
      },
      { getUserById },
    );
    await expect(useCase.syncDue()).resolves.toEqual({
      scanned: 2,
      updated: 1,
      missing: 0,
      failed: 1,
    });
    expect(persistServiceUsedTraffic).toHaveBeenCalledTimes(1);
  });
});
