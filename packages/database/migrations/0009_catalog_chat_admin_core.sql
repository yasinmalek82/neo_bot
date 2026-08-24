create table catalog_revisions (
  id smallint primary key default 1 check (id = 1),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

insert into catalog_revisions(id) values (1) on conflict (id) do nothing;

create table catalog_admin_sessions (
  id uuid primary key,
  admin_telegram_user_id bigint not null check (admin_telegram_user_id > 0),
  base_revision bigint not null check (base_revision >= 0),
  state jsonb not null check (
    jsonb_typeof(state) = 'object'
    and state ->> 'kind' in ('start', 'settings', 'category', 'product', 'variant', 'archive', 'restore', 'review')
    and state ->> 'step' in ('select-action', 'settings-fields', 'category-fields', 'product-fields', 'variant-fields', 'target', 'confirm')
    and (
      (state ->> 'kind' = 'start' and state = jsonb_build_object('kind', state -> 'kind', 'step', state -> 'step'))
      or (state ? 'values' and state ? 'field' and state = jsonb_build_object('kind', state -> 'kind', 'step', state -> 'step', 'field', state -> 'field', 'values', state -> 'values'))
      or (state ? 'delta' and state = jsonb_build_object('kind', state -> 'kind', 'step', state -> 'step', 'delta', state -> 'delta'))
    )
  ),
  status text not null default 'pending' check (status in ('pending', 'canceled', 'published', 'expired')),
  published_revision bigint check (published_revision > 0),
  published_result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at <= created_at + interval '24 hours')
);

create index catalog_admin_sessions_open_idx
  on catalog_admin_sessions(admin_telegram_user_id, expires_at)
  where consumed_at is null;

create unique index catalog_admin_sessions_one_pending_per_admin_idx
  on catalog_admin_sessions(admin_telegram_user_id)
  where status = 'pending';

create table catalog_publication_audit (
  id bigint generated always as identity primary key,
  admin_telegram_user_id bigint not null check (admin_telegram_user_id > 0),
  revision bigint not null check (revision > 0),
  action text not null check (action in ('settings', 'category', 'product', 'variant', 'archive', 'restore')),
  entity_code text,
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now()
);

create index catalog_publication_audit_revision_idx
  on catalog_publication_audit(revision, created_at);
