export interface ProviderHealth {
  readonly ok: boolean;
  readonly checkedAt: Date;
  readonly latencyMs: number;
  readonly errorCode?: string;
}

export interface ProviderGroup {
  readonly id: number;
  readonly name: string;
  readonly disabled: boolean;
  readonly inboundTags: readonly string[];
}

export type ProviderUserStatus = 'active' | 'disabled' | 'expired' | 'limited' | 'on_hold';

export interface ProviderUser {
  readonly id: number;
  readonly username: string;
  readonly status: ProviderUserStatus;
  readonly expiresAt: Date | null;
  readonly dataLimitBytes: bigint;
  readonly usedTrafficBytes: bigint;
  readonly groupIds: readonly number[];
  readonly subscriptionUrl: string;
  /**
   * Provider-side operation marker. It is used only to reconcile a create safely,
   * never exposed to customers or persisted with the service.
   */
  readonly provisioningNote?: string | null;
}

export interface CreateProviderUser {
  readonly username: string;
  readonly expiresAt: Date | null;
  readonly dataLimitBytes: bigint;
  readonly groupIds: readonly number[];
  readonly deviceLimit: number;
  readonly note: string;
}

export interface RenewProviderUser {
  readonly userId: number;
  readonly expiresAt: Date | null;
  readonly dataLimitBytes: bigint;
}

export interface ProvisioningProvider {
  health(): Promise<ProviderHealth>;
  listGroups(): Promise<readonly ProviderGroup[]>;
  findUserByUsername(username: string): Promise<ProviderUser | null>;
  getUserById(userId: number): Promise<ProviderUser | null>;
  createUser(input: CreateProviderUser): Promise<ProviderUser>;
  renewUser(input: RenewProviderUser): Promise<ProviderUser>;
}
