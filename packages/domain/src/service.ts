import type { ProviderUserStatus } from './provider.js';

export interface ServiceBinding {
  readonly id: string;
  readonly productVariantId: string;
  readonly providerInstanceId: string;
  readonly targetUserId: number;
  readonly targetUsername: string;
  readonly status: ProviderUserStatus;
  readonly expiresAt: Date | null;
  readonly subscriptionUrl: string;
}

export type ProvisioningOperationType = 'create' | 'renew';
export type ProvisioningOperationStatus = 'pending' | 'completed' | 'failed';
export type ProvisioningReconciliationState =
  'not_required' | 'candidate_persisted' | 'attempting' | 'reconciliation_required' | 'reconciled';

export interface ProvisioningOperation {
  readonly id: string;
  readonly type: ProvisioningOperationType;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly status: ProvisioningOperationStatus;
  readonly candidateUsername: string | null;
  readonly attemptCount: number;
  readonly reconciliationState: ProvisioningReconciliationState;
  readonly requestedExpiresAt: Date | null;
  readonly requestedDataLimitBytes: bigint | null;
  readonly requestedStatus: ProviderUserStatus | null;
  readonly serviceId: string | null;
  readonly remoteUserId: number | null;
  readonly errorCode: string | null;
}
