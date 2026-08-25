import { createHash } from 'node:crypto';

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
import { ProvisioningModeGate } from './provisioning-mutation-gate.js';
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

const liveMutationGate = new ProvisioningModeGate({ mode: 'live', isolatedGroupId: null });

describe('DirectServiceUseCase', () => {
  it('creates only one remote service when the same update is retried', async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    const useCase = new DirectServiceUseCase(
      repository,
      provider,
      () => fixedNow,
      liveMutationGate,
    );

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
    const useCase = new DirectServiceUseCase(
      repository,
      provider,
      () => fixedNow,
      liveMutationGate,
    );

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
    const useCase = new DirectServiceUseCase(
      repository,
      provider,
      () => fixedNow,
      liveMutationGate,
    );
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
    const useCase = new DirectServiceUseCase(
      repository,
      provider,
      () => fixedNow,
      liveMutationGate,
    );

    await expect(
      useCase.create({ productVariantId: variant.id, idempotencyKey: 'invalid-group' }),
    ).rejects.toThrow('INVALID_PROVIDER_GROUP');
    expect(provider.createCalls).toBe(0);
  });

  it('does not convert a definitive provider rejection into a pending success', async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    provider.definitiveCreateFailure = true;
    const useCase = new DirectServiceUseCase(
      repository,
      provider,
      () => fixedNow,
      liveMutationGate,
    );

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
    const useCase = new DirectServiceUseCase(
      repository,
      provider,
      () => fixedNow,
      liveMutationGate,
    );

    const service = await useCase.create({
      productVariantId: variant.id,
      idempotencyKey: 'username-collision',
      serviceUsernameBase: 'buyer',
    });

    expect(service.targetUsername).toBe('buyer_bbbb');
    expect(repository.operationFor('create:username-collision').candidateUsername).toBe(
      'buyer_bbbb',
    );
    expect(provider.createCalls).toBe(1);
    vi.restoreAllMocks();
  });

  it('does not bind an unrelated pre-send username collision that otherwise matches the variant', async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    provider.seedPotentiallyMatchingUsername('buyer_aaaa');
    vi.spyOn(serviceUsername, 'generateServiceUsernameSuffix')
      .mockReturnValueOnce('aaaa')
      .mockReturnValueOnce('bbbb');
    const useCase = new DirectServiceUseCase(
      repository,
      provider,
      () => fixedNow,
      liveMutationGate,
    );

    await expect(
      useCase.create({
        productVariantId: variant.id,
        idempotencyKey: 'unrelated-pre-send-collision',
        serviceUsernameBase: 'buyer',
      }),
    ).resolves.toMatchObject({ targetUsername: 'buyer_bbbb' });
    expect(repository.operationFor('create:unrelated-pre-send-collision').candidateUsername).toBe(
      'buyer_bbbb',
    );
    expect(provider.createCalls).toBe(1);
    vi.restoreAllMocks();
  });

  it('keeps a crash after create intent and before transport in reconciliation without binding a collision', async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    const command = {
      productVariantId: variant.id,
      idempotencyKey: 'crash-before-create-transport',
      requestedUsername: 'buyer_aaaa',
    };
    provider.seedPotentiallyMatchingUsername(command.requestedUsername);
    const operation = await repository.reserveOperation(
      'create',
      command.idempotencyKey,
      createHash('sha256')
        .update(
          JSON.stringify({
            productVariantId: command.productVariantId,
            requestedUsername: command.requestedUsername,
            serviceUsernameBase: null,
          }),
        )
        .digest('hex'),
    );
    await repository.persistCreateCandidate(
      operation.operation.id,
      command.requestedUsername,
      new Date('2026-09-19T00:00:00.000Z'),
      variant.dataLimitBytes,
      'active',
    );
    await repository.beginCreateAttempt(operation.operation.id);
    const useCase = new DirectServiceUseCase(
      repository,
      provider,
      () => fixedNow,
      liveMutationGate,
    );

    await expect(useCase.create(command)).rejects.toMatchObject({
      code: 'CREATE_RECONCILIATION_REQUIRED',
    });
    expect(provider.createCalls).toBe(0);
    expect(repository.operationFor('create:crash-before-create-transport')).toMatchObject({
      reconciliationState: 'reconciliation_required',
      serviceId: null,
    });
  });

  it('persists a new candidate after a restart before the first mutation attempt', async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    const useCase = new DirectServiceUseCase(
      repository,
      provider,
      () => fixedNow,
      liveMutationGate,
    );
    const command = {
      productVariantId: variant.id,
      idempotencyKey: 'restart-before-candidate',
      serviceUsernameBase: 'buyer',
    };
    await repository.reserveOperation(
      'create',
      command.idempotencyKey,
      createHash('sha256')
        .update(
          JSON.stringify({
            productVariantId: command.productVariantId,
            requestedUsername: null,
            serviceUsernameBase: command.serviceUsernameBase,
          }),
        )
        .digest('hex'),
    );

    await expect(useCase.create(command)).resolves.toMatchObject({
      targetUsername: expect.stringMatching(/^buyer_[a-z0-9]{4}$/u),
    });
    expect(repository.operationFor('create:restart-before-candidate')).toMatchObject({
      attemptCount: 1,
      reconciliationState: 'reconciled',
    });
    expect(provider.createCalls).toBe(1);
  });

  it('uses the candidate returned by the atomic create attempt for the remote mutation', async () => {
    const repository = new MemoryRepository();
    repository.candidateReturnedAtBegin = 'buyer_bbbb';
    const provider = new MemoryProvider();
    const useCase = new DirectServiceUseCase(
      repository,
      provider,
      () => fixedNow,
      liveMutationGate,
    );

    await expect(
      useCase.create({
        productVariantId: variant.id,
        idempotencyKey: 'atomic-candidate-source',
        requestedUsername: 'buyer_aaaa',
      }),
    ).resolves.toMatchObject({ targetUsername: 'buyer_bbbb' });
    expect(provider.lastCreatedUsername).toBe('buyer_bbbb');
  });

  it('reconciles a restart after remote create before local completion without a second create', async () => {
    const repository = new MemoryRepository();
    repository.failNextCompleteCreate = true;
    const provider = new MemoryProvider();
    const useCase = new DirectServiceUseCase(
      repository,
      provider,
      () => fixedNow,
      liveMutationGate,
    );
    const command = {
      productVariantId: variant.id,
      idempotencyKey: 'crash-after-remote-create',
      serviceUsernameBase: 'buyer',
    };

    await expect(useCase.create(command)).rejects.toThrow('SIMULATED_CRASH_AFTER_CREATE');
    const operation = repository.operationFor('create:crash-after-remote-create');
    expect(operation.candidateUsername).toMatch(/^buyer_[a-z0-9]{4}$/u);
    expect(operation.reconciliationState).toBe('attempting');

    await expect(useCase.create(command)).resolves.toMatchObject({
      targetUsername: operation.candidateUsername,
    });
    expect(provider.createCalls).toBe(1);
  });

  it('reconciles a restart after remote renewal only when every persisted postcondition matches', async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    const useCase = new DirectServiceUseCase(
      repository,
      provider,
      () => fixedNow,
      liveMutationGate,
    );
    const created = await useCase.create({
      productVariantId: variant.id,
      idempotencyKey: 'create-before-renew-crash',
    });
    repository.failNextCompleteRenew = true;
    const command = { serviceId: created.id, idempotencyKey: 'crash-after-remote-renew' };

    await expect(useCase.renew(command)).rejects.toThrow('SIMULATED_CRASH_AFTER_RENEW');
    await expect(useCase.renew(command)).resolves.toMatchObject({ id: created.id });
    expect(provider.renewCalls).toBe(1);
  });

  it('defaults to disabled mode and allows isolated mutations only for the configured group', async () => {
    const disabledRepository = new MemoryRepository();
    const disabledProvider = new MemoryProvider();
    const disabled = new DirectServiceUseCase(disabledRepository, disabledProvider, () => fixedNow);
    await expect(
      disabled.create({ productVariantId: variant.id, idempotencyKey: 'disabled-create' }),
    ).rejects.toThrow('PROVISIONING_DISABLED');
    expect(disabledProvider.createCalls).toBe(0);

    const isolatedRepository = new MemoryRepository();
    const isolatedProvider = new MemoryProvider();
    const isolated = new DirectServiceUseCase(
      isolatedRepository,
      isolatedProvider,
      () => fixedNow,
      new ProvisioningModeGate({ mode: 'isolated', isolatedGroupId: 11 }),
    );
    await expect(
      isolated.create({ productVariantId: variant.id, idempotencyKey: 'wrong-isolated-group' }),
    ).rejects.toThrow('PROVISIONING_GROUP_NOT_ISOLATED');
    expect(isolatedProvider.createCalls).toBe(0);
  });

  it('keeps a renewal in reconciliation when a remote postcondition is incomplete', async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    provider.renewWithWrongDataLimit = true;
    const useCase = new DirectServiceUseCase(
      repository,
      provider,
      () => fixedNow,
      liveMutationGate,
    );
    const created = await useCase.create({
      productVariantId: variant.id,
      idempotencyKey: 'create-before-incomplete-renew',
    });
    repository.currentVariant = {
      ...variant,
      dataLimitBytes: 20n * 1024n ** 3n,
    };
    const command = { serviceId: created.id, idempotencyKey: 'incomplete-renew' };

    await expect(useCase.renew(command)).rejects.toMatchObject({
      code: 'RENEW_RECONCILIATION_REQUIRED',
    });
    await expect(useCase.renew(command)).rejects.toMatchObject({
      code: 'RENEW_RECONCILIATION_REQUIRED',
    });
    expect(provider.renewCalls).toBe(1);
    expect(repository.operationFor('renew:incomplete-renew').reconciliationState).toBe(
      'reconciliation_required',
    );
  });
});

