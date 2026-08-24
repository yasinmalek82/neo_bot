import { SERVICE_USERNAME_FINAL_PATTERN } from '@neo-bot/domain';
import { describe, expect, it } from 'vitest';

import { buildRandomServiceUsername } from './service-username.js';

describe('buildRandomServiceUsername', () => {
  it('appends a four-character suffix after an underscore', () => {
    const username = buildRandomServiceUsername('neo', () => 0);
    expect(username.startsWith('neo_')).toBe(true);
    expect(SERVICE_USERNAME_FINAL_PATTERN.test(username)).toBe(true);
  });
});
