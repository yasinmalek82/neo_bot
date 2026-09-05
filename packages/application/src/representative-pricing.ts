import { DomainConflictError, type RepresentativeProfile } from '@neo-bot/domain';

export interface RepresentativePricingRepository {
  listRepresentatives(): Promise<readonly RepresentativeProfile[]>;
  findRepresentativeById(id: string): Promise<{
    readonly id: string;
    readonly code: string;
    readonly telegramUserId: number;
    readonly active: boolean;
  } | null>;
  setRepresentativeVariantAccess(input: {
    readonly representativeId: string;
    readonly variantId: string;
    readonly active: boolean;
  }): Promise<void>;
  setRepresentativeBasePrice(input: {
    readonly variantId: string;
    readonly priceIrr: bigint;
  }): Promise<void>;
  clearRepresentativeBasePrice(input: { readonly variantId: string }): Promise<void>;
  setRepresentativeOverridePrice(input: {
    readonly representativeId: string;
    readonly variantId: string;
    readonly priceIrr: bigint;
  }): Promise<void>;
  clearRepresentativeOverridePrice(input: {
    readonly representativeId: string;
    readonly variantId: string;
  }): Promise<void>;
}

export type RepresentativePricingOperation =
  | 'grant-access'
  | 'revoke-access'
  | 'set-base-price'
  | 'clear-base-price'
  | 'set-override-price'
  | 'clear-override-price';

export class RepresentativePricingUseCase {
  public constructor(private readonly repository: RepresentativePricingRepository) {}

  public listRepresentatives(): Promise<readonly RepresentativeProfile[]> {
    return this.repository.listRepresentatives();
  }

  public async apply(input: {
    readonly operation: RepresentativePricingOperation;
    readonly representativeId?: string;
    readonly variantId: string;
    readonly priceIrr?: bigint;
  }): Promise<void> {
    requireVariantId(input.variantId);
    if (input.operation === 'clear-base-price') {
      await this.repository.clearRepresentativeBasePrice({ variantId: input.variantId });
      return;
    }
    if (input.operation === 'set-base-price') {
      await this.repository.setRepresentativeBasePrice({
        variantId: input.variantId,
        priceIrr: requirePrice(input.priceIrr),
      });
      return;
    }
    const representative = await this.requireActiveRepresentative(input.representativeId);
    if (input.operation === 'grant-access' || input.operation === 'revoke-access') {
      await this.repository.setRepresentativeVariantAccess({
        representativeId: representative.id,
        variantId: input.variantId,
        active: input.operation === 'grant-access',
      });
      return;
    }
    if (input.operation === 'clear-override-price') {
      await this.repository.clearRepresentativeOverridePrice({
        representativeId: representative.id,
        variantId: input.variantId,
      });
      return;
    }
    await this.repository.setRepresentativeOverridePrice({
      representativeId: representative.id,
      variantId: input.variantId,
      priceIrr: requirePrice(input.priceIrr),
    });
  }

  private async requireActiveRepresentative(id: string | undefined) {
    if (id === undefined || !/^\d{1,20}$/u.test(id)) {
      throw new DomainConflictError('INVALID_REPRESENTATIVE_LOOKUP');
    }
    const representative = await this.repository.findRepresentativeById(id);
    if (representative === null) {
      throw new DomainConflictError('REPRESENTATIVE_NOT_FOUND');
    }
    if (!representative.active) {
      throw new DomainConflictError('REPRESENTATIVE_INACTIVE');
    }
    return representative;
  }
}

function requireVariantId(value: string): void {
  if (!/^\d{1,20}$/u.test(value)) {
    throw new DomainConflictError('INVALID_VARIANT');
  }
}

function requirePrice(value: bigint | undefined): bigint {
  if (value === undefined || value <= 0n || value > 999999999999999n) {
    throw new DomainConflictError('INVALID_REPRESENTATIVE_PRICE');
  }
  return value;
}
