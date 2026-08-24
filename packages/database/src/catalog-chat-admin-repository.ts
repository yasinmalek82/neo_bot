import type { CatalogChatAdminRepository } from '@neo-bot/application';
import {
  DomainConflictError,
  catalogVariantLabels,
  parseCatalogAdminDelta,
  parseSafeProviderGroupId,
  parseCatalogAdminWizardState,
  type CatalogAdminCategory,
  type CatalogAdminProductRow,
  type CatalogAdminReadModel,
  type CatalogAdminDelta,
  type CatalogAdminSession,
  type CatalogAdminPublicationResult,
  type CatalogAdminWizardState,
  type StorefrontSettings,
} from '@neo-bot/domain';
import type { Pool, PoolClient } from 'pg';

interface RevisionRow {
  revision: string;
}
interface SessionRow {
  id: string;
  admin_telegram_user_id: string;
  base_revision: string;
  state: unknown;
  status: 'pending' | 'canceled' | 'published' | 'expired';
  published_revision: string | null;
  published_result: unknown;
  expires_at: Date;
}

export class PostgresCatalogChatAdminRepository implements CatalogChatAdminRepository {
  public constructor(private readonly pool: Pool) {}

  public async getCatalogRevision(): Promise<number> {
    return asRevision(
      requiredRow(
        (
          await this.pool.query<RevisionRow>(
            'select revision::text from catalog_revisions where id = 1',
          )
        ).rows,
      ).revision,
    );
  }

  public async listAdminCategories(): Promise<readonly CatalogAdminCategory[]> {
    const result = await this.pool.query<CatalogAdminCategory>(
      `select id::text, code, name, description, position, active
       from product_categories
       where managed_by_admin = true
       order by position, id`,
    );
    return result.rows;
  }

  public async getCatalogAdminReadModel(): Promise<CatalogAdminReadModel> {
    const [categories, products, variants] = await Promise.all([
      this.listAdminCategories(),
      this.pool.query<CatalogAdminProductRow>(
        `select product.id::text, product.code, product.name, product.description, product.short_name as "shortName",
                product.badge, product.icon_key as "iconKey", assignment.position,
                category.id::text as "categoryId", category.code as "categoryCode", product.active
         from products product join product_category_assignments assignment on assignment.product_id = product.id
         join product_categories category on category.id = assignment.category_id
         where product.managed_by_admin = true order by assignment.position, product.id`,
      ),
      this.pool.query<{
        id: string;
        code: string;
        name: string;
        description: string;
        durationDays: number;
        dataLimitBytes: string;
        deviceLimit: number;
        priceIrr: string;
        position: number;
        productId: string;
        productCode: string;
        active: boolean;
        sellable: boolean;
        providerCode: string | null;
        groupIds: string[];
        displayAttributes: unknown;
      }>(
        `select variant.id::text, variant.code, variant.name, variant.description,
                variant.duration_days as "durationDays", variant.data_limit_bytes::text as "dataLimitBytes",
                variant.device_limit as "deviceLimit", variant.price_irr::text as "priceIrr", variant.position,
                product.id::text as "productId", product.code as "productCode",
                variant.active, variant.sellable, provider.code as "providerCode",
                coalesce(array_agg(groups.remote_group_id::text) filter (where groups.remote_group_id is not null), '{}') as "groupIds",
                coalesce((
                  select jsonb_agg(jsonb_build_object('position', attribute.position, 'label', attribute.label, 'value', attribute.value) order by attribute.position)
                  from product_variant_display_attributes attribute
                  where attribute.product_variant_id = variant.id
                ), '[]'::jsonb) as "displayAttributes"
         from product_variants variant join products product on product.id = variant.product_id
         left join provisioning_policies policy on policy.product_variant_id = variant.id
         left join provider_instances provider on provider.id = policy.provider_instance_id
         left join provisioning_policy_groups groups on groups.provisioning_policy_id = policy.id
         where product.managed_by_admin = true group by variant.id, product.id, provider.code
         order by product.id, variant.position, variant.id`,
      ),
    ]);
    return {
      categories,
      products: products.rows,
      variants: variants.rows.map((row) => ({
        ...row,
        dataLimitBytes: BigInt(row.dataLimitBytes),
        priceIrr: BigInt(row.priceIrr),
        groupIds: row.groupIds.map(parseSafeProviderGroupId),
        displayAttributes: mapDisplayAttributes(row.displayAttributes),
      })),
    };
  }

