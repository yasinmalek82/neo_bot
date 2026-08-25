import type {
  DirectProductVariant,
  ProviderGroup,
  ProvisioningOperation,
  ProvisioningOperationType,
  ServiceBinding,
} from '@neo-bot/domain';

export type ReservedOperation =
  | { readonly outcome: 'reserved'; readonly operation: ProvisioningOperation }
  | { readonly outcome: 'existing'; readonly operation: ProvisioningOperation };

export interface ProvisioningRepository {
  getProductVariant(id: string): Promise<DirectProductVariant | null>;
  groupsExist(providerInstanceId: string, groupIds: readonly number[]): Promise<boolean>;
  replaceGroupSnapshots(
    providerInstanceId: string,
    groups: readonly ProviderGroup[],
    syncedAt: Date,
  ): Promise<void>;
  reserveOperation(
    type: ProvisioningOperationType,
    idempotencyKey: string,
    requestHash: string,
    serviceId?: string,
  ): Promise<ReservedOperation>;
  persistCreateCandidate(
    operationId: string,
    username: string,
    requestedExpiresAt: Date,
    requestedDataLimitBytes: bigint,
    requestedStatus: ServiceBinding['status'],
  ): Promise<ProvisioningOperation>;
  replaceCreateCandidateAfterCollision(
    operationId: string,
    expectedUsername: string,
    username: string,
  ): Promise<ProvisioningOperation>;
  beginCreateAttempt(operationId: string): Promise<ReservedOperation>;
  beginRenewAttempt(
    operationId: string,
    requestedExpiresAt: Date,
    requestedDataLimitBytes: bigint,
    requestedStatus: ServiceBinding['status'],
  ): Promise<ReservedOperation>;
  completeCreate(
    operationId: string,
    variant: DirectProductVariant,
    remote: {
      readonly id: number;
      readonly username: string;
      readonly status: ServiceBinding['status'];
      readonly expiresAt: Date | null;
      readonly dataLimitBytes: bigint;
      readonly groupIds: readonly number[];
      readonly subscriptionUrl: string;
    },
  ): Promise<ServiceBinding>;
  completeRenew(
    operationId: string,
    serviceId: string,
    remote: {
      readonly status: ServiceBinding['status'];
      readonly expiresAt: Date | null;
      readonly dataLimitBytes: bigint;
      readonly subscriptionUrl: string;
    },
  ): Promise<ServiceBinding>;
  markOperationFailed(operationId: string, errorCode: string): Promise<void>;
  markOperationPending(operationId: string, errorCode: string): Promise<void>;
  getService(id: string): Promise<ServiceBinding | null>;
}
