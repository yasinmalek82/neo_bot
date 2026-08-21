alter table product_categories
  add column managed_by_admin boolean not null default false;

alter table products
  add column short_name text not null default '',
  add column badge text,
  add column icon_key text not null default 'globe',
  add column managed_by_admin boolean not null default false;

alter table product_variants
  add column duration_label text not null default '',
  add column data_limit_label text not null default '',
  add column device_label text not null default '',
  add column position integer not null default 0;

alter table products
  add constraint products_short_name_length_check
  check (char_length(short_name) <= 120),
  add constraint products_badge_length_check
  check (badge is null or char_length(badge) between 1 and 40),
  add constraint products_icon_key_check
  check (icon_key in ('loop', 'globe', 'star', 'bolt'));

alter table product_variants
  add constraint product_variants_duration_label_length_check
  check (char_length(duration_label) <= 80),
  add constraint product_variants_data_limit_label_length_check
  check (char_length(data_limit_label) <= 80),
  add constraint product_variants_device_label_length_check
  check (char_length(device_label) <= 80);

create table storefront_settings (
  id smallint primary key default 1 check (id = 1),
  brand_name text not null check (char_length(brand_name) between 1 and 80),
  hero_title text not null check (char_length(hero_title) between 1 and 160),
  hero_subtitle text not null default '' check (char_length(hero_subtitle) <= 240),
  delivery_note text not null default '' check (char_length(delivery_note) <= 160),
  support_note text not null default '' check (char_length(support_note) <= 160),
  volume_helper text not null default '' check (char_length(volume_helper) <= 240),
  updated_at timestamptz not null default now()
);

insert into storefront_settings(
  id, brand_name, hero_title, hero_subtitle, delivery_note, support_note, volume_helper
) values (
  1,
  'نئوبات',
  'سرویس مناسب خودت را انتخاب کن',
  'سریع، امن و پایدار برای هر نیاز',
  'تحویل سریع پس از تأیید پرداخت',
  'پشتیبانی آنلاین',
  'حجم انتخابی میان تمام لوکیشن‌های سرویس مشترک است.'
) on conflict (id) do nothing;

create index product_categories_admin_navigation_idx
  on product_categories (managed_by_admin, active, position, id);

create index products_admin_catalog_idx
  on products (managed_by_admin, active, updated_at, id);

create index product_variants_storefront_idx
  on product_variants (product_id, sellable, active, position, id)
  where sellable = true and active = true;
