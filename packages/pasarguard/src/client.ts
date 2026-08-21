import { randomUUID } from 'node:crypto';

import type {
  CreateProviderUser,
  ProviderGroup,
  ProviderHealth,
  ProviderUser,
  ProvisioningProvider,
  RenewProviderUser,
} from '@neo-bot/domain';
import { ZodError } from 'zod';

import { PasarGuardError } from './errors.js';
import {
  groupDetailSchema,
  rawUserSchema,
  simpleGroupsResponseSchema,
  type RawPasarGuardUser,
} from './schemas.js';

const maximumResponseBytes = 2 * 1024 * 1024;

export interface PasarGuardClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryBaseMs?: number;
  readonly allowInsecureLocalhostForTests?: boolean;
  readonly fetchImplementation?: typeof fetch;
}

export class PasarGuardClient implements ProvisioningProvider {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly fetchImplementation: typeof fetch;

  public constructor(private readonly options: PasarGuardClientOptions) {
    this.baseUrl = validateBaseUrl(
      options.baseUrl,
      options.allowInsecureLocalhostForTests === true,
    );
    if (options.apiKey.trim().length < 8) {
      throw new PasarGuardError('INVALID_API_KEY', false, false);
    }
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseMs = options.retryBaseMs ?? 100;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  public async health(): Promise<ProviderHealth> {
    const startedAt = performance.now();
    try {
      await this.request('GET', '/api/groups/simple?all=true', undefined, true);
      return {
        ok: true,
        checkedAt: new Date(),
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch (error: unknown) {
      return {
        ok: false,
        checkedAt: new Date(),
        latencyMs: Math.round(performance.now() - startedAt),
        errorCode: error instanceof PasarGuardError ? error.code : 'PASARGUARD_UNKNOWN_ERROR',
      };
    }
  }

  public async listGroups(): Promise<readonly ProviderGroup[]> {
    const response = simpleGroupsResponseSchema.parse(
      await this.request('GET', '/api/groups/simple?all=true', undefined, true),
    );
    return Promise.all(
      response.groups.map(async (simple) => {
        const detail = groupDetailSchema.parse(
          await this.request('GET', `/api/group/${String(simple.id)}`, undefined, true),
        );
        return {
          id: detail.id,
          name: detail.name,
          disabled: detail.is_disabled,
          inboundTags: detail.inbound_tags,
        };
      }),
    );
  }

  public async findUserByUsername(username: string): Promise<ProviderUser | null> {
    try {
      const raw = rawUserSchema.parse(
        await this.request(
          'GET',
          `/api/user/by-username/${encodeURIComponent(username)}`,
          undefined,
          true,
        ),
      );
      return this.mapUser(raw);
    } catch (error: unknown) {
      if (error instanceof PasarGuardError && error.code === 'PASARGUARD_HTTP_404') {
        return null;
      }
      throw this.normalizeError(error, false);
    }
  }

  public async getUserById(userId: number): Promise<ProviderUser | null> {
    try {
      const raw = await this.getRawUserById(userId);
      return this.mapUser(raw);
    } catch (error: unknown) {
      if (error instanceof PasarGuardError && error.code === 'PASARGUARD_HTTP_404') {
        return null;
      }
      throw this.normalizeError(error, false);
    }
  }

  public async createUser(input: CreateProviderUser): Promise<ProviderUser> {
    try {
      const payload: Record<string, unknown> = {
        username: input.username,
        status: 'active',
        expire: input.expiresAt === null ? 0 : input.expiresAt.toISOString(),
        data_limit: input.dataLimitBytes.toString(),
        data_limit_reset_strategy: 'no_reset',
        group_ids: [...input.groupIds],
        proxy_settings: { vless: { id: randomUUID() } },
        note: input.note.slice(0, 500),
      };
      if (input.deviceLimit > 0) {
        payload['hwid_limit'] = input.deviceLimit;
      }
      const raw = rawUserSchema.parse(await this.request('POST', '/api/user', payload, false));
      return this.mapUser(raw);
    } catch (error: unknown) {
      throw this.normalizeError(error, true);
    }
  }

  public async renewUser(input: RenewProviderUser): Promise<ProviderUser> {
    try {
      const current = await this.getRawUserById(input.userId);
      const payload: Record<string, unknown> = {
        status: 'active',
        expire: input.expiresAt === null ? 0 : input.expiresAt.toISOString(),
        data_limit: input.dataLimitBytes.toString(),
        group_ids: current.group_ids,
        proxy_settings: current.proxy_settings,
      };
      if (current.hwid_limit !== null && current.hwid_limit !== undefined) {
        payload['hwid_limit'] = current.hwid_limit;
      }
      const updated = rawUserSchema.parse(
        await this.request('PUT', `/api/user/by-id/${String(input.userId)}`, payload, false),
      );
      return this.mapUser(updated);
    } catch (error: unknown) {
      throw this.normalizeError(error, true);
    }
  }

  private async getRawUserById(userId: number): Promise<RawPasarGuardUser> {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new PasarGuardError('INVALID_USER_ID', false, false);
    }
    return rawUserSchema.parse(
      await this.request('GET', `/api/user/by-id/${String(userId)}`, undefined, true),
    );
  }

  private mapUser(raw: RawPasarGuardUser): ProviderUser {
    return {
      id: raw.id,
      username: raw.username,
      status: raw.status,
      expiresAt: parseExpiry(raw.expire),
      dataLimitBytes: raw.data_limit,
      usedTrafficBytes: raw.used_traffic,
      groupIds: raw.group_ids,
      subscriptionUrl: normalizeSubscriptionUrl(this.baseUrl, raw.subscription_url),
    };
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    payload: Record<string, unknown> | undefined,
    retryableMethod: boolean,
  ): Promise<unknown> {
    const url = new URL(path.replace(/^\//u, ''), this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new PasarGuardError('UNSAFE_REQUEST_URL', false, false);
    }
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    let lastError: PasarGuardError | null = null;

    for (let attempt = 0; attempt <= (retryableMethod ? this.maxRetries : 0); attempt += 1) {
      try {
        const response = await this.fetchImplementation(url, {
          method,
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'identity',
            'X-Api-Key': this.options.apiKey,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
          const retryable = response.status >= 500 || response.status === 429;
          throw new PasarGuardError(
            `PASARGUARD_HTTP_${String(response.status)}`,
            retryable,
            method !== 'GET' && response.status >= 500,
          );
        }
        return await readBoundedJson(response);
      } catch (error: unknown) {
        lastError = this.normalizeError(error, method !== 'GET');
        if (!retryableMethod || !lastError.retryable || attempt >= this.maxRetries) {
          throw lastError;
        }
        await delay(this.retryBaseMs * 2 ** attempt);
      }
    }
    throw lastError ?? new PasarGuardError('PASARGUARD_UNKNOWN_ERROR', false, method !== 'GET');
  }

  private normalizeError(error: unknown, mayHaveApplied: boolean): PasarGuardError {
    if (error instanceof PasarGuardError) {
      return error;
    }
    if (error instanceof ZodError) {
      return new PasarGuardError('PASARGUARD_INVALID_RESPONSE', false, mayHaveApplied, {
        cause: error,
      });
    }
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return new PasarGuardError('PASARGUARD_TIMEOUT', true, mayHaveApplied, { cause: error });
    }
    return new PasarGuardError('PASARGUARD_NETWORK_ERROR', true, mayHaveApplied, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function validateBaseUrl(value: string, allowInsecureLocalhost: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error: unknown) {
    throw new PasarGuardError('INVALID_BASE_URL', false, false, {
      cause: error instanceof Error ? error : undefined,
    });
  }
  const insecureTestUrl =
    allowInsecureLocalhost &&
    parsed.protocol === 'http:' &&
    ['127.0.0.1', 'localhost'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !insecureTestUrl) {
    throw new PasarGuardError('INVALID_BASE_URL', false, false);
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, '')}/`;
  parsed.search = '';
  parsed.hash = '';
  return parsed;
}

function normalizeSubscriptionUrl(baseUrl: URL, value: string): string {
  const subscription = new URL(value, baseUrl);
  if (
    subscription.origin !== baseUrl.origin ||
    subscription.protocol !== baseUrl.protocol ||
    !subscription.pathname.startsWith('/sub/')
  ) {
    throw new PasarGuardError('UNSAFE_SUBSCRIPTION_URL', false, false);
  }
  return subscription.toString();
}

function parseExpiry(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === 0 || value === '0') {
    return null;
  }
  const date = typeof value === 'number' ? new Date(value * 1_000) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PasarGuardError('PASARGUARD_INVALID_EXPIRY', false, false);
  }
  return date;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > maximumResponseBytes) {
    throw new PasarGuardError('PASARGUARD_RESPONSE_TOO_LARGE', false, false);
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new PasarGuardError('PASARGUARD_EMPTY_RESPONSE', false, false);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let result = await reader.read();
  while (!result.done) {
    const value: unknown = result.value;
    if (!(value instanceof Uint8Array)) {
      throw new PasarGuardError('PASARGUARD_INVALID_BODY_CHUNK', false, false);
    }
    const chunk = value;
    total += chunk.byteLength;
    if (total > maximumResponseBytes) {
      await reader.cancel();
      throw new PasarGuardError('PASARGUARD_RESPONSE_TOO_LARGE', false, false);
    }
    chunks.push(chunk);
    result = await reader.read();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error: unknown) {
    throw new PasarGuardError('PASARGUARD_INVALID_JSON', false, false, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