class MemoryProvider implements ProvisioningProvider {
  public createCalls = 0;
  public lastCreatedUsername: string | null = null;
  public renewCalls = 0;
  public lastRenewedUserId: number | null = null;
  public failCreateAfterApplying = false;
  public definitiveCreateFailure = false;
  public renewWithWrongDataLimit = false;
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

  public seedPotentiallyMatchingUsername(username: string): void {
    this.users.set(998, {
      id: 998,
      username,
      status: 'active',
      expiresAt: new Date('2026-09-19T00:00:00.000Z'),
      dataLimitBytes: variant.dataLimitBytes,
      usedTrafficBytes: 0n,
      groupIds: variant.groupIds,
      subscriptionUrl: 'https://panel.example/sub/unrelated',
      provisioningNote: null,
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
    this.lastCreatedUsername = input.username;
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
      provisioningNote: input.note,
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
      dataLimitBytes: this.renewWithWrongDataLimit ? current.dataLimitBytes : input.dataLimitBytes,
    };
    this.users.set(input.userId, updated);
    return updated;
  }
}

class MemoryRepository implements ProvisioningRepository {
  public groupsAvailable = true;
  public currentVariant: DirectProductVariant = variant;
  public failNextCompleteCreate = false;
  public failNextCompleteRenew = false;
  public candidateReturnedAtBegin: string | null = null;
  private operationSequence = 0;
  private serviceSequence = 0;
  private readonly operations = new Map<string, ProvisioningOperation>();
  private readonly services = new Map<string, ServiceBinding>();

