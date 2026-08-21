import { z } from 'zod';

const positiveInteger = z.coerce.number().int().positive();
const nonNegativeBigInt = z
  .union([z.bigint(), z.number().int(), z.string().regex(/^\d+$/u)])
  .transform(BigInt);

export const simpleGroupsResponseSchema = z.object({
  groups: z.array(
    z.object({
      id: positiveInteger,
      name: z.string().min(1).max(200),
    }),
  ),
});

export const groupDetailSchema = z.object({
  id: positiveInteger,
  name: z.string().min(1).max(200),
  inbound_tags: z.array(z.string().max(300)).default([]),
  is_disabled: z.boolean().default(false),
});

export const rawUserSchema = z
  .object({
    id: positiveInteger,
    username: z.string().min(1).max(200),
    status: z.enum(['active', 'disabled', 'expired', 'limited', 'on_hold']).default('active'),
    expire: z.union([z.string(), z.number(), z.null()]).optional(),
    data_limit: nonNegativeBigInt.default(0n),
    used_traffic: nonNegativeBigInt.default(0n),
    group_ids: z.array(positiveInteger).default([]),
    subscription_url: z.string().min(1).max(2_048),
    proxy_settings: z.record(z.string(), z.unknown()).default({}),
    hwid_limit: z.number().int().nonnegative().nullish(),
  })
  .loose();

export type RawPasarGuardUser = z.infer<typeof rawUserSchema>;
