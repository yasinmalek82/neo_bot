import { createHmac, timingSafeEqual } from 'node:crypto';

import { DomainConflictError } from '@neo-bot/domain';

export interface TelegramWebAppUser {
  readonly id: number;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
}

const MAX_INIT_DATA_AGE_SECONDS = 86_400;

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  nowMs = Date.now(),
): TelegramWebAppUser {
  if (initData.length === 0 || initData.length > 4_096) {
    throw new DomainConflictError('INIT_DATA_INVALID');
  }
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (hash === null || !/^[a-f0-9]{64}$/u.test(hash)) {
    throw new DomainConflictError('INIT_DATA_INVALID');
  }
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const digest = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const expected = Buffer.from(digest, 'utf8');
  const supplied = Buffer.from(hash, 'utf8');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new DomainConflictError('INIT_DATA_INVALID');
  }
  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || nowMs / 1_000 - authDate > MAX_INIT_DATA_AGE_SECONDS) {
    throw new DomainConflictError('INIT_DATA_EXPIRED');
  }
  const rawUser = params.get('user');
  if (rawUser === null) {
    throw new DomainConflictError('INIT_DATA_INVALID');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUser) as unknown;
  } catch {
    throw new DomainConflictError('INIT_DATA_INVALID');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new DomainConflictError('INIT_DATA_INVALID');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record['id'] !== 'number' || !Number.isInteger(record['id']) || record['id'] < 1) {
    throw new DomainConflictError('INIT_DATA_INVALID');
  }
  if (typeof record['first_name'] !== 'string' || record['first_name'].length === 0) {
    throw new DomainConflictError('INIT_DATA_INVALID');
  }
  return {
    id: record['id'],
    first_name: record['first_name'],
    ...(typeof record['last_name'] === 'string' ? { last_name: record['last_name'] } : {}),
    ...(typeof record['username'] === 'string' ? { username: record['username'] } : {}),
  };
}