  public async getProductVariant(id: string): Promise<DirectProductVariant | null> {
    return id === this.currentVariant.id ? this.currentVariant : null;
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
      candidateUsername: null,
      attemptCount: 0,
      reconciliationState: 'not_required',
      requestedExpiresAt: null,
      requestedDataLimitBytes: null,
      requestedStatus: null,
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
    if (this.failNextCompleteCreate) {
      this.failNextCompleteCreate = false;
      throw new Error('SIMULATED_CRASH_AFTER_CREATE');
    }
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
    this.updateOperation(operationId, 'completed', service.id, remote.id, null, 'reconciled');
    return service;
  }

  public async completeRenew(
    operationId: string,
    serviceId: string,
    remote: ProviderUser,
  ): Promise<ServiceBinding> {
    if (this.failNextCompleteRenew) {
      this.failNextCompleteRenew = false;
      throw new Error('SIMULATED_CRASH_AFTER_RENEW');
    }
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
    this.updateOperation(
      operationId,
      'completed',
      serviceId,
      current.targetUserId,
      null,
      'reconciled',
    );
    return updated;
  }

  public async persistCreateCandidate(
    operationId: string,
    username: string,
    requestedExpiresAt: Date,
    requestedDataLimitBytes: bigint,
    requestedStatus: ServiceBinding['status'],
  ): Promise<ProvisioningOperation> {
    const operation = this.operationById(operationId);
    if (
      operation.candidateUsername !== null ||
      operation.attemptCount !== 0 ||
      operation.reconciliationState !== 'not_required'
    ) {
      return operation;
    }
    return this.replaceOperation(operationId, {
      candidateUsername: username,
      reconciliationState: 'candidate_persisted',
      requestedExpiresAt,
      requestedDataLimitBytes,
      requestedStatus,
      errorCode: null,
    });
  }