  public async createCatalogAdminSession(session: CatalogAdminSession): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update catalog_admin_sessions set status = 'expired'
         where admin_telegram_user_id = $1 and status = 'pending' and expires_at <= now()`,
        [session.adminTelegramUserId],
      );
      await client.query(
        `insert into catalog_admin_sessions(
           id, admin_telegram_user_id, base_revision, state, status, expires_at
         ) values ($1, $2, $3, $4::jsonb, 'pending', $5)`,
        [
          session.id,
          session.adminTelegramUserId,
          session.baseRevision,
          JSON.stringify(encodeCatalogAdminWizardState(session.state)),
          session.expiresAt,
        ],
      );
      await client.query('commit');
    } catch (error: unknown) {
      await client.query('rollback');
      if (isUniqueViolation(error)) throw new DomainConflictError('CATALOG_ADMIN_SESSION_ACTIVE');
      throw error;
    } finally {
      client.release();
    }
  }

  public async getCatalogAdminSession(input: {
    readonly id: string;
    readonly adminTelegramUserId: string;
  }): Promise<CatalogAdminSession | null> {
    const result = await this.pool.query<SessionRow>(
      `select id::text, admin_telegram_user_id::text, base_revision::text, state, status,
              published_revision::text, published_result, expires_at
       from catalog_admin_sessions
       where id = $1 and admin_telegram_user_id = $2`,
      [input.id, input.adminTelegramUserId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return mapSession(row);
  }

  public async getPendingCatalogAdminSession(
    adminTelegramUserId: string,
  ): Promise<CatalogAdminSession | null> {
    const result = await this.pool.query<SessionRow>(
      `select id::text, admin_telegram_user_id::text, base_revision::text, state, status,
              published_revision::text, published_result, expires_at
       from catalog_admin_sessions
       where admin_telegram_user_id = $1 and status = 'pending'
       order by created_at desc limit 1`,
      [adminTelegramUserId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapSession(row);
  }

  public async updateCatalogAdminSession(input: {
    readonly id: string;
    readonly adminTelegramUserId: string;
    readonly state: CatalogAdminWizardState;
    readonly now: Date;
  }): Promise<CatalogAdminSession> {
    const result = await this.pool.query<SessionRow>(
      `update catalog_admin_sessions set state = $3::jsonb
       where id = $1 and admin_telegram_user_id = $2 and status = 'pending' and expires_at > $4
       returning id::text, admin_telegram_user_id::text, base_revision::text, state, status,
         published_revision::text, published_result, expires_at`,
      [
        input.id,
        input.adminTelegramUserId,
        JSON.stringify(encodeCatalogAdminWizardState(input.state)),
        input.now,
      ],
    );
    return mapSession(requiredRow(result.rows));
  }

  public async cancelCatalogAdminSession(input: {
    readonly id: string;
    readonly adminTelegramUserId: string;
    readonly now: Date;
  }): Promise<void> {
    const result = await this.pool.query(
      `update catalog_admin_sessions set status = 'canceled'
       where id = $1 and admin_telegram_user_id = $2 and status = 'pending'`,
      [input.id, input.adminTelegramUserId],
    );
    if (result.rowCount !== 1) throw new DomainConflictError('CATALOG_ADMIN_SESSION_NOT_PENDING');
  }

  public async publishCatalogAdminSession(input: {
    readonly id: string;
    readonly adminTelegramUserId: string;
    readonly now: Date;
  }): Promise<CatalogAdminPublicationResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const session = requiredRow(
        (
          await client.query<SessionRow>(
            `select id::text, admin_telegram_user_id::text, base_revision::text, state, status,
                    published_revision::text, published_result, expires_at
         from catalog_admin_sessions
         where id = $1 and admin_telegram_user_id = $2
         for update`,
            [input.id, input.adminTelegramUserId],
          )
        ).rows,
      );
      if (session.status === 'published' && session.published_result !== null) {
        await client.query('commit');
        return decodePublishedResult(session.published_result);
      }
      if (session.status !== 'pending')
        throw new DomainConflictError('CATALOG_ADMIN_SESSION_NOT_PENDING');
      if (session.expires_at <= input.now) {
        await client.query("update catalog_admin_sessions set status = 'expired' where id = $1", [
          input.id,
        ]);
        throw new DomainConflictError('CATALOG_ADMIN_SESSION_EXPIRED');
      }
      const state = decodeCatalogAdminWizardState(session.state);
      if (state.kind !== 'review')
        throw new DomainConflictError('CATALOG_ADMIN_SESSION_INCOMPLETE');
      const delta = state.delta;
      const revision = requiredRow(
        (
          await client.query<RevisionRow>(
            'select revision::text from catalog_revisions where id = 1 for update',
          )
        ).rows,
      ).revision;
      if (revision !== session.base_revision)
        throw new DomainConflictError('CATALOG_REVISION_CONFLICT');
      await this.applyDelta(client, delta);
      const updated = requiredRow(
        (
          await client.query<RevisionRow>(
            `update catalog_revisions set revision = revision + 1, updated_at = now()
         where id = 1 returning revision::text`,
          )
        ).rows,
      ).revision;
      const result = { revision: asRevision(updated), delta };
      await client.query(
        `update catalog_admin_sessions set status = 'published', consumed_at = now(),
           published_revision = $2, published_result = $3::jsonb where id = $1`,
        [input.id, updated, JSON.stringify(encodePublishedResult(result))],
      );
      await client.query(
        `insert into catalog_publication_audit(
           admin_telegram_user_id, revision, action, entity_code, summary
         ) values ($1, $2, $3, $4, $5::jsonb)`,
        [
          input.adminTelegramUserId,
          updated,
          delta.kind,
          auditEntityCode(delta),
          JSON.stringify({ action: delta.kind }),
        ],
      );
      await client.query('commit');
      return result;
    } catch (error: unknown) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async applyDelta(client: PoolClient, delta: CatalogAdminDelta): Promise<void> {
    if (delta.kind === 'changeset') {
      for (const change of delta.changes) await this.applyDelta(client, change);
      return;
    }
    if (delta.kind === 'settings') return this.updateSettings(client, delta.settings);
    if (delta.kind === 'category') {
      await client.query(
        `insert into product_categories(code, name, description, position, active, managed_by_admin)
         values ($1, $2, $3, $4, true, true)
         on conflict (code) do update set name = excluded.name, description = excluded.description,
           position = excluded.position, active = product_categories.active,
           managed_by_admin = true, updated_at = now()`,
        [delta.code, delta.name.trim(), delta.description.trim(), delta.position],
      );
      return;
    }
    if (delta.kind === 'product') return this.upsertProduct(client, delta);
    if (delta.kind === 'variant') return this.upsertVariant(client, delta);
    if (delta.kind === 'reorder') return this.reorder(client, delta);
    await this.setArchiveState(client, delta.entity, delta.code, delta.kind === 'restore');
  }

  private async reorder(
    client: PoolClient,
    delta: Extract<CatalogAdminDelta, { readonly kind: 'reorder' }>,
  ): Promise<void> {
    const direction = delta.direction === 'up' ? -1 : 1;
    const source =
      delta.entity === 'category'
        ? {
            table: 'product_categories',
            id: 'id',
            code: 'code',
            position: 'position',
            scope: null,
            predicate: 'managed_by_admin = true',
          }
        : delta.entity === 'product'
          ? {
              table:
                'product_category_assignments assignment join products product on product.id = assignment.product_id',
              id: 'assignment.product_id',
              code: 'product.code',
              position: 'assignment.position',
              scope: 'assignment.category_id',
              predicate: 'product.managed_by_admin = true',
            }
          : {
              table:
                'product_variants variant join products product on product.id = variant.product_id',
              id: 'variant.id',
              code: 'variant.code',
              position: 'variant.position',
              scope: 'variant.product_id',
              predicate: 'product.managed_by_admin = true',
            };
    const selected = await client.query<{ id: string; position: number; scope_id: string | null }>(
      `select ${source.id}::text as id, ${source.position} as position,
              ${source.scope ?? 'null::bigint'}::text as scope_id
       from ${source.table} where ${source.code} = $1 and ${source.predicate} for update`,
      [delta.code],
    );
    const current = requiredRow(selected.rows);
    const neighbor = await client.query<{ id: string; position: number }>(
      `select ${source.id}::text as id, ${source.position} as position
       from ${source.table} where ${source.predicate}
         ${source.scope === null ? '' : `and ${source.scope} = $2::bigint`}
         and ${source.position} ${direction < 0 ? '<' : '>'} $1
       order by ${source.position} ${direction < 0 ? 'desc' : 'asc'}, ${source.id} ${direction < 0 ? 'desc' : 'asc'}
       limit 1 for update`,
      source.scope === null ? [current.position] : [current.position, current.scope_id],
    );
    const other = neighbor.rows[0];
    if (other === undefined) return;
    const target =
      delta.entity === 'category'
        ? { table: 'product_categories', id: 'id' }
        : delta.entity === 'product'
          ? { table: 'product_category_assignments', id: 'product_id' }
          : { table: 'product_variants', id: 'id' };
    await client.query(
      `update ${target.table} set position = case when ${target.id} = $1::bigint then $2 when ${target.id} = $3::bigint then $4 else position end${
        delta.entity === 'product' ? '' : ', updated_at = now()'
      } where ${target.id} = any($5::bigint[])`,
      [current.id, other.position, other.id, current.position, [current.id, other.id]],
    );
  }

  private async updateSettings(client: PoolClient, settings: StorefrontSettings): Promise<void> {
    await client.query(
      `update storefront_settings set brand_name = $1, hero_title = $2, hero_subtitle = $3,
         delivery_note = $4, support_note = $5, volume_helper = $6, card_number = $7,
         card_holder = $8, updated_at = now() where id = 1`,
      [
        settings.brandName.trim(),
        settings.heroTitle.trim(),
        settings.heroSubtitle.trim(),
        settings.deliveryNote.trim(),
        settings.supportNote.trim(),
        settings.volumeHelper.trim(),
        settings.cardNumber,
        settings.cardHolder.trim(),
      ],
    );
  }

  private async upsertProduct(
    client: PoolClient,
    delta: Extract<CatalogAdminDelta, { kind: 'product' }>,
  ): Promise<void> {
    const category = await client.query<{ id: string }>(
      `select id::text from product_categories
       where code = $1 and managed_by_admin = true`,
      [delta.categoryCode],
    );
    const categoryId = requiredRow(category.rows).id;
    const product = await client.query<{ id: string }>(
      `insert into products(code, name, short_name, description, badge, icon_key, active, managed_by_admin)
       values ($1, $2, $3, $4, $5, $6, $7, true)
       on conflict (code) do update set name = excluded.name, short_name = excluded.short_name,
         description = excluded.description, badge = excluded.badge, icon_key = excluded.icon_key,
         active = products.active, managed_by_admin = true, updated_at = now()
       returning id::text`,
      [
        delta.code,
        delta.name.trim(),
        delta.shortName.trim(),
        delta.description.trim(),
        delta.badge?.trim() ?? null,
        delta.iconKey,
        delta.active,
      ],
    );
    const productId = requiredRow(product.rows).id;
    await client.query('delete from product_category_assignments where product_id = $1', [
      productId,
    ]);
    await client.query(
      'insert into product_category_assignments(category_id, product_id, position) values ($1, $2, $3)',
      [categoryId, productId, delta.position],
    );
  }

  private async upsertVariant(
    client: PoolClient,
    delta: Extract<CatalogAdminDelta, { kind: 'variant' }>,
  ): Promise<void> {
    const product = await client.query<{ id: string }>(
      `select id::text from products where code = $1 and managed_by_admin = true`,
      [delta.productCode],
    );
    const productId = requiredRow(product.rows).id;
    const providerId = await this.requireProviderGroups(client, delta.providerCode, delta.groupIds);
    const labels = catalogVariantLabels(delta);
    const variant = await client.query<{ id: string; product_id: string }>(
      `insert into product_variants(product_id, code, name, description, duration_days, duration_label,
          data_limit_bytes, data_limit_label, device_limit, device_label, price_irr, position, active, sellable)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13)
       on conflict (code) do update set name = excluded.name, description = excluded.description,
         duration_days = excluded.duration_days, duration_label = excluded.duration_label,
         data_limit_bytes = excluded.data_limit_bytes, data_limit_label = excluded.data_limit_label,
         device_limit = excluded.device_limit, device_label = excluded.device_label, price_irr = excluded.price_irr,
         position = excluded.position, active = product_variants.active,
         sellable = excluded.sellable, updated_at = now()
       returning id::text, product_id::text`,
      [
        productId,
        delta.code,
        delta.name.trim(),
        delta.description.trim(),
        delta.durationDays,
        labels.durationLabel,
        delta.dataLimitBytes.toString(),
        labels.dataLimitLabel,
        delta.deviceLimit,
        labels.deviceLabel,
        delta.priceIrr.toString(),
        delta.position,
        delta.sellable,
      ],
    );
    const stored = requiredRow(variant.rows);
    if (stored.product_id !== productId)
      throw new DomainConflictError('VARIANT_CODE_PRODUCT_MISMATCH');
    const policy = await client.query<{ id: string }>(
      `insert into provisioning_policies(product_variant_id, provider_instance_id) values ($1, $2)
       on conflict (product_variant_id) do update set provider_instance_id = excluded.provider_instance_id,
         updated_at = now() returning id::text`,
      [stored.id, providerId],
    );
    const policyId = requiredRow(policy.rows).id;
    await client.query('delete from provisioning_policy_groups where provisioning_policy_id = $1', [
      policyId,
    ]);
    await client.query(
      `insert into provisioning_policy_groups(provisioning_policy_id, provider_instance_id, remote_group_id)
       select $1, $2, group_id from unnest($3::bigint[]) as selected(group_id)`,
      [policyId, providerId, delta.groupIds],
    );
    if (delta.displayAttributes !== undefined) {
      await client.query(
        'delete from product_variant_display_attributes where product_variant_id = $1',
        [stored.id],
      );
      for (const attribute of delta.displayAttributes) {
        await client.query(
          `insert into product_variant_display_attributes(product_variant_id, position, label, value)
           values ($1, $2, $3, $4)`,
          [stored.id, attribute.position, attribute.label.trim(), attribute.value.trim()],
        );
      }
    }
  }

  private async setArchiveState(
    client: PoolClient,
    entity: 'category' | 'product' | 'variant',
    code: string,
    restore: boolean,
  ): Promise<void> {
    if (entity === 'category') {
      const result = await client.query(
        `update product_categories set active = $2, managed_by_admin = true, updated_at = now()
         where code = $1 and managed_by_admin = true`,
        [code, restore],
      );
      if (result.rowCount !== 1) throw new DomainConflictError('CATEGORY_NOT_FOUND');
      if (!restore) {
        await client.query(
          `update products product set active = false, updated_at = now()
           from product_category_assignments assignment join product_categories category on category.id = assignment.category_id
           where assignment.product_id = product.id and category.code = $1 and product.managed_by_admin = true`,
          [code],
        );
        await client.query(
          `update product_variants variant set active = false, sellable = false, updated_at = now()
           from products product join product_category_assignments assignment on assignment.product_id = product.id
           join product_categories category on category.id = assignment.category_id
           where variant.product_id = product.id and category.code = $1 and product.managed_by_admin = true`,
          [code],
        );
      }
      return;
    }
    if (entity === 'product') {
      const result = await client.query(
        `update products set active = $2, managed_by_admin = true, updated_at = now()
         where code = $1 and managed_by_admin = true`,
        [code, restore],
      );
      if (result.rowCount !== 1) throw new DomainConflictError('PRODUCT_NOT_FOUND');
      if (!restore)
        await client.query(
          `update product_variants set active = false, sellable = false, updated_at = now()
         where product_id = (select id from products where code = $1)`,
          [code],
        );
      return;
    }
    if (restore) {
      const result = await client.query(
        `update product_variants variant set sellable = false, active = true, updated_at = now()
         from products product join product_category_assignments assignment on assignment.product_id = product.id
         join product_categories category on category.id = assignment.category_id
         where variant.code = $1 and variant.product_id = product.id and product.managed_by_admin = true
           and product.active = true and category.active = true and variant.price_irr > 0`,
        [code],
      );
      if (result.rowCount !== 1) throw new DomainConflictError('VARIANT_NOT_RESTORABLE');
      return;
    }
    const result = await client.query(
      `update product_variants variant set active = false, sellable = false, updated_at = now()
       from products product where variant.code = $1 and variant.product_id = product.id
         and product.managed_by_admin = true`,
      [code],
    );
    if (result.rowCount !== 1) throw new DomainConflictError('VARIANT_NOT_FOUND');
  }

  private async requireProviderGroups(
    client: PoolClient,
    providerCode: string,
    groupIds: readonly number[],
  ): Promise<string> {
    const result = await client.query<{ id: string; matching_groups: number }>(
      `select provider.id::text, count(groups.remote_group_id)::integer as matching_groups
       from provider_instances provider left join provider_groups groups
         on groups.provider_instance_id = provider.id and groups.remote_group_id = any($2::bigint[])
         and groups.available = true and groups.disabled = false
       where provider.code = $1 and provider.enabled = true group by provider.id`,
      [providerCode, groupIds],
    );
    const row = result.rows[0];
    if (row === undefined) throw new DomainConflictError('PROVIDER_NOT_FOUND');
    if (row.matching_groups !== groupIds.length)
      throw new DomainConflictError('PROVIDER_GROUP_NOT_AVAILABLE');
    return row.id;
  }
}

function encodeDelta(delta: CatalogAdminDelta): unknown {
  if (delta.kind === 'changeset') return { ...delta, changes: delta.changes.map(encodeDelta) };
  if (delta.kind !== 'variant') return delta;
  return {
    ...delta,
    dataLimitBytes: delta.dataLimitBytes.toString(),
    priceIrr: delta.priceIrr.toString(),
  };
}

export function encodeCatalogAdminWizardState(state: CatalogAdminWizardState): unknown {
  if (state.kind === 'review') return { ...state, delta: encodeDelta(state.delta) };
  if (state.kind === 'variant') {
    return {
      ...state,
      values: {
        ...state.values,
        ...(state.values.dataLimitBytes === undefined
          ? {}
          : { dataLimitBytes: state.values.dataLimitBytes.toString() }),
        ...(state.values.priceIrr === undefined
          ? {}
          : { priceIrr: state.values.priceIrr.toString() }),
      },
    };
  }
  if (state.kind === 'changeset') {
    return {
      ...state,
      values: {
        ...state.values,
        ...(state.values.dataLimitBytes === undefined
          ? {}
          : { dataLimitBytes: state.values.dataLimitBytes.toString() }),
        ...(state.values.priceIrr === undefined
          ? {}
          : { priceIrr: state.values.priceIrr.toString() }),
      },
    };
  }
  return state;
}
export function decodeCatalogAdminWizardState(value: unknown): CatalogAdminWizardState {
  const raw = requireRecord(value);
  const decoded =
    raw['kind'] === 'review'
      ? { ...raw, delta: decodeDelta(raw['delta']) }
      : raw['kind'] === 'variant'
        ? { ...raw, values: decodePartialVariantValues(raw['values']) }
        : raw['kind'] === 'changeset'
          ? { ...raw, values: decodePartialVariantValues(raw['values']) }
          : raw;
  return parseCatalogAdminWizardState(decoded);
}
function decodePartialVariantValues(value: unknown): Record<string, unknown> {
  const raw = requireRecord(value);
  const decoded = { ...raw };
  for (const field of ['dataLimitBytes', 'priceIrr'] as const) {
    const item = raw[field];
    if (typeof item === 'string' && /^\d+$/u.test(item)) decoded[field] = BigInt(item);
  }
  return decoded;
}
function decodeDelta(value: unknown): CatalogAdminDelta {
  const raw = requireRecord(value);
  if (raw['kind'] === 'changeset' && Array.isArray(raw['changes'])) {
    return parseCatalogAdminDelta({ ...raw, changes: raw['changes'].map(decodeDelta) });
  }
  const decoded =
    raw['kind'] === 'variant' &&
    typeof raw['dataLimitBytes'] === 'string' &&
    typeof raw['priceIrr'] === 'string' &&
    /^\d+$/u.test(raw['dataLimitBytes']) &&
    /^\d+$/u.test(raw['priceIrr'])
      ? { ...raw, dataLimitBytes: BigInt(raw['dataLimitBytes']), priceIrr: BigInt(raw['priceIrr']) }
      : raw;
  return parseCatalogAdminDelta(decoded);
}

function mapSession(row: SessionRow): CatalogAdminSession {
  return {
    id: row.id,
    adminTelegramUserId: row.admin_telegram_user_id,
    baseRevision: asRevision(row.base_revision),
    state: decodeCatalogAdminWizardState(row.state),
    status: row.status,
    expiresAt: row.expires_at,
    publishedResult:
      row.published_result === null ? null : decodePublishedResult(row.published_result),
  };
}
function encodePublishedResult(result: CatalogAdminPublicationResult): unknown {
  return { revision: result.revision, delta: encodeDelta(result.delta) };
}
function decodePublishedResult(value: unknown): CatalogAdminPublicationResult {
  const raw = requireRecord(value);
  const revision = raw['revision'];
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision))
    throw new DomainConflictError('INVALID_CATALOG_PUBLICATION_RESULT');
  return { revision, delta: decodeDelta(raw['delta']) };
}

function mapDisplayAttributes(
  value: unknown,
): readonly { position: number; label: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = item as Record<string, unknown>;
    if (
      typeof item !== 'object' ||
      item === null ||
      !('position' in record) ||
      !('label' in record) ||
      !('value' in record) ||
      !Number.isInteger(record['position']) ||
      typeof record['label'] !== 'string' ||
      typeof record['value'] !== 'string'
    ) {
      return [];
    }
    return [
      { position: record['position'] as number, label: record['label'], value: record['value'] },
    ];
  });
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DomainConflictError('INVALID_CATALOG_ADMIN_SESSION');
  return value as Record<string, unknown>;
}
function auditEntityCode(delta: CatalogAdminDelta): string | null {
  if (delta.kind === 'settings' || delta.kind === 'changeset') return null;
  return delta.code;
}
function asRevision(value: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) throw new DomainConflictError('INVALID_CATALOG_REVISION');
  return revision;
}
function requiredRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new DomainConflictError('DATABASE_ROW_NOT_FOUND');
  return row;
}
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
