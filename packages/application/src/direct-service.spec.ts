import {
  ProvisioningProviderError,
  type CreateProviderUser,
  type DirectProductVariant,
  type ProviderGroup,
  type ProviderHealth,
  type ProviderUser,
  type ProvisioningOperation,
  type ProvisioningOperationType,
  type ProvisioningProvider,
  type RenewProviderUser,
  type ServiceBinding,
} from '@neo-bot/domain';
import { describe, expect, it, vi } from 'vitest';

import { DirectServiceUseCase } from './direct-service.js';
import * as serviceUsername from './service-username.js';
import type { ProvisioningRepository, ReservedOperation } from './ports.js';

const fixedNow = new Date('2026-08-20T00:00:00.000Z');
const variant: DirectProductVariant = {
  id: 'variant-1',
  code: 'pilot-direct',
  name: 'Pilot direct',
  durationDays: 30,
  dataLimitBytes: 10_737_418_240n,
  deviceLimit: 1,
  providerInstanceId: 'provider-1',
  groupIds: [10],
  active: true,
};

describe('DirectServiceUseCase', () => {
  it('creates only one remote service when the same update is retried', async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    const useCase = new DirectServiceUseCase(repository, provider, () => fixedNow);

    const command = { productVariantId: variant.id, idempotencyKey: 'telegram-update-100' };
    const first = await useCase.create(command);
    const repeated = await useCase.create(command);

    expect(repeated).toEqual(first);
    expect(provider.createCalls).toBe(1);
    expect(first.targetUserId).toBe(101);
  });

  it('reconciles an ambiguous create timeout by username', async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    provider.failCreateAfterApplying = true;
    const useCase = new DirectServiceUseCase(repository, provider, () => fixedNow);

    const service = await useCase.create({
      productVariantId: variant.id,
      idempotencyKey: 'telegram-update-ambiguous',
    });

    expect(service.targetUserId).toBe(101);
    expect(provider.createCalls).toBe(1);
  });

  it('renews only once for a repeated idempotency key and uses the numeric remote id', async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    const useCase = new DirectServiceUseCase(repository, provider, () => fixedNow);
    const created = await useCase.create({
      productVariantId: variant.id,
      idempotencyKey: 'create-for-renew',
    });

    const command = { serviceId: created.id, idempotencyKey: 'renew-update-1' };
    const renewed = await useCase.renew(command);
    const repeated = await useCase.renew(command);

    expect(repeated).toEqual(renewed);
    expect(provider.renewCalls).toBe(1);
    expect(provider.lastRenewedUserId).toBe(101);
    expect(renewed.expiresAt?.toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });

  it('fails closed when a configured group is unavailable', async () => {
    const repository = new MemoryRepository();
    repository.groupsAvailable = false;
    const provider = new MemoryProvider();
    const useCase = new DirectServiceUseCase(repository, provider, () => fixedNow);

    await expect(
      useCase.create({ productVariantId: variant.id, idempotencyKey: 'invalid-group' }),
    ).rejects.toThrow('INVALID_PROVIDER_GROUP');
    expect(provider.createCalls).toBe(0);
  });

  it('does not convert a definitive provider rejection into a pending success', async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    provider.definitiveCreateFailure = true;
    const useCase = new DirectServiceUseCase(repository, provider, () => fixedNow);

    await expect(
      useCase.create({ productVariantId: variant.id, idempotencyKey: 'definitive-failure' }),
    ).rejects.toMatchObject({ code: 'PASARGUARD_HTTP_400', mayHaveApplied: false });
    expect(provider.createCalls).toBe(1);
  });

  it('retries suffix generation when the username base collides downstream', async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    provider.seedConflictingUsername('buyer_aaaa');
    vi.spyOn(serviceUsername, 'generateServiceUsernameSuffix')
      .mockReturnValueOnce('aaaa')
      .mockReturnValueOnce('bbbb');
    const useCase = new DirectServiceUseCase(repository, provider, () => fixedNow);

    const service = await useCase.create({
      productVariantId: variant.id,
      idempotencyKey: 'username-collision',
      serviceUsernameBase: 'buyer',
    });

    expect(service.targetUsername).toBe('buyer_bbbb');
    expect(provider.createCalls).toBe(1);
    vi.restoreAllMocks();
  });
});

class MemoryProvider implements ProvisioningProvider {
  public createCalls = 0;
  public renewCalls = 0;
  public lastRenewedUserId: number | null = null;
  public failCreateAfterApplying = false;
  public definitiveCreateFailure = false;
  private readonly users = new Map<number, ProviderUser>();

  public seedConflictingUsername(username: string): void {
    this.users.set(999, {
      id: 999,
      username,
      status: 'active',
      expiresAt: fixedNow,
      dataLimitBytes: 0n,
      usedTrafficBytes: 0n,
      groupIds: [99],
      subscriptionUrl: 'https://panel.example/sub/conflict',
    });
  }

  public async health(): Promise<ProviderHealth> {
    return { ok: true, checkedAt: fixedNow, latencyMs: 1 };
  }

  public async listGroups(): Promise<readonly ProviderGroup[]> {
    return [{ id: 10, name: 'Pilot', disabled: false, inboundTags: ['pilot'] }];
  }

