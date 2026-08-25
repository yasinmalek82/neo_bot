import type { ProvisioningRepository, ReservedOperation } from '@neo-bot/application';
import type {
  DirectProductVariant,
  ProviderGroup,
  ProvisioningOperation,
  ProvisioningOperationStatus,
  ProvisioningOperationType,
  ProviderUserStatus,
  ServiceBinding,
} from '@neo-bot/domain';
import { DomainConflictError } from '@neo-bot/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

interface VariantRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  duration_days: number;
  data_limit_bytes: string;
  device_limit: number;
  provider_instance_id: string;
  active: boolean;
  group_ids: string[];
}

interface OperationRow extends QueryResultRow {
  id: string;
  operation_type: ProvisioningOperationType;
  idempotency_key: string;
  request_hash: string;
  status: ProvisioningOperationStatus;
  candidate_username: string | null;
  attempt_count: number;
  reconciliation_state: ProvisioningOperation['reconciliationState'];
  requested_expires_at: Date | null;
  requested_data_limit_bytes: string | null;
  requested_status: ProviderUserStatus | null;
  service_id: string | null;
  remote_user_id: string | null;
  error_code: string | null;
}

interface ServiceRow extends QueryResultRow {
  id: string;
  product_variant_id: string;
  provider_instance_id: string;
  target_user_id: string;
  target_username: string;
  status: ProviderUserStatus;
  expires_at: Date | null;
  subscription_url: string;
}

export class PostgresProvisioningRepository implements ProvisioningRepository {
  public constructor(private readonly pool: Pool) {}

