create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table provider_instances (
  id bigint generated always as identity primary key,
  code text not null unique,
  provider_kind text not null check (provider_kind in ('pasarguard')),
  base_url text not null unique check (base_url ~ '^https://'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table provider_groups (
  provider_instance_id bigint not null references provider_instances(id) on delete restrict,
  remote_group_id bigint not null check (remote_group_id > 0),
  name text not null,
  disabled boolean not null default false,
  available boolean not null default true,
  inbound_tags text[] not null default '{}',
  synced_at timestamptz not null,
  primary key (provider_instance_id, remote_group_id)
);

create table products (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table product_variants (
  id bigint generated always as identity primary key,
  product_id bigint not null references products(id) on delete restrict,
  code text not null unique,
  name text not null,
  duration_days integer not null check (duration_days > 0),
  data_limit_bytes bigint not null default 0 check (data_limit_bytes >= 0),
  device_limit integer not null default 0 check (device_limit >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_variants_product_id_idx on product_variants (product_id);

create table provisioning_policies (
  id bigint generated always as identity primary key,
  product_variant_id bigint not null unique references product_variants(id) on delete restrict,
  provider_instance_id bigint not null references provider_instances(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index provisioning_policies_provider_instance_id_idx
  on provisioning_policies (provider_instance_id);

create table provisioning_policy_groups (
  provisioning_policy_id bigint not null references provisioning_policies(id) on delete cascade,
  provider_instance_id bigint not null,
  remote_group_id bigint not null,
  primary key (provisioning_policy_id, remote_group_id),
  foreign key (provider_instance_id, remote_group_id)
    references provider_groups(provider_instance_id, remote_group_id)
    on delete restrict
);

create index provisioning_policy_groups_provider_group_idx
  on provisioning_policy_groups (provider_instance_id, remote_group_id);

create table services (
  id bigint generated always as identity primary key,
  product_variant_id bigint not null references product_variants(id) on delete restrict,
  provider_instance_id bigint not null references provider_instances(id) on delete restrict,
  target_user_id bigint not null check (target_user_id > 0),
  target_username text not null,
  status text not null check (status in ('active', 'disabled', 'expired', 'limited', 'on_hold')),
  expires_at timestamptz,
  subscription_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_instance_id, target_user_id)
);

create index services_product_variant_id_idx on services (product_variant_id);
create index services_provider_instance_id_idx on services (provider_instance_id);

create table provisioning_operations (
  id bigint generated always as identity primary key,
  operation_type text not null check (operation_type in ('create', 'renew')),
  idempotency_key text not null,
  request_hash text not null check (length(request_hash) = 64),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  service_id bigint references services(id) on delete restrict,
  remote_user_id bigint check (remote_user_id > 0),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operation_type, idempotency_key)
);

create index provisioning_operations_service_id_idx on provisioning_operations (service_id);
create index provisioning_operations_pending_idx
  on provisioning_operations (updated_at)
  where status = 'pending';
