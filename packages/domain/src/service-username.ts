import { DomainConflictError, ProvisioningProviderError } from './errors.js';

export const SERVICE_USERNAME_SUFFIX_LENGTH = 4;
export const MAX_SERVICE_USERNAME_BASE_LENGTH = 59;
export const MAX_SERVICE_USERNAME_SUFFIX_ATTEMPTS = 5;
export const SERVICE_USERNAME_BASE_PATTERN = /^[a-z0-9_-]+$/u;
export const SERVICE_USERNAME_SUFFIX_PATTERN = /^[a-z0-9]{4}$/u;
export const SERVICE_USERNAME_FINAL_PATTERN = /^[a-z0-9_-]+_[a-z0-9]{4}$/u;

export function validateServiceUsernameBase(baseName: string): void {
  if (baseName.length === 0 || baseName.length > MAX_SERVICE_USERNAME_BASE_LENGTH) {
    throw new DomainConflictError('INVALID_SERVICE_USERNAME_BASE');
  }
  if (baseName.includes('@') || /\s/u.test(baseName)) {
    throw new DomainConflictError('INVALID_SERVICE_USERNAME_BASE');
  }
  if (!SERVICE_USERNAME_BASE_PATTERN.test(baseName)) {
    throw new DomainConflictError('INVALID_SERVICE_USERNAME_BASE');
  }
}

export function composeServiceUsername(baseName: string, suffix: string): string {
  validateServiceUsernameBase(baseName);
  if (!SERVICE_USERNAME_SUFFIX_PATTERN.test(suffix)) {
    throw new DomainConflictError('INVALID_SERVICE_USERNAME_SUFFIX');
  }
  return `${baseName}_${suffix}`;
}

export function isServiceUsernameUnavailableError(error: unknown): boolean {
  if (error instanceof DomainConflictError) {
    return error.code === 'REMOTE_USER_GROUP_CONFLICT' || error.code === 'SERVICE_USERNAME_TAKEN';
  }
  if (error instanceof ProvisioningProviderError && !error.mayHaveApplied) {
    return /^(?:PASARGUARD_HTTP_409|USERNAME_TAKEN)$/u.test(error.code);
  }
  return false;
}
