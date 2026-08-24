import {
  ArrowLeftIcon,
  ArrowRightIcon,
  LightningBoltIcon,
  UploadIcon,
} from '@radix-ui/react-icons';
import { useEffect, useState } from 'react';
import {
  checkoutErrorCopy,
  customerOrderStatusLabel,
  emptyShopCopy,
  helpSteps,
  HOME_TABS,
  shopUnavailableCopy,
  type HomeTabId,
} from './customer-copy';
import { FlowStack, MobileScroll, type FlowControls, type FlowScreen } from './mobile';
import {
  closeTelegramWebApp,
  prepareTelegramWebApp,
  shouldUsePhonePreview,
  waitForTelegramInitData,
} from './telegram-webapp';

interface ShopCategorySummary {
  id: string;
  name: string;
  description: string;
}

interface ShopVariantSummary {
  id: string;
  productName: string;
  name: string;
  description: string;
  durationDays: number;
  volumeLabel: string;
  deviceLabel: string;
  priceToman: number;
}

interface ShopCategoryDetail {
  id: string;
  name: string;
  description: string;
  parent: { id: string; name: string } | null;
  categories: readonly ShopCategorySummary[];
  variants: readonly ShopVariantSummary[];
}

interface CustomerOrderResponse {
  order: {
    id: string;
    productName: string;
    variantName: string;
    amountIrr: string;
    status: string;
  } | null;
  payment: { cardNumber: string; cardHolder: string } | null;
}

const viteEnvironment = import.meta.env as unknown as { readonly VITE_API_BASE_URL?: string };
const apiBaseUrl =
  viteEnvironment.VITE_API_BASE_URL ??
  (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
    ? 'http://127.0.0.1:3100'
    : '');

function formatPrice(value: number): string {
  return new Intl.NumberFormat('fa-IR').format(value);
}

function formatCardNumber(value: string): string {
  return value.replace(/(\d{4})(?=\d)/gu, '$1 ');
}

function initHeaders(initData: string): Record<string, string> {
  return { 'X-Telegram-Init-Data': initData };
}

async function readApiErrorCode(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === 'string' ? body.message : 'CHECKOUT_FAILED';
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-label="نئوبات">
      <LightningBoltIcon width={28} height={28} />
    </div>
  );
}

function AppToolbar({ title, flow }: { title: string; flow: FlowControls }) {
  return (
    <div className="app-toolbar" dir="rtl">
      <button className="icon-button" type="button" onClick={flow.pop} aria-label="بازگشت">
        <ArrowRightIcon width={21} height={21} />
      </button>
      <strong>{title}</strong>
      <span className="toolbar-spacer" aria-hidden="true" />
    </div>
  );
}

function TelegramRequired({ title }: { title: string }) {
  const copy = shopUnavailableCopy('telegram');
  return (
    <MobileScroll className="app-screen catalog-state-page">
      <main className="catalog-state" dir="rtl" role="alert">
        <BrandMark />
        <h1>{title}</h1>
        <p>{copy.body}</p>
      </main>
    </MobileScroll>
  );
}

function OrderLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="order-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function useTelegramInitData(): string | null | undefined {
  const [initData, setInitData] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void waitForTelegramInitData().then((value) => {
      if (!cancelled) {
        setInitData(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return initData;
}

type ShopError = { readonly kind: 'telegram' } | { readonly kind: 'failed' };

function ShopRootBound({ flow }: { flow: FlowControls }) {
  const [hero, setHero] = useState({ title: 'خرید سرویس', subtitle: 'دسته را انتخاب کن.' });
  const [categories, setCategories] = useState<readonly ShopCategorySummary[] | null>(null);
  const [emptyHint, setEmptyHint] = useState<'admin' | 'customer' | null>(null);
  const [error, setError] = useState<ShopError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void waitForTelegramInitData().then((initData) => {
      if (cancelled) {
        return;
      }
      if (initData === null) {
        setError({ kind: 'telegram' });
        setCategories([]);
        return;
      }
      setError(null);
      void fetch(`${apiBaseUrl}/catalog`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) return;
          const body = (await response.json()) as {
            settings?: { heroTitle?: string; heroSubtitle?: string };
          };
          setHero({
            title:
              body.settings?.heroTitle !== undefined && body.settings.heroTitle.trim().length > 0
                ? body.settings.heroTitle
                : 'خرید سرویس',
            subtitle:
              body.settings?.heroSubtitle !== undefined &&
              body.settings.heroSubtitle.trim().length > 0
                ? body.settings.heroSubtitle
                : 'دسته را انتخاب کن تا پلن و مبلغ دقیق را ببینی.',
          });
        })
        .catch(() => undefined);
      void fetch(`${apiBaseUrl}/customer/shop/categories`, {
        headers: initHeaders(initData),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(await readApiErrorCode(response));
          return (await response.json()) as {
            categories: readonly ShopCategorySummary[];
            emptyHint: 'admin' | 'customer' | null;
          };
        })
        .then((body) => {
          setCategories(body.categories);
          setEmptyHint(body.emptyHint);
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          setError({ kind: 'failed' });
          setCategories([]);
        });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadKey]);

  if (categories === null) {
    return (
      <MobileScroll className="app-screen catalog-state-page">
        <main className="catalog-state" dir="rtl" role="status">
          <BrandMark />
          <h1>در حال دریافت فروشگاه</h1>
          <span className="state-loader" aria-hidden="true" />
        </main>
      </MobileScroll>
    );
  }

  if (error !== null) {
    const copy = shopUnavailableCopy(error.kind);
    return (
      <MobileScroll className="app-screen catalog-state-page">
        <main
          className="catalog-state"
          dir="rtl"
          role="alert"
          data-testid={error.kind === 'telegram' ? 'shop-telegram' : 'shop-failed'}
        >
          <BrandMark />
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          <button
            type="button"
            className="primary-button state-retry"
            onClick={() => {
              setReloadKey((key) => key + 1);
            }}
          >
            تلاش دوباره
          </button>
        </main>
      </MobileScroll>
    );
  }

  if (categories.length === 0) {
    const copy = emptyShopCopy(emptyHint === 'admin' ? 'admin' : 'customer');
    return (
      <MobileScroll className="app-screen catalog-state-page">
        <main className="catalog-state" dir="rtl" data-testid="shop-empty">
          <BrandMark />
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
        </main>
      </MobileScroll>
    );
  }

  return (
    <MobileScroll className="app-screen catalog-page">
      <main className="catalog-content" dir="rtl" data-testid="shop-root">
        <BrandMark />
        <header className="hero-copy">
          <h1>{hero.title}</h1>
          <p className="hero-subtitle">{hero.subtitle}</p>
        </header>
        <section className="plan-list" aria-label="دسته‌های فروشگاه">
          {categories.map((category) => (
            <button
              key={category.id}
              className="plan-option shop-row"
              type="button"
              onClick={() => {
                flow.push(categoryScreen(category.id));
              }}
            >
              <span className="plan-body">
                <span className="plan-title-line">
                  <strong>{category.name}</strong>
                </span>
                {category.description.trim().length > 0 ? (
                  <small className="plan-description">{category.description}</small>
                ) : null}
              </span>
              <ArrowLeftIcon width={18} height={18} aria-hidden="true" />
            </button>
          ))}
        </section>
      </main>
    </MobileScroll>
  );
}

function CategoryScreen({ categoryId, flow }: { categoryId: string; flow: FlowControls }) {
  const [detail, setDetail] = useState<ShopCategoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void waitForTelegramInitData().then((initData) => {
      if (cancelled) {
        return;
      }
      if (initData === null) {
        setError(checkoutErrorCopy('INIT_DATA_REQUIRED'));
        return;
      }
      void fetch(`${apiBaseUrl}/customer/shop/categories/${categoryId}`, {
        headers: initHeaders(initData),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(await readApiErrorCode(response));
          return (await response.json()) as ShopCategoryDetail;
        })
        .then(setDetail)
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          setError(
            caught instanceof Error ? checkoutErrorCopy(caught.message) : checkoutErrorCopy(''),
          );
        });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [categoryId]);

  if (error !== null) {
    return (
      <MobileScroll className="app-screen catalog-state-page">
        <main className="catalog-state" dir="rtl" role="alert">
          <h1>این دسته باز نشد</h1>
          <p>{error}</p>
        </main>
      </MobileScroll>
    );
  }

  if (detail === null) {
    return (
      <MobileScroll className="app-screen catalog-state-page">
        <main className="catalog-state" dir="rtl" role="status">
          <h1>در حال دریافت دسته</h1>
          <span className="state-loader" aria-hidden="true" />
        </main>
      </MobileScroll>
    );
  }

  const hasItems = detail.categories.length > 0 || detail.variants.length > 0;

  return (
    <MobileScroll className="app-screen catalog-page">
      <main className="catalog-content" dir="rtl" data-testid="shop-category">
        <header className="hero-copy">
          <h1>{detail.name}</h1>
          {detail.parent ? <p className="hero-subtitle">زیرمجموعهٔ {detail.parent.name}</p> : null}
          {detail.description.trim().length > 0 ? (
            <p className="hero-subtitle">{detail.description}</p>
          ) : null}
          <p className="hero-subtitle">
            {hasItems
              ? 'یکی از پلن‌ها را لمس کن تا مدت، حجم و مبلغ را ببینی.'
              : 'در این دسته پلنی برای فروش نیست. از بازگشت دستهٔ دیگری را باز کن.'}
          </p>
        </header>
        <section className="plan-list" aria-label="محتوای دسته">
          {detail.categories.map((category) => (
            <button
              key={category.id}
              className="plan-option shop-row"
              type="button"
              onClick={() => {
                flow.push(categoryScreen(category.id));
              }}
            >
              <span className="plan-body">
                <span className="plan-title-line">
                  <strong>{category.name}</strong>
                </span>
                {category.description.trim().length > 0 ? (
                  <small className="plan-description">{category.description}</small>
                ) : null}
              </span>
              <ArrowLeftIcon width={18} height={18} aria-hidden="true" />
            </button>
          ))}
          {detail.variants.map((variant) => (
            <button
              key={variant.id}
              className="plan-option"
              type="button"
              onClick={() => {
                flow.push(planScreen(variant));
              }}
            >
              <span className="plan-body">
                <span className="plan-title-line">
                  <strong>{variant.name}</strong>
                </span>
                <small className="plan-description">
                  {formatPrice(variant.priceToman)} تومان · {variant.volumeLabel}
                </small>
              </span>
              <ArrowLeftIcon width={18} height={18} aria-hidden="true" />
            </button>
          ))}
        </section>
      </main>
    </MobileScroll>
  );
}

