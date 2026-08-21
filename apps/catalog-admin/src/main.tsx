import '@fontsource-variable/vazirmatn';
import './styles.css';

import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { prepareTelegramWebApp, readTelegramInitData } from './telegram-webapp';

declare global {
  // Keeps Vite hot updates from mounting a second React root in development.
  var neoCatalogAdminRoot: Root | undefined;
}

type IconKey = 'loop' | 'globe' | 'star' | 'bolt';

interface Settings {
  brandName: string;
  heroTitle: string;
  heroSubtitle: string;
  deliveryNote: string;
  supportNote: string;
  volumeHelper: string;
  cardNumber: string;
  cardHolder: string;
}

interface Variant {
  id?: string;
  code: string;
  name: string;
  description: string;
  durationDays: number;
  durationLabel: string;
  dataLimitGb: number;
  dataLimitLabel: string;
  deviceLimit: number;
  deviceLabel: string;
  priceToman: number;
  position: number;
  sellable: boolean;
  providerCode: string;
  groupIds: number[];
}

interface Product {
  id?: string;
  code: string;
  name: string;
  shortName: string;
  description: string;
  badge: string | null;
  iconKey: IconKey;
  position: number;
  active: boolean;
  category: {
    code: string;
    name: string;
    description: string;
    position: number;
  };
  variants: Variant[];
}

interface Catalog {
  settings: Settings;
  products: Product[];
  updatedAt?: string;
}

interface ProviderGroup {
  providerCode: string;
  groupId: number;
  name: string;
  available: boolean;
  disabled: boolean;
}

const viteEnvironment = import.meta.env as unknown as {
  readonly VITE_API_BASE_URL?: string;
  readonly DEV: boolean;
};
const apiBaseUrl =
  viteEnvironment.VITE_API_BASE_URL ??
  (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
    ? 'http://127.0.0.1:3100'
    : '');
const localDevelopmentToken = viteEnvironment.DEV ? 'neo-local-catalog-admin-2026-test-only' : '';

function catalogAdminHeaders(token: string): Record<string, string> {
  if (viteEnvironment.DEV) {
    return { Authorization: `Bearer ${token}` };
  }
  const initData = readTelegramInitData();
  return initData === null ? {} : { 'X-Telegram-Init-Data': initData };
}

