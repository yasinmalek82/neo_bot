export interface DirectProductVariant {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly durationDays: number;
  readonly dataLimitBytes: bigint;
  readonly deviceLimit: number;
  readonly providerInstanceId: string;
  readonly groupIds: readonly number[];
  readonly active: boolean;
}

export function validateDirectProductVariant(variant: DirectProductVariant): void {
  if (!variant.active) {
    throw new Error('PRODUCT_INACTIVE');
  }
  if (variant.durationDays <= 0 || !Number.isInteger(variant.durationDays)) {
    throw new Error('INVALID_DURATION');
  }
  if (variant.dataLimitBytes < 0n) {
    throw new Error('INVALID_DATA_LIMIT');
  }
  if (variant.deviceLimit < 0 || !Number.isInteger(variant.deviceLimit)) {
    throw new Error('INVALID_DEVICE_LIMIT');
  }
  if (variant.groupIds.length === 0 || new Set(variant.groupIds).size !== variant.groupIds.length) {
    throw new Error('INVALID_GROUPS');
  }
  if (variant.groupIds.some((groupId) => !Number.isSafeInteger(groupId) || groupId <= 0)) {
    throw new Error('INVALID_GROUPS');
  }
}
