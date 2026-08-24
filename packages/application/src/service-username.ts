import {
  composeServiceUsername,
  MAX_SERVICE_USERNAME_SUFFIX_ATTEMPTS,
  validateServiceUsernameBase,
} from '@neo-bot/domain';

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function generateServiceUsernameSuffix(random: () => number = Math.random): string {
  let suffix = '';
  for (let index = 0; index < 4; index += 1) {
    const pick = Math.floor(random() * SUFFIX_ALPHABET.length);
    suffix += SUFFIX_ALPHABET.charAt(pick);
  }
  return suffix;
}

export function buildRandomServiceUsername(
  baseName: string,
  random: () => number = Math.random,
): string {
  validateServiceUsernameBase(baseName);
  return composeServiceUsername(baseName, generateServiceUsernameSuffix(random));
}

export { MAX_SERVICE_USERNAME_SUFFIX_ATTEMPTS };