function App() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem('neo-admin-token') ?? localDevelopmentToken,
  );
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const load = async (adminToken: string) => {
    setStatus('loading');
    setMessage('');
    try {
      const headers = catalogAdminHeaders(adminToken);
      const [catalogResponse, groupsResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/admin/catalog`, { headers }),
        fetch(`${apiBaseUrl}/admin/provider-groups`, { headers }),
      ]);
      if (!catalogResponse.ok || !groupsResponse.ok) throw new Error('ADMIN_LOAD_FAILED');
      const nextCatalog = (await catalogResponse.json()) as Catalog;
      const groupPayload = (await groupsResponse.json()) as { groups: ProviderGroup[] };
      sessionStorage.setItem('neo-admin-token', adminToken);
      setCatalog(nextCatalog);
      setGroups(groupPayload.groups);
      setStatus('idle');
    } catch {
      setStatus('error');
      setMessage(
        viteEnvironment.DEV
          ? 'ورود انجام نشد؛ کلید مدیریت یا اتصال API را بررسی کن.'
          : 'ورود انجام نشد؛ این کنسول را از مینی‌اپ تلگرام با حساب ادمین باز کن.',
      );
    }
  };

  useEffect(() => {
    prepareTelegramWebApp();
    if (viteEnvironment.DEV) {
      if (token.length >= 32) void load(token);
      return;
    }
    void load('');
  }, []);

  const save = async () => {
    if (catalog === null) return;
    setStatus('saving');
    setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/admin/catalog`, {
        method: 'PUT',
        headers: {
          ...catalogAdminHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          settings: catalog.settings,
          products: catalog.products.map((product) => ({
            code: product.code,
            name: product.name,
            shortName: product.shortName,
            description: product.description,
            badge: product.badge,
            iconKey: product.iconKey,
            position: product.position,
            active: product.active,
            category: product.category,
            variants: product.variants.map((variant) => ({
              code: variant.code,
              name: variant.name,
              description: variant.description,
              durationDays: variant.durationDays,
              durationLabel: variant.durationLabel,
              dataLimitGb: variant.dataLimitGb,
              dataLimitLabel: variant.dataLimitLabel,
              deviceLimit: variant.deviceLimit,
              deviceLabel: variant.deviceLabel,
              priceToman: variant.priceToman,
              position: variant.position,
              sellable: variant.sellable,
              providerCode: variant.providerCode,
              groupIds: variant.groupIds,
            })),
          })),
        }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(error?.message ?? 'SAVE_FAILED');
      }
      setCatalog((await response.json()) as Catalog);
      setStatus('saved');
      setMessage('همه تغییرات با هم ذخیره و منتشر شدند.');
    } catch (error: unknown) {
      setStatus('error');
      setMessage(
        error instanceof Error
          ? `ذخیره انجام نشد: ${translateError(error.message)}`
          : 'ذخیره انجام نشد.',
      );
    }
  };

  if (catalog === null) {
    if (!viteEnvironment.DEV) {
      return (
        <main className="login-shell">
          <section className="login-card" aria-labelledby="login-title">
            <span className="brand-pill">NEO BOT</span>
            <h1 id="login-title">مدیریت کاتالوگ</h1>
            <p>
              این کنسول را از مینی‌اپ تلگرام با حساب ادمین باز کن. ورود با کلید آزمایشی در محیط
              انتشار غیرفعال است.
            </p>
            <button className="primary" type="button" onClick={() => void load('')}>
              {status === 'loading' ? 'در حال اتصال…' : 'تلاش دوباره'}
            </button>
            {message ? <p className="form-message error">{message}</p> : null}
          </section>
        </main>
      );
    }
    return (
      <main className="login-shell">
        <section className="login-card" aria-labelledby="login-title">
          <span className="brand-pill">NEO BOT</span>
          <h1 id="login-title">مدیریت کاتالوگ</h1>
          <p>کلید مدیریت فقط در همین نشست مرورگر نگهداری می‌شود.</p>
          <label>
            کلید مدیریت
            <input
              type="password"
              value={token}
              autoComplete="off"
              onChange={(event) => {
                setToken(event.target.value.trim());
              }}
              placeholder="حداقل ۳۲ کاراکتر"
            />
          </label>
          <button
            className="primary"
            type="button"
            disabled={token.length < 32 || status === 'loading'}
            onClick={() => void load(token)}
          >
            {status === 'loading' ? 'در حال اتصال…' : 'ورود به مدیریت'}
          </button>
          {message ? <p className="form-message error">{message}</p> : null}
        </section>
      </main>
    );
  }

  const updateProduct = (productIndex: number, nextProduct: Product) => {
    setCatalog((current) =>
      current === null
        ? current
        : {
            ...current,
            products: current.products.map((product, index) =>
              index === productIndex ? nextProduct : product,
            ),
          },
    );
    setStatus('idle');
  };

  return (
    <main className="admin-shell">
      <header className="topbar">
        <div>
          <span className="brand-pill">NEO BOT</span>
          <h1>کاتالوگ فروش</h1>
          <p>محصول، حجم، مدت، اتصال و قیمت را بدون تغییر کد مدیریت کن.</p>
        </div>
        <div className="topbar-actions">
          <button
            className="secondary"
            type="button"
            onClick={() => {
              sessionStorage.removeItem('neo-admin-token');
              setToken('');
              setCatalog(null);
            }}
          >
            خروج
          </button>
          <button
            className="primary"
            type="button"
            disabled={status === 'saving'}
            onClick={() => void save()}
          >
            {status === 'saving' ? 'در حال ذخیره…' : 'ذخیره و انتشار'}
          </button>
        </div>
      </header>

      {message ? (
        <div className={`notice ${status === 'error' ? 'error' : 'success'}`}>{message}</div>
      ) : null}

      <section className="panel" aria-labelledby="storefront-copy-title">
        <div className="section-title">
          <div>
            <span>متن‌های عمومی</span>
            <h2 id="storefront-copy-title">هویت و پیام‌های Mini App</h2>
          </div>
        </div>
        <div className="form-grid">
          <Field label="نام برند">
            <input
              value={catalog.settings.brandName}
              onChange={(event) => {
                setCatalog({
                  ...catalog,
                  settings: { ...catalog.settings, brandName: event.target.value },
                });
              }}
            />
          </Field>
          <Field label="عنوان اصلی">
            <input
              value={catalog.settings.heroTitle}
              onChange={(event) => {
                setCatalog({
                  ...catalog,
                  settings: { ...catalog.settings, heroTitle: event.target.value },
                });
              }}
            />
          </Field>
          <Field label="زیرعنوان">
            <input
              value={catalog.settings.heroSubtitle}
              onChange={(event) => {
                setCatalog({
                  ...catalog,
                  settings: { ...catalog.settings, heroSubtitle: event.target.value },
                });
              }}
            />
          </Field>
          <Field label="پیام تحویل">
            <input
              value={catalog.settings.deliveryNote}
              onChange={(event) => {
                setCatalog({
                  ...catalog,
                  settings: { ...catalog.settings, deliveryNote: event.target.value },
                });
              }}
            />
          </Field>
          <Field label="پیام پشتیبانی">
            <input
              value={catalog.settings.supportNote}
              onChange={(event) => {
                setCatalog({
                  ...catalog,
                  settings: { ...catalog.settings, supportNote: event.target.value },
                });
              }}
            />
          </Field>
          <Field label="راهنمای حجم">
            <input
              value={catalog.settings.volumeHelper}
              onChange={(event) => {
                setCatalog({
                  ...catalog,
                  settings: { ...catalog.settings, volumeHelper: event.target.value },
                });
              }}
            />
          </Field>
          <Field label="شماره کارت">
            <input
              dir="ltr"
              inputMode="numeric"
              maxLength={16}
              value={catalog.settings.cardNumber}
              onChange={(event) => {
                setCatalog({
                  ...catalog,
                  settings: {
                    ...catalog.settings,
                    cardNumber: event.target.value.replace(/\D/gu, ''),
                  },
                });
              }}
            />
          </Field>
          <Field label="نام صاحب کارت">
            <input
              value={catalog.settings.cardHolder}
              onChange={(event) => {
                setCatalog({
                  ...catalog,
                  settings: { ...catalog.settings, cardHolder: event.target.value },
                });
              }}
            />
          </Field>
        </div>
      </section>

      <div className="products-heading">
        <div>
          <span>محصولات و قیمت‌ها</span>
          <h2>ترکیب‌های قابل فروش</h2>
        </div>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            setCatalog({
              ...catalog,
              products: [...catalog.products, createProduct(catalog.products.length, groups)],
            });
          }}
        >
          افزودن محصول
        </button>
      </div>

      {catalog.products.map((product, productIndex) => (
        <ProductEditor
          key={product.code}
          product={product}
          groups={groups}
          onChange={(nextProduct) => {
            updateProduct(productIndex, nextProduct);
          }}
          onRemove={() => {
            setCatalog({
              ...catalog,
              products: catalog.products.filter((_, index) => index !== productIndex),
            });
          }}
        />
      ))}

      <footer className="sticky-save">
        <div>
          <strong>{catalog.products.length} محصول</strong>
          <span>تغییرات تا زمان انتشار برای مشتری نمایش داده نمی‌شوند.</span>
        </div>
        <button
          className="primary"
          type="button"
          disabled={status === 'saving'}
          onClick={() => void save()}
        >
          ذخیره و انتشار همه تغییرات
        </button>
      </footer>
    </main>
  );
}

