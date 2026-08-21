import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PasarGuardClient } from './client.js';

interface TestUser {
  id: number;
  username: string;
  status: string;
  expire: string | number;
  data_limit: string;
  used_traffic: string;
  group_ids: number[];
  subscription_url: string;
  proxy_settings: Record<string, unknown>;
  hwid_limit?: number;
}

describe('PasarGuardClient', () => {
  const users = new Map<number, TestUser>();
  let baseUrl = '';
  let nextId = 1;
  const server = createServer(async (request, response) => {
    await handleRequest(request, response, users, () => nextId++);
  });

  beforeEach(async () => {
    users.clear();
    nextId = 1;
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('TEST_SERVER_ADDRESS_MISSING');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    server.close();
    await once(server, 'close');
  });

  it('reads full group snapshots and reports healthy connectivity', async () => {
    const client = createClient(baseUrl);
    await expect(client.health()).resolves.toMatchObject({ ok: true });
    await expect(client.listGroups()).resolves.toEqual([
      { id: 7, name: 'pilot', disabled: false, inboundTags: ['vless-pilot'] },
    ]);
  });

  it('creates a user and then addresses it by numeric id', async () => {
    const client = createClient(baseUrl);
    const created = await client.createUser({
      username: 'pilot_user',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      dataLimitBytes: 0n,
      groupIds: [7],
      deviceLimit: 1,
      note: 'pilot',
    });
    expect(created.id).toBe(1);
    expect(created.subscriptionUrl).toBe(`${baseUrl}/sub/test-1`);
    await expect(client.getUserById(created.id)).resolves.toMatchObject({ username: 'pilot_user' });
  });

  it('renews by numeric id while preserving groups and proxy settings', async () => {
    const client = createClient(baseUrl);
    const created = await client.createUser({
      username: 'renew_user',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      dataLimitBytes: 0n,
      groupIds: [7],
      deviceLimit: 2,
      note: 'pilot',
    });
    const renewed = await client.renewUser({
      userId: created.id,
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      dataLimitBytes: 0n,
    });
    expect(renewed.expiresAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(renewed.groupIds).toEqual([7]);
    expect(users.get(created.id)?.hwid_limit).toBe(2);
  });

  it('rejects a subscription URL from another origin', async () => {
    const client = createClient(baseUrl);
    users.set(1, {
      id: 1,
      username: 'unsafe',
      status: 'active',
      expire: 0,
      data_limit: '0',
      used_traffic: '0',
      group_ids: [7],
      subscription_url: 'https://attacker.invalid/sub/token',
      proxy_settings: {},
    });
    await expect(client.getUserById(1)).rejects.toMatchObject({ code: 'UNSAFE_SUBSCRIPTION_URL' });
  });
});

function createClient(baseUrl: string): PasarGuardClient {
  return new PasarGuardClient({
    baseUrl,
    apiKey: 'test-api-key',
    maxRetries: 0,
    allowInsecureLocalhostForTests: true,
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  users: Map<number, TestUser>,
  nextId: () => number,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (request.headers['x-api-key'] !== 'test-api-key') {
    return sendJson(response, 401, { detail: 'unauthorized' });
  }
  if (request.method === 'GET' && url.pathname === '/api/groups/simple') {
    return sendJson(response, 200, { groups: [{ id: 7, name: 'pilot' }], total: 1 });
  }
  if (request.method === 'GET' && url.pathname === '/api/group/7') {
    return sendJson(response, 200, {
      id: 7,
      name: 'pilot',
      inbound_tags: ['vless-pilot'],
      is_disabled: false,
    });
  }
  if (request.method === 'GET' && url.pathname.startsWith('/api/user/by-id/')) {
    const id = Number(url.pathname.split('/').at(-1));
    const user = users.get(id);
    return user === undefined
      ? sendJson(response, 404, { detail: 'not found' })
      : sendJson(response, 200, user);
  }
  if (request.method === 'GET' && url.pathname.startsWith('/api/user/by-username/')) {
    const username = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
    const user = [...users.values()].find((candidate) => candidate.username === username);
    return user === undefined
      ? sendJson(response, 404, { detail: 'not found' })
      : sendJson(response, 200, user);
  }
  if (request.method === 'POST' && url.pathname === '/api/user') {
    const body = (await readJson(request)) as Record<string, unknown>;
    const id = nextId();
    const user = {
      ...body,
      id,
      used_traffic: '0',
      subscription_url: `/sub/test-${id}`,
    } as TestUser;
    users.set(id, user);
    return sendJson(response, 201, user);
  }
  if (request.method === 'PUT' && url.pathname.startsWith('/api/user/by-id/')) {
    const id = Number(url.pathname.split('/').at(-1));
    const existing = users.get(id);
    if (existing === undefined) {
      return sendJson(response, 404, { detail: 'not found' });
    }
    const body = (await readJson(request)) as Partial<TestUser>;
    const updated = { ...existing, ...body };
    users.set(id, updated);
    return sendJson(response, 200, updated);
  }
  return sendJson(response, 404, { detail: 'not found' });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}
