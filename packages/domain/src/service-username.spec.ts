import { describe, expect, it } from 'vitest';

import { DomainConflictError } from './errors.js';
import {
  composeServiceUsername,
  isServiceUsernameUnavailableError,
  SERVICE_USERNAME_FINAL_PATTERN,
  validateServiceUsernameBase,
} from './service-username.js';
import { ProvisioningProviderError } from './errors.js';

describe('service username', () => {
  it('accepts strict ascii base names', () => {
    expect(() => validateServiceUsernameBase('neo_user-1')).not.toThrow();
  });

  it('rejects spaces, at-signs and invalid characters', () => {
    expect(() => validateServiceUsernameBase('neo user')).toThrow(DomainConflictError);
    expect(() => validateServiceUsernameBase('neo@user')).toThrow(DomainConflictError);
    expect(() => validateServiceUsernameBase('Neo')).toThrow(DomainConflictError);
  });

  it('builds final usernames with underscore and four random chars', () => {
    const username = composeServiceUsername('buyer', 'a9z3');
    expect(username).toBe('buyer_a9z3');
    expect(SERVICE_USERNAME_FINAL_PATTERN.test(username)).toBe(true);
  });

  it('detects downstream username-unavailable errors', () => {
    expect(
      isServiceUsernameUnavailableError(new DomainConflictError('SERVICE_USERNAME_TAKEN')),
    ).toBe(true);
    expect(
      isServiceUsernameUnavailableError(
        new ProvisioningProviderError('PASARGUARD_HTTP_409', false, false),
      ),
    ).toBe(true);
    expect(
      isServiceUsernameUnavailableError(
        new ProvisioningProviderError('PASARGUARD_TIMEOUT', true, true),
      ),
    ).toBe(false);
  });
});
