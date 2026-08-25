import { DomainConflictError, type DirectProductVariant } from '@neo-bot/domain';

export type ProvisioningMode = 'disabled' | 'isolated' | 'live';

export interface ProvisioningMutationGate {
  assertMutationAllowed(variant: DirectProductVariant): void;
}

export class ProvisioningModeGate implements ProvisioningMutationGate {
  public constructor(
    private readonly config: {
      readonly mode: ProvisioningMode;
      readonly isolatedGroupId: number | null;
    },
  ) {}

  public assertMutationAllowed(variant: DirectProductVariant): void {
    if (this.config.mode === 'disabled') {
      throw new DomainConflictError('PROVISIONING_DISABLED');
    }
    if (this.config.mode !== 'isolated') {
      return;
    }
    const groupId = this.config.isolatedGroupId;
    if (groupId === null || variant.groupIds.length !== 1 || variant.groupIds[0] !== groupId) {
      throw new DomainConflictError('PROVISIONING_GROUP_NOT_ISOLATED');
    }
  }
}