function PlanScreen({ variant }: { variant: ShopVariantSummary }) {
  return (
    <MobileScroll className="app-screen detail-page">
      <main className="detail-content" dir="rtl" data-testid="plan-detail">
        <section className="order-card" aria-labelledby="plan-title">
          <p className="section-kicker">{variant.productName}</p>
          <h1 id="plan-title">{variant.name}</h1>
          {variant.description.trim().length > 0 ? <p>{variant.description}</p> : null}
          <OrderLine label="مدت" value={`${formatPrice(variant.durationDays)} روز`} />
          <OrderLine label="حجم" value={variant.volumeLabel} />
          <OrderLine label="دستگاه" value={variant.deviceLabel} />
          <div className="order-total">
            <span>قابل پرداخت</span>
            <strong>{formatPrice(variant.priceToman)} تومان</strong>
          </div>
        </section>
        <p className="placeholder-hint">
          اگر همین پلن را می خواهی، ادامه در چت ربات را بزن و پرداخت و ارسال رسید را همان جا انجام
          بده.
        </p>
      </main>
    </MobileScroll>
  );
}

function PlanFooter({ variant }: { variant: ShopVariantSummary }) {
  return (
    <div className="purchase-footer compact-footer" dir="rtl">
      <div className="compact-total">
        <span>مبلغ نهایی</span>
        <strong>{formatPrice(variant.priceToman)} تومان</strong>
      </div>
      <button
        className="primary-button compact-primary"
        type="button"
        onClick={() => {
          closeTelegramWebApp();
        }}
      >
        <span>ادامه در چت ربات</span>
        <ArrowLeftIcon width={22} height={22} aria-hidden="true" />
      </button>
    </div>
  );
}

function categoryScreen(categoryId: string): FlowScreen {
  return {
    id: `category-${categoryId}`,
    headerHeight: 56,
    header: (flow) => <AppToolbar title="دسته" flow={flow} />,
    render: (flow) => <CategoryScreen categoryId={categoryId} flow={flow} />,
  };
}

function planScreen(variant: ShopVariantSummary): FlowScreen {
  return {
    id: `plan-${variant.id}`,
    headerHeight: 56,
    header: (flow) => <AppToolbar title="مشخصات پلن" flow={flow} />,
    footerHeight: 132,
    footer: () => <PlanFooter variant={variant} />,
    render: () => <PlanScreen variant={variant} />,
  };
}

const shopRootScreen: FlowScreen = {
  id: 'shop-root',
  render: (flow) => <ShopRootBound flow={flow} />,
};

