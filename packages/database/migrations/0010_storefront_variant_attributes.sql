create table product_variant_display_attributes (
  product_variant_id bigint not null references product_variants(id) on delete cascade,
  position smallint not null check (position between 0 and 3),
  label text not null check (char_length(trim(label)) between 1 and 40),
  value text not null check (char_length(trim(value)) between 1 and 120),
  primary key (product_variant_id, position)
);

create index product_variant_display_attributes_variant_idx
  on product_variant_display_attributes(product_variant_id, position);

create index sales_orders_fulfilled_variant_recent_idx
  on sales_orders(product_variant_id, created_at desc)
  where status = 'fulfilled';

alter table catalog_publication_audit
  drop constraint catalog_publication_audit_action_check,
  add constraint catalog_publication_audit_action_check
    check (action in ('settings', 'category', 'product', 'variant', 'archive', 'restore', 'reorder', 'changeset'));

alter table catalog_admin_sessions
  drop constraint catalog_admin_sessions_state_check,
  add constraint catalog_admin_sessions_state_check check (
    jsonb_typeof(state) = 'object'
    and state ->> 'kind' in ('start', 'settings', 'category', 'product', 'variant', 'changeset', 'archive', 'restore', 'review')
    and state ->> 'step' in ('select-action', 'settings-fields', 'category-fields', 'product-fields', 'variant-fields', 'guided-fields', 'target', 'confirm')
    and (
      (state ->> 'kind' = 'start' and state = jsonb_build_object('kind', state -> 'kind', 'step', state -> 'step'))
      or (
        state ? 'values' and state ? 'field'
        and state - 'mode' = jsonb_build_object('kind', state -> 'kind', 'step', state -> 'step', 'field', state -> 'field', 'values', state -> 'values')
        and (not state ? 'mode' or state ->> 'mode' = 'edit')
      )
      or (state ? 'delta' and state = jsonb_build_object('kind', state -> 'kind', 'step', state -> 'step', 'delta', state -> 'delta'))
    )
  );
