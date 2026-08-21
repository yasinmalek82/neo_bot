alter table storefront_settings
  add column card_number text not null default '0000000000000000',
  add column card_holder text not null default 'نام صاحب کارت';

alter table storefront_settings
  add constraint storefront_settings_card_number_check
  check (card_number ~ '^[0-9]{16}$'),
  add constraint storefront_settings_card_holder_check
  check (char_length(card_holder) between 2 and 120);