function OrdersScreen() {
  const initData = useTelegramInitData();
  const [payload, setPayload] = useState<CustomerOrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initData === undefined || initData === null) return;
    const controller = new AbortController();
    const load = () => {
      void fetch(`${apiBaseUrl}/customer/orders/current`, {
        headers: initHeaders(initData),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(await readApiErrorCode(response));
          return (await response.json()) as CustomerOrderResponse;
        })
        .then(setPayload)
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          setError(
            caught instanceof Error ? checkoutErrorCopy(caught.message) : checkoutErrorCopy(''),
          );
        });
    };
    load();
    const poll = window.setInterval(load, 4_000);
    return () => {
      controller.abort();
      window.clearInterval(poll);
    };
  }, [initData]);

  if (initData === undefined) {
    return (
      <MobileScroll className="app-screen catalog-state-page">
        <main className="catalog-state" dir="rtl" role="status">
          <BrandMark />
          <h1>در حال اتصال به ربات</h1>
          <span className="state-loader" aria-hidden="true" />
        </main>
      </MobileScroll>
    );
  }

  if (initData === null) {
    return <TelegramRequired title="وضعیت سفارش" />;
  }

  if (error !== null) {
    return (
      <MobileScroll className="app-screen catalog-state-page">
        <main className="catalog-state" dir="rtl" role="alert">
          <h1>وضعیت سفارش نیامد</h1>
          <p>{error}</p>
        </main>
      </MobileScroll>
    );
  }

  const order = payload?.order ?? null;
  return (
    <MobileScroll className="app-screen catalog-page">
      <main className="catalog-content" dir="rtl" data-testid="orders-screen">
        <BrandMark />
        <header className="hero-copy">
          <h1>سفارش باز</h1>
          <p className="hero-subtitle">
            {order
              ? customerOrderStatusLabel(order.status)
              : 'سفارش باز نداری. از زبانهٔ خرید شروع کن.'}
          </p>
        </header>
        {order ? (
          <section className="order-card">
            <OrderLine label="محصول" value={`${order.productName} — ${order.variantName}`} />
            <OrderLine label="وضعیت" value={customerOrderStatusLabel(order.status)} />
            {payload?.payment ? (
              <>
                <div className="placeholder-card-number" dir="ltr">
                  <b>{formatCardNumber(payload.payment.cardNumber)}</b>
                </div>
                <p className="placeholder-hint">به نام {payload.payment.cardHolder}</p>
              </>
            ) : null}
            <div className="info-note">
              <UploadIcon width={18} height={18} aria-hidden="true" />
              <span>عکس رسید را فقط در چت ربات بفرست.</span>
            </div>
          </section>
        ) : null}
      </main>
    </MobileScroll>
  );
}

function RenewScreen() {
  return (
    <MobileScroll className="app-screen catalog-page">
      <main className="catalog-content" dir="rtl" data-testid="renew-screen">
        <BrandMark />
        <header className="hero-copy">
          <h1>تمدید سرویس</h1>
          <p className="hero-subtitle">
            تمدید را از دکمهٔ «تمدید سرویس» در چت ربات بزن. اینجا تمدید نمی‌شود.
          </p>
        </header>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            closeTelegramWebApp();
          }}
        >
          بستن و ادامه در چت
        </button>
      </main>
    </MobileScroll>
  );
}

function HelpScreen() {
  return (
    <MobileScroll className="app-screen catalog-page">
      <main className="catalog-content" dir="rtl" data-testid="help-screen">
        <BrandMark />
        <header className="hero-copy">
          <h1>راهنمای خرید</h1>
        </header>
        <ol className="help-steps">
          {helpSteps().map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </main>
    </MobileScroll>
  );
}

export default function Prototype() {
  const [tab, setTab] = useState<HomeTabId>('shop');

  useEffect(() => {
    prepareTelegramWebApp();
    if (!shouldUsePhonePreview()) {
      document.documentElement.dataset.telegramApp = 'true';
    }
    return () => {
      delete document.documentElement.dataset.telegramApp;
    };
  }, []);

  return (
    <div className="customer-app" dir="rtl">
      <div className="customer-app-main">
        <div hidden={tab !== 'shop'} className="customer-panel" data-testid="tab-shop">
          <FlowStack initial={shopRootScreen} />
        </div>
        <div hidden={tab !== 'orders'} className="customer-panel" data-testid="tab-orders">
          {tab === 'orders' ? <OrdersScreen /> : null}
        </div>
        <div hidden={tab !== 'renew'} className="customer-panel" data-testid="tab-renew">
          {tab === 'renew' ? <RenewScreen /> : null}
        </div>
        <div hidden={tab !== 'help'} className="customer-panel" data-testid="tab-help">
          <HelpScreen />
        </div>
      </div>
      <nav className="home-tabs" aria-label="منوی مشتری">
        {HOME_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="home-tab"
            data-selected={tab === item.id ? 'true' : 'false'}
            data-testid={`home-tab-${item.id}`}
            onClick={() => {
              setTab(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
