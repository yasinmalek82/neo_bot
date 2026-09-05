import { describe, expect, it } from 'vitest';

import {
  isActiveChatMember,
  parseForcedJoinChannelInput,
  remainingTrafficPercent,
  validateBroadcastBody,
  validateStorefrontOpsSettingsPatch,
} from './commerce-ops.js';

describe('commercial wave 1 domain rules', () => {
  it('accepts a public channel username or a numeric chat id', () => {
    expect(parseForcedJoinChannelInput('@NeoNetwork')).toEqual({
      chatId: '@NeoNetwork',
      username: 'NeoNetwork',
    });
    expect(parseForcedJoinChannelInput('-1001234567890')).toEqual({
      chatId: '-1001234567890',
      username: null,
    });
    expect(() => parseForcedJoinChannelInput('bad channel')).toThrow('INVALID_FORCED_JOIN_CHANNEL');
  });

  it('keeps reminder thresholds in a bounded commercial range', () => {
    expect(validateStorefrontOpsSettingsPatch({ expiryReminderDays: 5, lowTrafficPercent: 10 })).toEqual({
      expiryReminderDays: 5,
      lowTrafficPercent: 10,
    });
    expect(() => validateStorefrontOpsSettingsPatch({ expiryReminderDays: 0 })).toThrow(
      'INVALID_REMINDER_DAYS',
    );
  });

  it('treats creator, administrator, member and restricted-is-member as joined', () => {
    expect(isActiveChatMember('member')).toBe(true);
    expect(isActiveChatMember('restricted', true)).toBe(true);
    expect(isActiveChatMember('restricted', false)).toBe(false);
    expect(isActiveChatMember('left')).toBe(false);
  });

  it('computes remaining traffic only when usage is known', () => {
    expect(remainingTrafficPercent(100n, 80n)).toBe(20);
    expect(remainingTrafficPercent(100n, null)).toBeNull();
    expect(remainingTrafficPercent(0n, 0n)).toBeNull();
  });

  it('rejects an empty or oversized broadcast body', () => {
    expect(validateBroadcastBody('اعلام قطعی موقت')).toBe('اعلام قطعی موقت');
    expect(() => validateBroadcastBody('   ')).toThrow('INVALID_BROADCAST_BODY');
  });
});