  public async findUserByUsername(username: string): Promise<ProviderUser | null> {
    return [...this.users.values()].find((user) => user.username === username) ?? null;
  }

  public async getUserById(userId: number): Promise<ProviderUser | null> {
    return this.users.get(userId) ?? null;
  }

  public async createUser(input: CreateProviderUser): Promise<ProviderUser> {
    this.createCalls += 1;
    if (this.definitiveCreateFailure) {
      throw new ProvisioningProviderError('PASARGUARD_HTTP_400', false, false);
    }
    const user: ProviderUser = {
      id: 101,
      username: input.username,
      status: 'active',
      expiresAt: input.expiresAt,
      dataLimitBytes: input.dataLimitBytes,
      usedTrafficBytes: 0n,
      groupIds: input.groupIds,
      subscriptionUrl: 'https://panel.example/sub/pilot',
    };
    this.users.set(user.id, user);
    if (this.failCreateAfterApplying) {
      throw new ProvisioningProviderError('SIMULATED_TIMEOUT', true, true);
    }
    return user;
  }

  public async renewUser(input: RenewProviderUser): Promise<ProviderUser> {
    this.renewCalls += 1;
    this.lastRenewedUserId = input.userId;
    const current = this.users.get(input.userId);
    if (current === undefined) {
      throw new Error('REMOTE_USER_NOT_FOUND');
    }
    const updated = {
      ...current,
      expiresAt: input.expiresAt,
      dataLimitBytes: input.dataLimitBytes,
    };
    this.users.set(input.userId, updated);
    return updated;
  }
}

class MemoryRepository implements ProvisioningRepository {
  public groupsAvailable = true;
  private operationSequence = 0;
  private serviceSequence = 0;
  private readonly operations = new Map<string, ProvisioningOperation>();
  private readonly services = new Map<string, ServiceBinding>();

  public async getProductVariant(id: string): Promise<DirectProductVariant | null> {
    return id === variant.id ? variant : null;
  }

  public async groupsExist(): Promise<boolean> {
    return this.groupsAvailable;
  }

  public async replaceGroupSnapshots(): Promise<void> {}

  public async reserveOperation(
    type: ProvisioningOperationType,
    idempotencyKey: string,
    requestHash: string,
    serviceId?: string,
  ): Promise<ReservedOperation> {
    const key = `${type}:${idempotencyKey}`;
    const existing = this.operations.get(key);
    if (existing !== undefined) {
      return { outcome: 'existing', operation: existing };
    }
    const operation: ProvisioningOperation = {
      id: `operation-${++this.operationSequence}`,
      type,
      idempotencyKey,
      requestHash,
      status: 'pending',
      serviceId: serviceId ?? null,
      remoteUserId: null,
      errorCode: null,
    };
    this.operations.set(key, operation);
    return { outcome: 'reserved', operation };
  }

  public async completeCreate(
    operationId: string,
    productVariant: DirectProductVariant,
    remote: ProviderUser,
  ): Promise<ServiceBinding> {
    const existing = [...this.services.values()].find(
      (service) => service.targetUserId === remote.id,
    );
    const service =
      existing ??
      ({
        id: `service-${++this.serviceSequence}`,
        productVariantId: productVariant.id,
        providerInstanceId: productVariant.providerInstanceId,
        targetUserId: remote.id,
        targetUsername: remote.username,
        status: remote.status,
        expiresAt: remote.expiresAt,
        subscriptionUrl: remote.subscriptionUrl,
      } satisfies ServiceBinding);
    this.services.set(service.id, service);
    this.updateOperation(operationId, 'completed', service.id, remote.id, null);
    return service;
  }

  public async completeRenew(
    operationId: string,
    serviceId: string,
    remote: ProviderUser,
  ): Promise<ServiceBinding> {
    const current = this.services.get(serviceId);
    if (current === undefined) {
      throw new Error('SERVICE_NOT_FOUND');
    }
    const updated = {
      ...current,
      status: remote.status,
      expiresAt: remote.expiresAt,
      subscriptionUrl: remote.subscriptionUrl,
    };
    this.services.set(serviceId, updated);
    this.updateOperation(operationId, 'completed', serviceId, current.targetUserId, null);
    return updated;
  }

  public async markOperationFailed(operationId: string, errorCode: string): Promise<void> {
    this.updateOperation(operationId, 'failed', null, null, errorCode);
  }

  public async markOperationPending(operationId: string, errorCode: string): Promise<void> {
    this.updateOperation(operationId, 'pending', null, null, errorCode);
  }

  public async getService(id: string): Promise<ServiceBinding | null> {
    return this.services.get(id) ?? null;
  }

  private updateOperation(
    operationId: string,
    status: ProvisioningOperation['status'],
    serviceId: string | null,
    remoteUserId: number | null,
    errorCode: string | null,
  ): void {
    for (const [key, operation] of this.operations) {
      if (operation.id === operationId) {
        this.operations.set(key, { ...operation, status, serviceId, remoteUserId, errorCode });
        return;
      }
    }
    throw new Error('OPERATION_NOT_FOUND');
  }
}
