export class DomainConflictError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = 'DomainConflictError';
  }
}

export class ProvisioningPendingError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = 'ProvisioningPendingError';
  }
}

export class ProvisioningProviderError extends Error {
  public constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly mayHaveApplied: boolean,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'ProvisioningProviderError';
  }
}
