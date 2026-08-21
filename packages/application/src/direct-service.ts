import { createHash } from 'node:crypto';

import {
  DomainConflictError,
  ProvisioningPendingError,
  ProvisioningProviderError,
  validateDirectProductVariant,
  type DirectProductVariant,
  type ProviderUser,
  type ProvisioningProvider,
  type ServiceBinding,
} from '@neo-bot/domain';

import type { ProvisioningRepository } from './ports.js';

export interface CreateDirectServiceCommand {
  readonly productVariantId: string;
  readonly idempotencyKey: string;
  readonly requestedUsername?: string;
}

export interface RenewDirectServiceCommand {
  readonly serviceId: string;
  readonly idempotencyKey: string;
}

export class DirectServiceUseCase {
  public constructor(
    private readonly repository: ProvisioningRepository,
    private readonly provider: ProvisioningProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async syncGroups(providerInstanceId: string): Promise<void> {
    const groups = await this.provider.listGroups();
    await this.repository.replaceGroupSnapshots(providerInstanceId, groups, this.now());
  }

  public async create(command: CreateDirectServiceCommand): Promise<ServiceBinding> {
    const variant = await this.requiredVariant(command.productVariantId);
    const requestHash = stableHash({
      productVariantId: command.productVariantId,
      requestedUsername: command.requestedUsername ?? null,
    });
    const reserved = await this.repository.reserveOperation(
      'create',
      command.idempotencyKey,
      requestHash,
    );

    if (reserved.operation.requestHash !== requestHash) {
      throw new DomainConflictError('IDEMPOTENCY_KEY_REUSED');
    }
    if (reserved.operation.status === 'completed' && reserved.operation.serviceId !== null) {
      return this.requiredService(reserved.operation.serviceId);
    }
    if (reserved.operation.status === 'failed') {
      throw new DomainConflictError(reserved.operation.errorCode ?? 'OPERATION_FAILED');
    }

    const groupsExist = await this.repository.groupsExist(
      variant.providerInstanceId,
      variant.groupIds,
    );
    if (!groupsExist) {
      await this.repository.markOperationFailed(reserved.operation.id, 'INVALID_PROVIDER_GROUP');
      throw new DomainConflictError('INVALID_PROVIDER_GROUP');
    }

    const username = command.requestedUsername ?? deterministicUsername(command.idempotencyKey);
    if (reserved.outcome === 'existing') {
      const reconciled = await this.provider.findUserByUsername(username);
      if (reconciled === null) {
        throw new ProvisioningPendingError('CREATE_IN_PROGRESS');
      }
      assertUserMatchesVariant(reconciled, variant);
      return this.repository.completeCreate(reserved.operation.id, variant, reconciled);
    }

    let remote = await this.provider.findUserByUsername(username);
    if (remote !== null) {
      assertUserMatchesVariant(remote, variant);
    } else {
      try {
        remote = await this.provider.createUser({
          username,
          expiresAt: addDays(this.now(), variant.durationDays),
          dataLimitBytes: variant.dataLimitBytes,
          groupIds: variant.groupIds,
          deviceLimit: variant.deviceLimit,
          note: `neo_bot pilot; operation=${reserved.operation.id}`,
        });
      } catch (error: unknown) {
        if (!(error instanceof ProvisioningProviderError) || !error.mayHaveApplied) {
          await this.repository.markOperationFailed(
            reserved.operation.id,
            error instanceof ProvisioningProviderError ? error.code : 'CREATE_FAILED',
          );
          throw error;
        }
        remote = await this.provider.findUserByUsername(username).catch(() => null);
        if (remote === null) {
          await this.repository.markOperationPending(reserved.operation.id, 'CREATE_UNCONFIRMED');
          throw new ProvisioningPendingError('CREATE_UNCONFIRMED');
        }
        assertUserMatchesVariant(remote, variant);
      }
    }

    return this.repository.completeCreate(reserved.operation.id, variant, remote);
  }

  public async get(serviceId: string): Promise<{ binding: ServiceBinding; remote: ProviderUser }> {
    const binding = await this.requiredService(serviceId);
    const remote = await this.provider.getUserById(binding.targetUserId);
    if (remote === null) {
      throw new DomainConflictError('REMOTE_USER_NOT_FOUND');
    }
    return { binding, remote };
  }

  public async renew(command: RenewDirectServiceCommand): Promise<ServiceBinding> {
    const service = await this.requiredService(command.serviceId);
    const variant = await this.requiredVariant(service.productVariantId);
    const requestHash = stableHash({ serviceId: service.id, variantId: variant.id });
    const reserved = await this.repository.reserveOperation(
      'renew',
      command.idempotencyKey,
      requestHash,
      service.id,
    );

    if (reserved.operation.requestHash !== requestHash) {
      throw new DomainConflictError('IDEMPOTENCY_KEY_REUSED');
    }
    if (reserved.operation.status === 'completed') {
      return this.requiredService(service.id);
    }
    if (reserved.operation.status === 'failed') {
      throw new DomainConflictError(reserved.operation.errorCode ?? 'OPERATION_FAILED');
    }
    if (reserved.outcome === 'existing') {
      throw new ProvisioningPendingError('RENEW_IN_PROGRESS');
    }

    const current = await this.provider.getUserById(service.targetUserId);
    if (current === null) {
      await this.repository.markOperationFailed(reserved.operation.id, 'REMOTE_USER_NOT_FOUND');
      throw new DomainConflictError('REMOTE_USER_NOT_FOUND');
    }
    const now = this.now();
    const base = current.expiresAt !== null && current.expiresAt > now ? current.expiresAt : now;
    const desiredExpiry = addDays(base, variant.durationDays);

    let remote: ProviderUser;
    try {
      remote = await this.provider.renewUser({
        userId: current.id,
        expiresAt: desiredExpiry,
        dataLimitBytes: variant.dataLimitBytes,
      });
    } catch (error: unknown) {
      if (!(error instanceof ProvisioningProviderError) || !error.mayHaveApplied) {
        await this.repository.markOperationFailed(
          reserved.operation.id,
          error instanceof ProvisioningProviderError ? error.code : 'RENEW_FAILED',
        );
        throw error;
      }
      const reconciled = await this.provider.getUserById(current.id).catch(() => null);
      if (reconciled === null || !sameInstant(reconciled.expiresAt, desiredExpiry)) {
        await this.repository.markOperationPending(reserved.operation.id, 'RENEW_UNCONFIRMED');
        throw new ProvisioningPendingError('RENEW_UNCONFIRMED');
      }
      remote = reconciled;
    }

    return this.repository.completeRenew(reserved.operation.id, service.id, remote);
  }

  private async requiredVariant(id: string): Promise<DirectProductVariant> {
    const variant = await this.repository.getProductVariant(id);
    if (variant === null) {
      throw new DomainConflictError('PRODUCT_NOT_FOUND');
    }
    validateDirectProductVariant(variant);
    return variant;
  }

  private async requiredService(id: string): Promise<ServiceBinding> {
    const service = await this.repository.getService(id);
    if (service === null) {
      throw new DomainConflictError('SERVICE_NOT_FOUND');
    }
    return service;
  }
}

function deterministicUsername(key: string): string {
  return `neo_${createHash('sha256').update(key).digest('hex').slice(0, 20)}`;
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function assertUserMatchesVariant(user: ProviderUser, variant: DirectProductVariant): void {
  const actual = [...user.groupIds].sort((left, right) => left - right);
  const expected = [...variant.groupIds].sort((left, right) => left - right);
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new DomainConflictError('REMOTE_USER_GROUP_CONFLICT');
  }
}