function ProductEditor({
  product,
  groups,
  onChange,
  onRemove,
}: {
  product: Product;
  groups: ProviderGroup[];
  onChange: (product: Product) => void;
  onRemove: () => void;
}) {
  const updateVariant = (variantIndex: number, variant: Variant) => {
    onChange({
      ...product,
      variants: product.variants.map((current, index) =>
        index === variantIndex ? variant : current,
      ),
    });
  };

  return (
    <section className="panel product-panel">
      <div className="product-head">
        <div>
          <span className="product-code" dir="ltr">
            {product.code}
          </span>
          <h2>{product.name || 'محصول تازه'}</h2>
        </div>
        <div className="inline-actions">
          <label className="switch-label">
            <input
              type="checkbox"
              checked={product.active}
              onChange={(event) => {
                onChange({ ...product, active: event.target.checked });
              }}
            />
            نمایش محصول
          </label>
          <button className="danger-link" type="button" onClick={onRemove}>
            حذف از کاتالوگ
          </button>
        </div>
      </div>

      <div className="form-grid">
        <Field label="نام محصول">
          <input
            value={product.name}
            onChange={(event) => {
              onChange({ ...product, name: event.target.value });
            }}
          />
        </Field>
        <Field label="نام کوتاه">
          <input
            value={product.shortName}
            onChange={(event) => {
              onChange({ ...product, shortName: event.target.value });
            }}
          />
        </Field>
        <Field label="توضیح محصول">
          <input
            value={product.description}
            onChange={(event) => {
              onChange({ ...product, description: event.target.value });
            }}
          />
        </Field>
        <Field label="نشان پیشنهادی">
          <input
            value={product.badge ?? ''}
            placeholder="اختیاری"
            onChange={(event) => {
              onChange({ ...product, badge: event.target.value || null });
            }}
          />
        </Field>
        <Field label="آیکن">
          <select
            value={product.iconKey}
            onChange={(event) => {
              onChange({ ...product, iconKey: event.target.value as IconKey });
            }}
          >
            <option value="loop">نامحدود</option>
            <option value="globe">چند لوکیشن</option>
            <option value="star">ویژه</option>
            <option value="bolt">سریع</option>
          </select>
        </Field>
        <Field label="ترتیب نمایش">
          <input
            type="number"
            value={product.position}
            onChange={(event) => {
              onChange({ ...product, position: numberValue(event.target.value) });
            }}
          />
        </Field>
        <Field label="نام دسته‌بندی">
          <input
            value={product.category.name}
            onChange={(event) => {
              onChange({ ...product, category: { ...product.category, name: event.target.value } });
            }}
          />
        </Field>
        <Field label="توضیح دسته‌بندی">
          <input
            value={product.category.description}
            onChange={(event) => {
              onChange({
                ...product,
                category: { ...product.category, description: event.target.value },
              });
            }}
          />
        </Field>
      </div>

      <div className="variant-heading">
        <div>
          <h3>ماتریس حجم، مدت و قیمت</h3>
          <p>هر ردیف یک ترکیب واقعی و قابل خرید است؛ تعداد ردیف‌ها محدود نیست.</p>
        </div>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            onChange({
              ...product,
              variants: [...product.variants, createVariant(product, groups)],
            });
          }}
        >
          افزودن ترکیب
        </button>
      </div>

      <div className="variant-list">
        {product.variants.map((variant, variantIndex) => (
          <article className="variant-card" key={variant.code}>
            <div className="variant-card-head">
              <strong>ترکیب {variantIndex + 1}</strong>
              <div className="inline-actions">
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={variant.sellable}
                    onChange={(event) => {
                      updateVariant(variantIndex, { ...variant, sellable: event.target.checked });
                    }}
                  />
                  قابل فروش
                </label>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    onChange({
                      ...product,
                      variants: [...product.variants, duplicateVariant(variant)],
                    });
                  }}
                >
                  تکثیر
                </button>
                <button
                  className="danger-link"
                  type="button"
                  onClick={() => {
                    onChange({
                      ...product,
                      variants: product.variants.filter((_, index) => index !== variantIndex),
                    });
                  }}
                >
                  حذف
                </button>
              </div>
            </div>
            <div className="variant-grid">
              <Field label="حجم (گیگ)">
                <input
                  type="number"
                  min="0"
                  value={variant.dataLimitGb}
                  onChange={(event) => {
                    updateVariant(variantIndex, {
                      ...variant,
                      dataLimitGb: numberValue(event.target.value),
                    });
                  }}
                />
              </Field>
              <Field label="برچسب حجم">
                <input
                  value={variant.dataLimitLabel}
                  placeholder="مثلاً ۷۵ گیگ"
                  onChange={(event) => {
                    updateVariant(variantIndex, { ...variant, dataLimitLabel: event.target.value });
                  }}
                />
              </Field>
              <Field label="مدت (روز)">
                <input
                  type="number"
                  min="1"
                  value={variant.durationDays}
                  onChange={(event) => {
                    updateVariant(variantIndex, {
                      ...variant,
                      durationDays: numberValue(event.target.value),
                    });
                  }}
                />
              </Field>
              <Field label="برچسب مدت">
                <input
                  value={variant.durationLabel}
                  placeholder="مثلاً سه‌ماهه"
                  onChange={(event) => {
                    updateVariant(variantIndex, { ...variant, durationLabel: event.target.value });
                  }}
                />
              </Field>
              <Field label="اتصال هم‌زمان">
                <input
                  type="number"
                  min="0"
                  value={variant.deviceLimit}
                  onChange={(event) => {
                    updateVariant(variantIndex, {
                      ...variant,
                      deviceLimit: numberValue(event.target.value),
                    });
                  }}
                />
              </Field>
              <Field label="قیمت (تومان)">
                <input
                  type="number"
                  min="0"
                  value={variant.priceToman}
                  onChange={(event) => {
                    updateVariant(variantIndex, {
                      ...variant,
                      priceToman: numberValue(event.target.value),
                    });
                  }}
                />
              </Field>
              <Field label="نام داخلی">
                <input
                  value={variant.name}
                  onChange={(event) => {
                    updateVariant(variantIndex, { ...variant, name: event.target.value });
                  }}
                />
              </Field>
              <Field label="توضیح گزینه">
                <input
                  value={variant.description}
                  placeholder="مثلاً مصرف روزمره"
                  onChange={(event) => {
                    updateVariant(variantIndex, { ...variant, description: event.target.value });
                  }}
                />
              </Field>
              <Field label="برچسب اتصال">
                <input
                  value={variant.deviceLabel}
                  placeholder="مثلاً دو اتصال"
                  onChange={(event) => {
                    updateVariant(variantIndex, { ...variant, deviceLabel: event.target.value });
                  }}
                />
              </Field>
              <Field label="ترتیب ترکیب">
                <input
                  type="number"
                  value={variant.position}
                  onChange={(event) => {
                    updateVariant(variantIndex, {
                      ...variant,
                      position: numberValue(event.target.value),
                    });
                  }}
                />
              </Field>
              <fieldset className="group-field">
                <legend>گروه‌های PasarGuard</legend>
                {groups.filter((group) => group.available && !group.disabled).length === 0 ? (
                  <p>گروه قابل‌انتخاب نیست. اول همگام‌سازی پنل آزمایشی را انجام بده.</p>
                ) : (
                  groups
                    .filter((group) => group.available && !group.disabled)
                    .map((group) => (
                      <label key={`${group.providerCode}:${String(group.groupId)}`}>
                        <input
                          type="checkbox"
                          checked={
                            variant.providerCode === group.providerCode &&
                            variant.groupIds.includes(group.groupId)
                          }
                          onChange={(event) => {
                            const sameProvider = variant.providerCode === group.providerCode;
                            const currentIds = sameProvider ? variant.groupIds : [];
                            const nextIds = event.target.checked
                              ? [...new Set([...currentIds, group.groupId])]
                              : currentIds.filter((id) => id !== group.groupId);
                            updateVariant(variantIndex, {
                              ...variant,
                              providerCode: group.providerCode,
                              groupIds: nextIds,
                            });
                          }}
                        />
                        {group.name} — گروه {group.groupId}
                      </label>
                    ))
                )}
              </fieldset>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function createProduct(position: number, groups: ProviderGroup[]): Product {
  const code = uniqueCode('product');
  const product: Product = {
    code,
    name: 'محصول تازه',
    shortName: 'محصول تازه',
    description: '',
    badge: null,
    iconKey: 'globe',
    position,
    active: false,
    category: { code: uniqueCode('category'), name: 'دسته‌بندی تازه', description: '', position },
    variants: [],
  };
  return { ...product, variants: [createVariant(product, groups)] };
}

function createVariant(product: Product, groups: ProviderGroup[]): Variant {
  const group = groups.find((candidate) => candidate.available && !candidate.disabled);
  return {
    code: uniqueCode(`${product.code}-variant`),
    name: 'ترکیب تازه',
    description: '',
    durationDays: 30,
    durationLabel: 'یک‌ماهه',
    dataLimitGb: 50,
    dataLimitLabel: '۵۰ گیگ',
    deviceLimit: 1,
    deviceLabel: 'یک اتصال',
    priceToman: 0,
    position: product.variants.length,
    sellable: false,
    providerCode: group?.providerCode ?? 'pilot-pasarguard',
    groupIds: group === undefined ? [] : [group.groupId],
  };
}

function duplicateVariant(variant: Variant): Variant {
  return { ...variant, id: undefined, code: uniqueCode('variant'), position: variant.position + 1 };
}

function uniqueCode(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`.toLowerCase();
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function translateError(error: string): string {
  const known: Record<string, string> = {
    ACTIVE_PRODUCT_REQUIRES_SELLABLE_VARIANT:
      'محصول فعال باید حداقل یک ترکیب قابل فروش داشته باشد.',
    SELLABLE_VARIANT_REQUIRES_PRICE: 'برای ترکیب قابل فروش باید قیمت بزرگ‌تر از صفر وارد شود.',
    PROVIDER_GROUP_NOT_AVAILABLE: 'یکی از گروه‌های انتخاب‌شده در PasarGuard در دسترس نیست.',
    INVALID_CATALOG_PAYLOAD: 'یکی از فیلدها ناقص یا نامعتبر است.',
    INIT_DATA_REQUIRED: 'این کنسول را از مینی‌اپ تلگرام با حساب ادمین باز کن.',
    ADMIN_AUTH_INVALID: 'این حساب ادمین نیست.',
    ADMIN_API_DISABLED: 'ربات تلگرام برای ورود مدیریت فعال نیست.',
  };
  return known[error] ?? error;
}

const root = document.getElementById('root');
if (root === null) throw new Error('ROOT_ELEMENT_NOT_FOUND');
const reactRoot = globalThis.neoCatalogAdminRoot ?? createRoot(root);
globalThis.neoCatalogAdminRoot = reactRoot;
reactRoot.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
