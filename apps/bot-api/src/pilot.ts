import './load-local-env.js';

import { DirectServiceUseCase, ProvisioningModeGate } from '@neo-bot/application';
import { createDatabasePool, migrate, PostgresProvisioningRepository } from '@neo-bot/database';
import type { ServiceBinding } from '@neo-bot/domain';
import { PasarGuardClient, PasarGuardError } from '@neo-bot/pasarguard';

import { loadPilotConfig, type PilotConfig } from './config.js';

type PilotCommand = 'provider-health' | 'sync-groups' | 'seed-variant' | 'create' | 'get' | 'renew';

const [commandValue, ...arguments_] = process.argv.slice(2);
if (!isPilotCommand(commandValue)) {
  throw new Error('INVALID_PILOT_COMMAND');
}

const config = loadPilotConfig();
const pool = createDatabasePool({ connectionString: config.databaseUrl });
const repository = new PostgresProvisioningRepository(pool);
const provider = new PasarGuardClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
const useCase = new DirectServiceUseCase(
  repository,
  provider,
  () => new Date(),
  new ProvisioningModeGate({
    mode: config.provisioningMode,
    isolatedGroupId: config.isolatedGroupId,
  }),
);

try {
  await migrate(pool);
  const providerInstanceId = await repository.upsertProviderInstance(
    config.providerCode,
    config.baseUrl,
  );

  switch (commandValue) {
    case 'provider-health': {
      const health = await provider.health();
      writeJson({
        ok: health.ok,
        errorCode: health.errorCode ?? null,
        latencyMs: health.latencyMs,
      });
      break;
    }
    case 'sync-groups': {
      await useCase.syncGroups(providerInstanceId);
      writeJson({ status: 'groups-synced' });
      break;
    }
    case 'seed-variant': {
      requirePilotEnabled(config.pilotEnabled);
      requirePilotGroup(config.groupId);
      requirePilotGroupMatchesMode(config);
      const variantId = await repository.upsertPilotVariant({
        providerInstanceId,
        code: config.variantCode,
        name: config.variantName,
        groupIds: [config.groupId],
        durationDays: config.durationDays,
        dataLimitBytes: config.dataLimitBytes,
        deviceLimit: config.deviceLimit,
      });
      writeJson({ status: 'variant-ready', variantId });
      break;
    }
    case 'create': {
      requirePilotEnabled(config.pilotEnabled);
      const variantId = requiredArgument(arguments_[0]);
      const idempotencyKey = requiredArgument(arguments_[1]);
      const requestedUsername = arguments_[2];
      const service = await useCase.create({
        productVariantId: variantId,
        idempotencyKey,
        ...(requestedUsername === undefined ? {} : { requestedUsername }),
      });
      writeJson(redactService(service));
      break;
    }
    case 'get': {
      const serviceId = requiredArgument(arguments_[0]);
      const result = await useCase.get(serviceId);
      writeJson({
        ...redactService(result.binding),
        remoteStatus: result.remote.status,
        remoteExpiresAt: result.remote.expiresAt?.toISOString() ?? null,
        remoteGroupIds: result.remote.groupIds,
        subscriptionValidated: result.remote.subscriptionUrl.length > 0,
      });
      break;
    }
    case 'renew': {
      requirePilotEnabled(config.pilotEnabled);
      const serviceId = requiredArgument(arguments_[0]);
      const idempotencyKey = requiredArgument(arguments_[1]);
      const service = await useCase.renew({ serviceId, idempotencyKey });
      writeJson(redactService(service));
      break;
    }
  }
} catch (error: unknown) {
  writeJson({ status: 'error', errorCode: safeErrorCode(error) });
  process.exitCode = 1;
} finally {
  await pool.end();
}

function isPilotCommand(value: string | undefined): value is PilotCommand {
  return ['provider-health', 'sync-groups', 'seed-variant', 'create', 'get', 'renew'].includes(
    value ?? '',
  );
}

function requirePilotEnabled(enabled: boolean): void {
  if (!enabled) {
    throw new Error('PILOT_DISABLED');
  }
}

function requirePilotGroup(groupId: number): void {
  if (groupId <= 0) {
    throw new Error('PILOT_GROUP_NOT_SELECTED');
  }
}

function requirePilotGroupMatchesMode(config: PilotConfig): void {
  if (config.provisioningMode === 'isolated' && config.groupId !== config.isolatedGroupId) {
    throw new Error('PILOT_GROUP_MODE_MISMATCH');
  }
}

function requiredArgument(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error('MISSING_PILOT_ARGUMENT');
  }
  return value;
}

function redactService(service: ServiceBinding): Record<string, unknown> {
  return {
    serviceId: service.id,
    targetUserId: service.targetUserId,
    targetUsername: service.targetUsername,
    status: service.status,
    expiresAt: service.expiresAt?.toISOString() ?? null,
    subscriptionStored: service.subscriptionUrl.length > 0,
  };
}

function safeErrorCode(error: unknown): string {
  if (error instanceof PasarGuardError) {
    return error.code;
  }
  if (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)) {
    return error.message;
  }
  return 'PILOT_COMMAND_FAILED';
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
