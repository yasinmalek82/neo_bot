import type { CatalogRepository } from '@neo-bot/application';
import {
  DomainConflictError,
  parseSafeProviderGroupId,
  type ProviderGroupChoice,
  type ReplaceStorefrontCatalogCommand,
  type StorefrontCatalog,
  type StorefrontIconKey,
  type StorefrontProduct,
  type StorefrontSettings,
  type StorefrontVariant,
} from '@neo-bot/domain';
import type { Pool, PoolClient } from 'pg';

interface SettingsRow {
  brand_name: string;
  hero_title: string;
  hero_subtitle: string;
  delivery_note: string;
  support_note: string;
  volume_helper: string;
  card_number: string;
  card_holder: string;
  updated_at: Date;
}

interface ProductRow {
  id: string;
  code: string;
  name: string;
  short_name: string;
  description: string;
  badge: string | null;
  icon_key: StorefrontIconKey;
  active: boolean;
  product_position: number;
  category_code: string;
  category_name: string;
  category_description: string;
  category_position: number;
  updated_at: Date;
}

interface VariantRow {
  id: string;
  product_id: string;
  code: string;
  name: string;
  description: string;
  duration_days: number;
  duration_label: string;
  data_limit_bytes: string;
  data_limit_label: string;
  device_limit: number;
  device_label: string;
  price_irr: string;
  position: number;
  sellable: boolean;
  provider_code: string | null;
  group_ids: string[];
  updated_at: Date;
}

interface ProviderGroupRow {
  provider_code: string;
  group_id: string;
  name: string;
  available: boolean;
  disabled: boolean;
}

export class PostgresCatalogRepository implements CatalogRepository {
  public constructor(private readonly pool: Pool) {}

  public getPublicCatalog(): Promise<StorefrontCatalog> {
    return this.getCatalog(false);
  }

  public getAdminCatalog(): Promise<StorefrontCatalog> {
    return this.getCatalog(true);
  }

  public async listProviderGroups(): Promise<readonly ProviderGroupChoice[]> {
    const result = await this.pool.query<ProviderGroupRow>(
      `select provider.code as provider_code, groups.remote_group_id::text as group_id,
              groups.name, groups.available, groups.disabled
       from provider_groups groups
       join provider_instances provider on provider.id = groups.provider_instance_id
       where provider.enabled = true
       order by provider.code, groups.name, groups.remote_group_id`,
    );
    return result.rows.map((row) => ({
      providerCode: row.provider_code,
      groupId: parseSafeProviderGroupId(row.group_id),
      name: row.name,
      available: row.available,
      disabled: row.disabled,
    }));
  }

  public async replaceCatalog(
    command: ReplaceStorefrontCatalogCommand,
  ): Promise<StorefrontCatalog> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select revision from catalog_revisions where id = 1 for update');
      await client.query(
        `update storefront_settings set
           brand_name = $1,
           hero_title = $2,
           hero_subtitle = $3,
           delivery_note = $4,
           support_note = $5,
           volume_helper = $6,
           card_number = $7,
           card_holder = $8,
           updated_at = now()
         where id = 1`,
        [
          command.settings.brandName.trim(),
          command.settings.heroTitle.trim(),
          command.settings.heroSubtitle.trim(),
          command.settings.deliveryNote.trim(),
          command.settings.supportNote.trim(),
          command.settings.volumeHelper.trim(),
          command.settings.cardNumber,
          command.settings.cardHolder.trim(),
        ],
      );

      await client.query(
        `update product_categories
         set active = false, managed_by_admin = false, updated_at = now()
         where managed_by_admin = true`,
      );
      await client.query(
        `update product_variants variant
         set active = false, sellable = false, updated_at = now()
         from products product
         where variant.product_id = product.id and product.managed_by_admin = true`,
      );
      await client.query(
        `update products
         set active = false, managed_by_admin = false, updated_at = now()
         where managed_by_admin = true`,
      );

      const categoryIds = new Map<string, string>();
      for (const product of command.products) {
        if (!categoryIds.has(product.category.code)) {
          const category = await client.query<{ id: string }>(
            `insert into product_categories(
               code, name, description, position, active, managed_by_admin
             ) values ($1, $2, $3, $4, true, true)
             on conflict (code) do update set
               name = excluded.name,
               description = excluded.description,
               position = excluded.position,
               active = true,
               managed_by_admin = true,
               updated_at = now()
             returning id::text`,
            [
              product.category.code,
              product.category.name.trim(),
              product.category.description.trim(),
              product.category.position,
            ],
          );
          categoryIds.set(product.category.code, requiredRow(category.rows).id);
        }
      }

