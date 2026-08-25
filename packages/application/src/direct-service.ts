import { createHash } from 'node:crypto';

import {
  DomainConflictError,
  ProvisioningPendingError,
  ProvisioningProviderError,
  validateDirectProductVariant,
  composeServiceUsername,
  isServiceUsernameUnavailableError,
  MAX_SERVICE_USERNAME_SUFFIX_ATTEMPTS,
  validateServiceUsernameBase,
  type DirectProductVariant,
  type ProviderUser,
  type ProvisioningProvider,
  type ServiceBinding,
} from '@neo-bot/domain';

import type { ProvisioningRepository, ReservedOperation } from './ports.js';
import {
  ProvisioningModeGate,
  type ProvisioningMutationGate,
} from './provisioning-mutation-gate.js';
import { generateServiceUsernameSuffix } from './service-username.js';

export interface CreateDirectServiceCommand {
  readonly productVariantId: string;
  readonly idempotencyKey: string;
  readonly requestedUsername?: string;
  readonly serviceUsernameBase?: string;
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
    private readonly mutationGate: ProvisioningMutationGate = disabledMutationGate,
  ) {}

  public async syncGroups(providerInstanceId: string): Promise<void> {
    const groups = await this.provider.listGroups();
    await this.repository.replaceGroupSnapshots(providerInstanceId, groups, this.now());
  }

  public async create(command: CreateDirectServiceCommand): Promise<ServiceBinding> {
    if (command.requestedUsername !== undefined && command.serviceUsernameBase !== undefined) {
      throw new DomainConflictError('SERVICE_USERNAME_INPUT_CONFLICT');
    }
    if (command.serviceUsernameBase !== undefined) {
      validateServiceUsernameBase(command.serviceUsernameBase);
    }

    const variant = await this.requiredVariant(command.productVariantId);
    const requestHash = stableHash({
      productVariantId: command.productVariantId,
      requestedUsername: command.requestedUsername ?? null,
      serviceUsernameBase: command.serviceUsernameBase ?? null,
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

    if (
      reserved.operation.reconciliationState === 'attempting' ||
      reserved.operation.reconciliationState === 'reconciliation_required'
    ) {
      return this.reconcileCreate(reserved.operation, variant);
    }

    let operation = reserved.operation;
    if (operation.candidateUsername === null) {
      if (
        reserved.outcome === 'existing' &&
        (operation.attemptCount > 0 || operation.reconciliationState !== 'not_required')
      ) {
        await this.repository.markOperationPending(operation.id, 'CREATE_CANDIDATE_MISSING');
        throw new ProvisioningPendingError('CREATE_RECONCILIATION_REQUIRED');
      }
      operation = await this.repository.persistCreateCandidate(
        operation.id,
        initialUsername(command),
        addDays(this.now(), variant.durationDays),
        variant.dataLimitBytes,
        'active',
      );
    }
    return this.createWithPersistedCandidate(operation, variant, command);
  }

  private async createWithPersistedCandidate(
    initialOperation: ReservedOperation['operation'],
    variant: DirectProductVariant,
    command: CreateDirectServiceCommand,
  ): Promise<ServiceBinding> {
    let operation = initialOperation;
    for (
      let collisionCount = 0;
      collisionCount < MAX_SERVICE_USERNAME_SUFFIX_ATTEMPTS;
      collisionCount += 1
    ) {
      const username = operation.candidateUsername;
      if (username === null) {
        await this.repository.markOperationPending(operation.id, 'CREATE_CANDIDATE_MISSING');
        throw new ProvisioningPendingError('CREATE_RECONCILIATION_REQUIRED');
      }
      const requestedExpiresAt = operation.requestedExpiresAt;
      const requestedDataLimitBytes = operation.requestedDataLimitBytes;
      if (requestedExpiresAt === null || requestedDataLimitBytes === null) {
        await this.repository.markOperationPending(operation.id, 'CREATE_INTENT_MISSING');
        throw new ProvisioningPendingError('CREATE_RECONCILIATION_REQUIRED');
      }
      const remote = await this.provider.findUserByUsername(username);
      if (remote !== null) {
        if (createPostconditionsMatch(remote, variant, operation)) {
          return this.repository.completeCreate(operation.id, variant, remote);
        }
        if (operation.attemptCount > 0) {
          await this.repository.markOperationPending(
            operation.id,
            'CREATE_REMOTE_POSTCONDITION_FAILED',
          );
          throw new ProvisioningPendingError('CREATE_RECONCILIATION_REQUIRED');
        }
        operation = await this.replaceCandidateAfterProvenCollision(
          operation,
          command,
          collisionCount,
        );
        continue;
      }

      this.mutationGate.assertMutationAllowed(variant);
      const started = await this.repository.beginCreateAttempt(operation.id);
      if (started.outcome === 'existing') {
        return this.reconcileCreate(started.operation, variant);
      }
      operation = started.operation;
      const startedUsername = operation.candidateUsername;
      const startedExpiresAt = operation.requestedExpiresAt;
      const startedDataLimitBytes = operation.requestedDataLimitBytes;
      if (
        startedUsername === null ||
        startedExpiresAt === null ||
        startedDataLimitBytes === null ||
        operation.requestedStatus === null
      ) {
        await this.repository.markOperationPending(operation.id, 'CREATE_INTENT_MISSING');
        throw new ProvisioningPendingError('CREATE_RECONCILIATION_REQUIRED');
      }
      let created: ProviderUser;
      try {
        created = await this.provider.createUser({
          username: startedUsername,
          expiresAt: startedExpiresAt,
          dataLimitBytes: startedDataLimitBytes,
          groupIds: variant.groupIds,
          deviceLimit: variant.deviceLimit,
          note: createOperationNote(operation.id),
        });
      } catch (error: unknown) {
        if (isServiceUsernameUnavailableError(error)) {
          operation = await this.replaceCandidateAfterProvenCollision(
            started.operation,
            command,
            collisionCount,
          );
          continue;
        }
        if (error instanceof ProvisioningProviderError && error.mayHaveApplied) {
          return this.reconcileCreate(started.operation, variant);
        }
        await this.repository.markOperationFailed(
          operation.id,
          error instanceof ProvisioningProviderError ? error.code : 'CREATE_FAILED',
        );
        throw error;
      }
      if (!createPostconditionsMatch(created, variant, operation)) {
        await this.repository.markOperationPending(
          operation.id,
          'CREATE_REMOTE_POSTCONDITION_FAILED',
        );
        throw new ProvisioningPendingError('CREATE_RECONCILIATION_REQUIRED');
      }
      return this.repository.completeCreate(operation.id, variant, created);
    }
    await this.repository.markOperationFailed(initialOperation.id, 'SERVICE_USERNAME_EXHAUSTED');
    throw new DomainConflictError('SERVICE_USERNAME_EXHAUSTED');
  }

  private async replaceCandidateAfterProvenCollision(
    operation: ReservedOperation['operation'],
    command: CreateDirectServiceCommand,
    collisionCount: number,
  ): Promise<ReservedOperation['operation']> {
    if (command.serviceUsernameBase === undefined) {
      await this.repository.markOperationFailed(operation.id, 'SERVICE_USERNAME_TAKEN');
      throw new DomainConflictError('SERVICE_USERNAME_TAKEN');
    }
    if (collisionCount + 1 >= MAX_SERVICE_USERNAME_SUFFIX_ATTEMPTS) {
      await this.repository.markOperationFailed(operation.id, 'SERVICE_USERNAME_EXHAUSTED');
      throw new DomainConflictError('SERVICE_USERNAME_EXHAUSTED');
    }
    if (operation.candidateUsername === null) {
      await this.repository.markOperationPending(operation.id, 'CREATE_CANDIDATE_MISSING');
      throw new ProvisioningPendingError('CREATE_RECONCILIATION_REQUIRED');
    }
    return this.repository.replaceCreateCandidateAfterCollision(
      operation.id,
      operation.candidateUsername,
      composeServiceUsername(command.serviceUsernameBase, generateServiceUsernameSuffix()),
    );
  }

  private async reconcileCreate(
    operation: ReservedOperation['operation'],
    variant: DirectProductVariant,
  ): Promise<ServiceBinding> {
    const username = operation.candidateUsername;
    if (username === null) {
      await this.repository.markOperationPending(operation.id, 'CREATE_CANDIDATE_MISSING');
      throw new ProvisioningPendingError('CREATE_RECONCILIATION_REQUIRED');
    }
    const remote = await this.provider.findUserByUsername(username).catch(() => null);
    if (remote !== null && createPostconditionsMatch(remote, variant, operation)) {
      return this.repository.completeCreate(operation.id, variant, remote);
    }
    await this.repository.markOperationPending(operation.id, 'CREATE_RECONCILIATION_REQUIRED');
    throw new ProvisioningPendingError('CREATE_RECONCILIATION_REQUIRED');
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
    const groupsExist = await this.repository.groupsExist(
      variant.providerInstanceId,
      variant.groupIds,
    );
    if (!groupsExist) {
      await this.repository.markOperationFailed(reserved.operation.id, 'INVALID_PROVIDER_GROUP');
      throw new DomainConflictError('INVALID_PROVIDER_GROUP');
    }
    if (
      reserved.operation.reconciliationState === 'attempting' ||
      reserved.operation.reconciliationState === 'reconciliation_required'
    ) {
      return this.reconcileRenew(reserved.operation, service);
    }

    const current = await this.provider.getUserById(service.targetUserId);
    if (current === null) {
      await this.repository.markOperationFailed(reserved.operation.id, 'REMOTE_USER_NOT_FOUND');
      throw new DomainConflictError('REMOTE_USER_NOT_FOUND');
    }
    const now = this.now();
    const base = current.expiresAt !== null && current.expiresAt > now ? current.expiresAt : now;
    const desiredExpiry = addDays(base, variant.durationDays);
    const desiredStatus: ServiceBinding['status'] = 'active';

    this.mutationGate.assertMutationAllowed(variant);
    const started = await this.repository.beginRenewAttempt(
      reserved.operation.id,
      desiredExpiry,
      variant.dataLimitBytes,
      desiredStatus,
    );
    if (started.outcome === 'existing') {
      return this.reconcileRenew(started.operation, service);
    }

    let remote: ProviderUser;
    try {
      remote = await this.provider.renewUser({
        userId: current.id,
        expiresAt: desiredExpiry,
        dataLimitBytes: variant.dataLimitBytes,
      });
    } catch (error: unknown) {
      if (error instanceof ProvisioningProviderError && error.mayHaveApplied) {
        return this.reconcileRenew(started.operation, service);
      }
      await this.repository.markOperationFailed(
        started.operation.id,
        error instanceof ProvisioningProviderError ? error.code : 'RENEW_FAILED',
      );
      throw error;
    }

    if (!renewPostconditionsMatch(remote, desiredExpiry, variant.dataLimitBytes, desiredStatus)) {
      await this.repository.markOperationPending(
        started.operation.id,
        'RENEW_REMOTE_POSTCONDITION_FAILED',
      );
      throw new ProvisioningPendingError('RENEW_RECONCILIATION_REQUIRED');
    }
    return this.repository.completeRenew(started.operation.id, service.id, remote);
  }

  private async reconcileRenew(
    operation: ReservedOperation['operation'],
    service: ServiceBinding,
  ): Promise<ServiceBinding> {
    if (operation.requestedExpiresAt === null) {
      await this.repository.markOperationPending(operation.id, 'RENEW_RECONCILIATION_REQUIRED');
      throw new ProvisioningPendingError('RENEW_RECONCILIATION_REQUIRED');
    }
    const remote = await this.provider.getUserById(service.targetUserId).catch(() => null);
    if (
      remote !== null &&
      operation.requestedDataLimitBytes !== null &&
      operation.requestedStatus !== null &&
      renewPostconditionsMatch(
        remote,
        operation.requestedExpiresAt,
        operation.requestedDataLimitBytes,
        operation.requestedStatus,
      )
    ) {
      return this.repository.completeRenew(operation.id, service.id, remote);
    }
    await this.repository.markOperationPending(operation.id, 'RENEW_RECONCILIATION_REQUIRED');
    throw new ProvisioningPendingError('RENEW_RECONCILIATION_REQUIRED');
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

function initialUsername(command: CreateDirectServiceCommand): string {
  if (command.serviceUsernameBase !== undefined) {
    return composeServiceUsername(command.serviceUsernameBase, generateServiceUsernameSuffix());
  }
  return command.requestedUsername ?? deterministicUsername(command.idempotencyKey);
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

function renewPostconditionsMatch(
  remote: ProviderUser,
  expiresAt: Date,
  dataLimitBytes: bigint,
  status: ServiceBinding['status'],
): boolean {
  return (
    sameInstant(remote.expiresAt, expiresAt) &&
    remote.dataLimitBytes === dataLimitBytes &&
    remote.status === status
  );
}

function createPostconditionsMatch(
  user: ProviderUser,
  variant: DirectProductVariant,
  operation: ReservedOperation['operation'],
): boolean {
  const actual = [...user.groupIds].sort((left, right) => left - right);
  const expected = [...variant.groupIds].sort((left, right) => left - right);
  return (
    operation.requestedExpiresAt !== null &&
    operation.requestedDataLimitBytes !== null &&
    operation.requestedStatus !== null &&
    user.provisioningNote === createOperationNote(operation.id) &&
    sameInstant(user.expiresAt, operation.requestedExpiresAt) &&
    user.dataLimitBytes === operation.requestedDataLimitBytes &&
    user.status === operation.requestedStatus &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function createOperationNote(operationId: string): string {
  return `neo_bot create; operation=${operationId}`;
}

const disabledMutationGate = new ProvisioningModeGate({
  mode: 'disabled',
  isolatedGroupId: null,
});
