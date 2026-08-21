import { ProvisioningProviderError } from '@neo-bot/domain';

export class PasarGuardError extends ProvisioningProviderError {
  public constructor(
    code: string,
    retryable: boolean,
    mayHaveApplied: boolean,
    options?: ErrorOptions,
  ) {
    super(code, retryable, mayHaveApplied, options);
    this.name = 'PasarGuardError';
  }
}