      for (const product of command.products) {
        const productResult = await client.query<{ id: string }>(
          `insert into products(
             code, name, short_name, description, badge, icon_key, active, managed_by_admin
           ) values ($1, $2, $3, $4, $5, $6, $7, true)
           on conflict (code) do update set
             name = excluded.name,
             short_name = excluded.short_name,
             description = excluded.description,
             badge = excluded.badge,
             icon_key = excluded.icon_key,
             active = excluded.active,
             managed_by_admin = true,
             updated_at = now()
           returning id::text`,
          [
            product.code,
            product.name.trim(),
            product.shortName.trim(),
            product.description.trim(),
            product.badge?.trim() ?? null,
            product.iconKey,
            product.active,
          ],
        );
        const productId = requiredRow(productResult.rows).id;
        const categoryId = categoryIds.get(product.category.code);
        if (categoryId === undefined) throw new DomainConflictError('CATEGORY_NOT_FOUND');
        await client.query('delete from product_category_assignments where product_id = $1', [
          productId,
        ]);
        await client.query(
          `insert into product_category_assignments(category_id, product_id, position)
           values ($1, $2, $3)`,
          [categoryId, productId, product.position],
        );

        for (const variant of product.variants) {
          const providerId = await this.requireProviderGroups(
            client,
            variant.providerCode,
            variant.groupIds,
          );
          const variantResult = await client.query<{ id: string; product_id: string }>(
            `insert into product_variants(
               product_id, code, name, description, duration_days, duration_label,
               data_limit_bytes, data_limit_label, device_limit, device_label,
               price_irr, position, active, sellable
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13)
             on conflict (code) do update set
               name = excluded.name,
               description = excluded.description,
               duration_days = excluded.duration_days,
               duration_label = excluded.duration_label,
               data_limit_bytes = excluded.data_limit_bytes,
               data_limit_label = excluded.data_limit_label,
               device_limit = excluded.device_limit,
               device_label = excluded.device_label,
               price_irr = excluded.price_irr,
               position = excluded.position,
               active = true,
               sellable = excluded.sellable,
               updated_at = now()
             returning id::text, product_id::text`,
            [
              productId,
              variant.code,
              variant.name.trim(),
              variant.description.trim(),
              variant.durationDays,
              variant.durationLabel.trim(),
              variant.dataLimitBytes.toString(),
              variant.dataLimitLabel.trim(),
              variant.deviceLimit,
              variant.deviceLabel.trim(),
              variant.priceIrr.toString(),
              variant.position,
              variant.sellable,
            ],
          );
          const storedVariant = requiredRow(variantResult.rows);
          if (storedVariant.product_id !== productId) {
            throw new DomainConflictError('VARIANT_CODE_PRODUCT_MISMATCH');
          }

          const policyResult = await client.query<{ id: string }>(
            `insert into provisioning_policies(product_variant_id, provider_instance_id)
             values ($1, $2)
             on conflict (product_variant_id) do update set
               provider_instance_id = excluded.provider_instance_id,
               updated_at = now()
             returning id::text`,
            [storedVariant.id, providerId],
          );
          const policyId = requiredRow(policyResult.rows).id;
          await client.query(
            'delete from provisioning_policy_groups where provisioning_policy_id = $1',
            [policyId],
          );
          await client.query(
            `insert into provisioning_policy_groups(
               provisioning_policy_id, provider_instance_id, remote_group_id
             )
             select $1, $2, group_id
             from unnest($3::bigint[]) as selected(group_id)`,
            [policyId, providerId, variant.groupIds],
          );
        }
      }

      await client.query(
        'update catalog_revisions set revision = revision + 1, updated_at = now() where id = 1',
      );