  public async upsertProviderInstance(code: string, baseUrl: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `insert into provider_instances(code, provider_kind, base_url)
       values ($1, 'pasarguard', $2)
       on conflict (code) do update
       set base_url = excluded.base_url, enabled = true, updated_at = now()
       returning id::text as id`,
      [code, baseUrl],
    );
    return requiredRow(result.rows).id;
  }

  public async upsertPilotVariant(input: {
    readonly providerInstanceId: string;
    readonly code: string;
    readonly name: string;
    readonly groupIds: readonly number[];
    readonly durationDays: number;
    readonly dataLimitBytes: bigint;
    readonly deviceLimit: number;
  }): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const product = await client.query<{ id: string }>(
        `insert into products(code, name)
         values ('pilot-direct', 'Pilot direct service')
         on conflict (code) do update set name = excluded.name, active = true, updated_at = now()
         returning id::text as id`,
      );
      const variant = await client.query<{ id: string }>(
        `insert into product_variants(
           product_id, code, name, duration_days, data_limit_bytes, device_limit
         ) values ($1, $2, $3, $4, $5, $6)
         on conflict (code) do update set
           name = excluded.name,
           duration_days = excluded.duration_days,
           data_limit_bytes = excluded.data_limit_bytes,
           device_limit = excluded.device_limit,
           active = true,
           updated_at = now()
         returning id::text as id`,
        [
          requiredRow(product.rows).id,
          input.code,
          input.name,
          input.durationDays,
          input.dataLimitBytes.toString(),
          input.deviceLimit,
        ],
      );
      const policy = await client.query<{ id: string }>(
        `insert into provisioning_policies(product_variant_id, provider_instance_id)
         values ($1, $2)
         on conflict (product_variant_id) do update set
           provider_instance_id = excluded.provider_instance_id,
           updated_at = now()
         returning id::text as id`,
        [requiredRow(variant.rows).id, input.providerInstanceId],
      );
      const policyId = requiredRow(policy.rows).id;
      await client.query(
        'delete from provisioning_policy_groups where provisioning_policy_id = $1',
        [policyId],
      );
      for (const groupId of input.groupIds) {
        await client.query(
          `insert into provisioning_policy_groups(
             provisioning_policy_id, provider_instance_id, remote_group_id
           ) values ($1, $2, $3)`,
          [policyId, input.providerInstanceId, groupId],
        );
      }
      await client.query('commit');
      return requiredRow(variant.rows).id;
    } catch (error: unknown) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  public async getProductVariant(id: string): Promise<DirectProductVariant | null> {
    const result = await this.pool.query<VariantRow>(
      `select
         v.id::text,
         v.code,
         v.name,
         v.duration_days,
         v.data_limit_bytes::text,
         v.device_limit,
         p.provider_instance_id::text,
         v.active and product.active and provider.enabled as active,
         coalesce(array_agg(g.remote_group_id::text order by g.remote_group_id)
           filter (where g.remote_group_id is not null), '{}') as group_ids
       from product_variants v
       join products product on product.id = v.product_id
       join provisioning_policies p on p.product_variant_id = v.id
       join provider_instances provider on provider.id = p.provider_instance_id
       left join provisioning_policy_groups g on g.provisioning_policy_id = p.id
       where v.id = $1
       group by v.id, product.active, p.provider_instance_id, provider.enabled`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapVariant(row);
  }

  public async groupsExist(
    providerInstanceId: string,
    groupIds: readonly number[],
  ): Promise<boolean> {
    const result = await this.pool.query<{ count: string }>(
      `select count(*)::text as count
       from provider_groups
       where provider_instance_id = $1
         and remote_group_id = any($2::bigint[])
         and available = true
         and disabled = false`,
      [providerInstanceId, groupIds],
    );
    return Number(requiredRow(result.rows).count) === new Set(groupIds).size;
  }

  public async replaceGroupSnapshots(
    providerInstanceId: string,
    groups: readonly ProviderGroup[],
    syncedAt: Date,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        'update provider_groups set available = false, synced_at = $2 where provider_instance_id = $1',
        [providerInstanceId, syncedAt],
      );
      for (const group of groups) {
        await client.query(
          `insert into provider_groups(
             provider_instance_id, remote_group_id, name, disabled, available, inbound_tags, synced_at
           ) values ($1, $2, $3, $4, true, $5, $6)
           on conflict (provider_instance_id, remote_group_id) do update set
             name = excluded.name,
             disabled = excluded.disabled,
             available = true,
             inbound_tags = excluded.inbound_tags,
             synced_at = excluded.synced_at`,
          [providerInstanceId, group.id, group.name, group.disabled, group.inboundTags, syncedAt],
        );
      }
      await client.query('commit');
    } catch (error: unknown) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  public async reserveOperation(
    type: ProvisioningOperationType,
    idempotencyKey: string,
    requestHash: string,
    serviceId?: string,
  ): Promise<ReservedOperation> {
    const inserted = await this.pool.query<OperationRow>(
      `insert into provisioning_operations(
         operation_type, idempotency_key, request_hash, service_id
       ) values ($1, $2, $3, $4)
       on conflict (operation_type, idempotency_key) do nothing
       returning ${operationColumns}`,
      [type, idempotencyKey, requestHash, serviceId ?? null],
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow !== undefined) {
      return { outcome: 'reserved', operation: mapOperation(insertedRow) };
    }
    const existing = await this.pool.query<OperationRow>(
      `select ${operationColumns}
       from provisioning_operations
       where operation_type = $1 and idempotency_key = $2`,
      [type, idempotencyKey],
    );
    return { outcome: 'existing', operation: mapOperation(requiredRow(existing.rows)) };
  }

  public async completeCreate(
    operationId: string,
    variant: DirectProductVariant,
    remote: {
      readonly id: number;
      readonly username: string;
      readonly status: ProviderUserStatus;
      readonly expiresAt: Date | null;
      readonly dataLimitBytes: bigint;
      readonly groupIds: readonly number[];
      readonly subscriptionUrl: string;
    },
  ): Promise<ServiceBinding> {
    return this.withTransaction(async (client) => {
      const operation = await this.lockOperation(client, operationId);
      if (operation.status === 'completed' && operation.service_id !== null) {
        return this.requiredServiceWithClient(client, operation.service_id);
      }
      if (
        operation.candidate_username !== null &&
        operation.candidate_username !== remote.username
      ) {
        throw new DomainConflictError('CREATE_CANDIDATE_MISMATCH');
      }
      if (
        operation.requested_expires_at !== null &&
        (operation.requested_expires_at.getTime() !== (remote.expiresAt?.getTime() ?? NaN) ||
          operation.requested_data_limit_bytes !== remote.dataLimitBytes.toString() ||
          operation.requested_status !== remote.status ||
          !sameGroupIds(remote.groupIds, variant.groupIds))
      ) {
        throw new DomainConflictError('CREATE_REMOTE_POSTCONDITION_FAILED');
      }
      const service = await client.query<ServiceRow>(
        `insert into services(
           product_variant_id, provider_instance_id, target_user_id, target_username,
           status, expires_at, subscription_url
         ) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (provider_instance_id, target_user_id) do update set
           status = excluded.status,
           expires_at = excluded.expires_at,
           subscription_url = excluded.subscription_url,
           updated_at = now()
         returning ${serviceColumns}`,
        [
          variant.id,
          variant.providerInstanceId,
          remote.id,
          remote.username,
          remote.status,
          remote.expiresAt,
          remote.subscriptionUrl,
        ],
      );
      const binding = mapService(requiredRow(service.rows));
      await client.query(
        `update provisioning_operations
         set status = 'completed', service_id = $2, remote_user_id = $3,
             reconciliation_state = 'reconciled', error_code = null, updated_at = now()
         where id = $1`,
        [operationId, binding.id, remote.id],
      );
      return binding;
    });
  }

  public async completeRenew(
    operationId: string,
    serviceId: string,
    remote: {
      readonly status: ProviderUserStatus;
      readonly expiresAt: Date | null;
      readonly dataLimitBytes: bigint;
      readonly subscriptionUrl: string;
    },
  ): Promise<ServiceBinding> {
    return this.withTransaction(async (client) => {
      const operation = await this.lockOperation(client, operationId);
      if (operation.status === 'completed') {
        return this.requiredServiceWithClient(client, serviceId);
      }
      if (
        operation.requested_expires_at !== null &&
        (operation.requested_expires_at.getTime() !== (remote.expiresAt?.getTime() ?? NaN) ||
          operation.requested_data_limit_bytes !== remote.dataLimitBytes.toString() ||
          operation.requested_status !== remote.status)
      ) {
        throw new DomainConflictError('RENEW_REMOTE_POSTCONDITION_FAILED');
      }
      const service = await client.query<ServiceRow>(
        `update services
         set status = $2, expires_at = $3, subscription_url = $4, updated_at = now()
         where id = $1
         returning ${serviceColumns}`,
        [serviceId, remote.status, remote.expiresAt, remote.subscriptionUrl],
      );
      const binding = mapService(requiredRow(service.rows));
      await client.query(
        `update provisioning_operations
         set status = 'completed', service_id = $2, remote_user_id = $3,
             reconciliation_state = 'reconciled', error_code = null, updated_at = now()
         where id = $1`,
        [operationId, serviceId, binding.targetUserId],
      );
      return binding;
    });
  }

  public async markOperationFailed(operationId: string, errorCode: string): Promise<void> {
    await this.pool.query(
      `update provisioning_operations
       set status = 'failed', reconciliation_state = 'not_required', error_code = $2, updated_at = now()
       where id = $1 and status <> 'completed'`,
      [operationId, errorCode],
    );
  }

  public async markOperationPending(operationId: string, errorCode: string): Promise<void> {
    await this.pool.query(
      `update provisioning_operations
       set status = 'pending', reconciliation_state = 'reconciliation_required',
           error_code = $2, updated_at = now()
       where id = $1 and status <> 'completed'`,
      [operationId, errorCode],
    );
  }

  public async getService(id: string): Promise<ServiceBinding | null> {
    const result = await this.pool.query<ServiceRow>(
      `select ${serviceColumns} from services where id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapService(row);
  }

  public async persistCreateCandidate(
    operationId: string,
    username: string,
    requestedExpiresAt: Date,
    requestedDataLimitBytes: bigint,
    requestedStatus: ProviderUserStatus,
  ): Promise<ProvisioningOperation> {
    const result = await this.pool.query<OperationRow>(
      `update provisioning_operations
       set candidate_username = $2, reconciliation_state = 'candidate_persisted',
           requested_expires_at = $3, requested_data_limit_bytes = $4,
           requested_status = $5, error_code = null, updated_at = now()
       where id = $1
         and operation_type = 'create'
         and status = 'pending'
         and candidate_username is null
         and attempt_count = 0
         and reconciliation_state = 'not_required'
       returning ${operationColumns}`,
      [
        operationId,
        username,
        requestedExpiresAt,
        requestedDataLimitBytes.toString(),
        requestedStatus,
      ],
    );
    const row = result.rows[0];
    return row === undefined ? this.requiredOperation(operationId) : mapOperation(row);
  }

  public async replaceCreateCandidateAfterCollision(
    operationId: string,
    expectedUsername: string,
    username: string,
  ): Promise<ProvisioningOperation> {
    const result = await this.pool.query<OperationRow>(
      `update provisioning_operations
       set candidate_username = $3, reconciliation_state = 'candidate_persisted',
           error_code = null, updated_at = now()
       where id = $1
         and operation_type = 'create'
         and status = 'pending'
         and candidate_username = $2
         and reconciliation_state in ('candidate_persisted', 'attempting')
       returning ${operationColumns}`,
      [operationId, expectedUsername, username],
    );
    const row = result.rows[0];
    return row === undefined ? this.requiredOperation(operationId) : mapOperation(row);
  }

  public async beginCreateAttempt(operationId: string): Promise<ReservedOperation> {
    const started = await this.pool.query<OperationRow>(
      `update provisioning_operations
       set attempt_count = attempt_count + 1, reconciliation_state = 'attempting',
           error_code = null, updated_at = now()
       where id = $1
         and operation_type = 'create'
         and status = 'pending'
         and candidate_username is not null
         and reconciliation_state = 'candidate_persisted'
       returning ${operationColumns}`,
      [operationId],
    );
    const row = started.rows[0];
    if (row !== undefined) {
      return { outcome: 'reserved', operation: mapOperation(row) };
    }
    return { outcome: 'existing', operation: await this.requiredOperation(operationId) };
  }

  public async beginRenewAttempt(
    operationId: string,
    requestedExpiresAt: Date,
    requestedDataLimitBytes: bigint,
    requestedStatus: ProviderUserStatus,
  ): Promise<ReservedOperation> {
    const started = await this.pool.query<OperationRow>(
      `update provisioning_operations
       set attempt_count = attempt_count + 1, reconciliation_state = 'attempting',
           requested_expires_at = $2, requested_data_limit_bytes = $3,
           requested_status = $4, error_code = null, updated_at = now()
       where id = $1
         and operation_type = 'renew'
         and status = 'pending'
         and reconciliation_state = 'not_required'
       returning ${operationColumns}`,
      [operationId, requestedExpiresAt, requestedDataLimitBytes.toString(), requestedStatus],
    );
    const row = started.rows[0];
    if (row !== undefined) {
      return { outcome: 'reserved', operation: mapOperation(row) };
    }
    return { outcome: 'existing', operation: await this.requiredOperation(operationId) };
  }

  private async lockOperation(client: PoolClient, id: string): Promise<OperationRow> {
    const result = await client.query<OperationRow>(
      `select ${operationColumns} from provisioning_operations where id = $1 for update`,
      [id],
    );
    return requiredRow(result.rows);
  }

  private async requiredOperation(id: string): Promise<ProvisioningOperation> {
    const result = await this.pool.query<OperationRow>(
      `select ${operationColumns} from provisioning_operations where id = $1`,
      [id],
    );
    return mapOperation(requiredRow(result.rows));
  }

  private async requiredServiceWithClient(client: PoolClient, id: string): Promise<ServiceBinding> {
    const result = await client.query<ServiceRow>(
      `select ${serviceColumns} from services where id = $1`,
      [id],
    );
    return mapService(requiredRow(result.rows));
  }

  private async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const value = await work(client);
      await client.query('commit');
      return value;
    } catch (error: unknown) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

const operationColumns = `
  id::text,
  operation_type,
  idempotency_key,
  request_hash,
  status,
  candidate_username,
  attempt_count,
  reconciliation_state,
  requested_expires_at,
  requested_data_limit_bytes::text,
  requested_status,
  service_id::text,
  remote_user_id::text,
  error_code
`;

const serviceColumns = `
  id::text,
  product_variant_id::text,
  provider_instance_id::text,
  target_user_id::text,
  target_username,
  status,
  expires_at,
  subscription_url
`;

function requiredRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('DATABASE_ROW_NOT_FOUND');
  }
  return row;
}

function mapVariant(row: VariantRow): DirectProductVariant {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    durationDays: row.duration_days,
    dataLimitBytes: BigInt(row.data_limit_bytes),
    deviceLimit: row.device_limit,
    providerInstanceId: row.provider_instance_id,
    groupIds: row.group_ids.map(Number),
    active: row.active,
  };
}

function mapOperation(row: OperationRow): ProvisioningOperation {
  return {
    id: row.id,
    type: row.operation_type,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    status: row.status,
    candidateUsername: row.candidate_username,
    attemptCount: row.attempt_count,
    reconciliationState: row.reconciliation_state,
    requestedExpiresAt: row.requested_expires_at,
    requestedDataLimitBytes:
      row.requested_data_limit_bytes === null ? null : BigInt(row.requested_data_limit_bytes),
    requestedStatus: row.requested_status,
    serviceId: row.service_id,
    remoteUserId: row.remote_user_id === null ? null : Number(row.remote_user_id),
    errorCode: row.error_code,
  };
}

function mapService(row: ServiceRow): ServiceBinding {
  return {
    id: row.id,
    productVariantId: row.product_variant_id,
    providerInstanceId: row.provider_instance_id,
    targetUserId: Number(row.target_user_id),
    targetUsername: row.target_username,
    status: row.status,
    expiresAt: row.expires_at,
    subscriptionUrl: row.subscription_url,
  };
}

function sameGroupIds(left: readonly number[], right: readonly number[]): boolean {
  const actual = [...left].sort((first, second) => first - second);
  const expected = [...right].sort((first, second) => first - second);
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}