  public async replaceCreateCandidateAfterCollision(
    operationId: string,
    expectedUsername: string,
    username: string,
  ): Promise<ProvisioningOperation> {
    const operation = this.operationById(operationId);
    if (
      operation.candidateUsername !== expectedUsername ||
      (operation.reconciliationState !== 'candidate_persisted' &&
        operation.reconciliationState !== 'attempting')
    ) {
      return operation;
    }
    return this.replaceOperation(operationId, {
      candidateUsername: username,
      reconciliationState: 'candidate_persisted',
      errorCode: null,
    });
  }

  public async beginCreateAttempt(operationId: string): Promise<ReservedOperation> {
    const operation = this.operationById(operationId);
    if (operation.reconciliationState !== 'candidate_persisted') {
      return { outcome: 'existing', operation };
    }
    const candidateUsername = this.candidateReturnedAtBegin ?? operation.candidateUsername;
    return {
      outcome: 'reserved',
      operation: this.replaceOperation(operationId, {
        candidateUsername,
        attemptCount: operation.attemptCount + 1,
        reconciliationState: 'attempting',
        errorCode: null,
      }),
    };
  }

  public async beginRenewAttempt(
    operationId: string,
    requestedExpiresAt: Date,
    requestedDataLimitBytes: bigint,
    requestedStatus: ServiceBinding['status'],
  ): Promise<ReservedOperation> {
    const operation = this.operationById(operationId);
    if (operation.reconciliationState !== 'not_required') {
      return { outcome: 'existing', operation };
    }
    return {
      outcome: 'reserved',
      operation: this.replaceOperation(operationId, {
        attemptCount: operation.attemptCount + 1,
        reconciliationState: 'attempting',
        requestedExpiresAt,
        requestedDataLimitBytes,
        requestedStatus,
        errorCode: null,
      }),
    };
  }

  public async markOperationFailed(operationId: string, errorCode: string): Promise<void> {
    this.updateOperation(operationId, 'failed', null, null, errorCode, 'not_required');
  }

  public async markOperationPending(operationId: string, errorCode: string): Promise<void> {
    this.updateOperation(operationId, 'pending', null, null, errorCode, 'reconciliation_required');
  }

  public async getService(id: string): Promise<ServiceBinding | null> {
    return this.services.get(id) ?? null;
  }

  public operationFor(key: string): ProvisioningOperation {
    const operation = this.operations.get(key);
    if (operation === undefined) throw new Error('OPERATION_NOT_FOUND');
    return operation;
  }

  private updateOperation(
    operationId: string,
    status: ProvisioningOperation['status'],
    serviceId: string | null,
    remoteUserId: number | null,
    errorCode: string | null,
    reconciliationState?: ProvisioningOperation['reconciliationState'],
  ): void {
    this.replaceOperation(operationId, {
      status,
      serviceId,
      remoteUserId,
      errorCode,
      ...(reconciliationState === undefined ? {} : { reconciliationState }),
    });
  }

  private operationById(operationId: string): ProvisioningOperation {
    const operation = [...this.operations.values()].find(
      (candidate) => candidate.id === operationId,
    );
    if (operation === undefined) throw new Error('OPERATION_NOT_FOUND');
    return operation;
  }

  private replaceOperation(
    operationId: string,
    updates: Partial<ProvisioningOperation>,
  ): ProvisioningOperation {
    for (const [key, operation] of this.operations) {
      if (operation.id === operationId) {
        const updated = { ...operation, ...updates };
        this.operations.set(key, updated);
        return updated;
      }
    }
    throw new Error('OPERATION_NOT_FOUND');
  }
}