      await client.query('commit');
    } catch (error: unknown) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return this.getAdminCatalog();
  }

  private async getCatalog(includeInactive: boolean): Promise<StorefrontCatalog> {
    const [settingsResult, productsResult, variantsResult] = await Promise.all([
      this.pool.query<SettingsRow>(
        `select brand_name, hero_title, hero_subtitle, delivery_note, support_note,
                volume_helper, card_number, card_holder, updated_at
         from storefront_settings where id = 1`,
      ),
      this.pool.query<ProductRow>(
        `select product.id::text, product.code, product.name, product.short_name,
                product.description, product.badge, product.icon_key, product.active,
                assignment.position as product_position,
                category.code as category_code, category.name as category_name,
                category.description as category_description,
                category.position as category_position,
                greatest(product.updated_at, category.updated_at) as updated_at
         from products product
         join lateral (
           select selected.category_id, selected.position
           from product_category_assignments selected
           where selected.product_id = product.id
           order by selected.position, selected.category_id
           limit 1
         ) assignment on true
         join product_categories category on category.id = assignment.category_id
         where product.managed_by_admin = true
           and ($1::boolean or (product.active = true and category.active = true))
         order by assignment.position, product.id`,
        [includeInactive],
      ),
      this.pool.query<VariantRow>(
        `select variant.id::text, variant.product_id::text, variant.code, variant.name,
                variant.description, variant.duration_days, variant.duration_label,
                variant.data_limit_bytes::text, variant.data_limit_label,
                variant.device_limit, variant.device_label, variant.price_irr::text,
                variant.position, variant.sellable, provider.code as provider_code,
                coalesce(
                  array_agg(policy_group.remote_group_id::text order by policy_group.remote_group_id)
                    filter (where policy_group.remote_group_id is not null),
                  '{}'
                ) as group_ids,
                variant.updated_at
         from product_variants variant
         join products product on product.id = variant.product_id
         left join provisioning_policies policy on policy.product_variant_id = variant.id
         left join provider_instances provider on provider.id = policy.provider_instance_id
         left join provisioning_policy_groups policy_group
           on policy_group.provisioning_policy_id = policy.id
         where product.managed_by_admin = true
           and variant.active = true
           and (
             $1::boolean or (
               product.active = true and variant.sellable = true and variant.price_irr > 0
             )
           )
         group by variant.id, provider.code
         order by variant.product_id, variant.position, variant.id`,
        [includeInactive],
      ),
    ]);
    const settingsRow = requiredRow(settingsResult.rows);
    const variantsByProduct = new Map<string, StorefrontVariant[]>();
    let updatedAt = settingsRow.updated_at;
    for (const row of variantsResult.rows) {
      const variants = variantsByProduct.get(row.product_id) ?? [];
      variants.push(mapVariant(row));
      variantsByProduct.set(row.product_id, variants);
      if (row.updated_at > updatedAt) updatedAt = row.updated_at;
    }
    const products: StorefrontProduct[] = [];
    for (const row of productsResult.rows) {
      const variants = variantsByProduct.get(row.id) ?? [];
      if (!includeInactive && variants.length === 0) continue;
      products.push(mapProduct(row, variants));
      if (row.updated_at > updatedAt) updatedAt = row.updated_at;
    }
    return { settings: mapSettings(settingsRow), products, updatedAt };
  }

  private async requireProviderGroups(
    client: PoolClient,
    providerCode: string,
    groupIds: readonly number[],
  ): Promise<string> {
    const result = await client.query<{ id: string; matching_groups: number }>(
      `select provider.id::text,
              count(groups.remote_group_id)::integer as matching_groups
       from provider_instances provider
       left join provider_groups groups
         on groups.provider_instance_id = provider.id
        and groups.remote_group_id = any($2::bigint[])
        and groups.available = true
        and groups.disabled = false
       where provider.code = $1 and provider.enabled = true
       group by provider.id`,
      [providerCode, groupIds],
    );
    const row = result.rows[0];
    if (row === undefined) throw new DomainConflictError('PROVIDER_NOT_FOUND');
    if (row.matching_groups !== groupIds.length) {
      throw new DomainConflictError('PROVIDER_GROUP_NOT_AVAILABLE');
    }
    return row.id;
  }
}

function mapSettings(row: SettingsRow): StorefrontSettings {
  return {
    brandName: row.brand_name,
    heroTitle: row.hero_title,
    heroSubtitle: row.hero_subtitle,
    deliveryNote: row.delivery_note,
    supportNote: row.support_note,
    volumeHelper: row.volume_helper,
    cardNumber: row.card_number,
    cardHolder: row.card_holder,
  };
}

function mapProduct(row: ProductRow, variants: readonly StorefrontVariant[]): StorefrontProduct {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    shortName: row.short_name || row.name,
    description: row.description,
    badge: row.badge,
    iconKey: row.icon_key,
    position: row.product_position,
    active: row.active,
    category: {
      code: row.category_code,
      name: row.category_name,
      description: row.category_description,
      position: row.category_position,
    },
    variants,
  };
}

function mapVariant(row: VariantRow): StorefrontVariant {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    durationDays: row.duration_days,
    durationLabel: row.duration_label,
    dataLimitBytes: BigInt(row.data_limit_bytes),
    dataLimitLabel: row.data_limit_label,
    deviceLimit: row.device_limit,
    deviceLabel: row.device_label,
    priceIrr: BigInt(row.price_irr),
    position: row.position,
    sellable: row.sellable,
    providerCode: row.provider_code ?? '',
    groupIds: row.group_ids.map(parseSafeProviderGroupId),
  };
}

function requiredRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new DomainConflictError('DATABASE_ROW_NOT_FOUND');
  return row;
}
