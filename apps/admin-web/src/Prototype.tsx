import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BarChartIcon,
  CheckCircledIcon,
  CheckIcon,
  ClockIcon,
  GlobeIcon,
  LightningBoltIcon,
  LockClosedIcon,
  LoopIcon,
  StarIcon,
  UploadIcon,
} from '@radix-ui/react-icons';
import {
  createContext,
  useEffect,
  useContext,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Carousel, FlowStack, MobileScroll, type FlowControls, type FlowScreen } from './mobile';
import { readTelegramInitData, prepareTelegramWebApp } from './telegram-webapp';

type ReceiptStatus = 'idle' | 'uploaded' | 'error';

interface VolumeOption {
  id: number;
  label: string;
  detail: string;
  fromPrice: number;
}

interface Plan {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  fromPrice: number;
  icon: ComponentType<{ width?: number; height?: number }>;
  iconKey: CatalogProduct['iconKey'];
  variants: readonly CatalogVariant[];
  badge?: string;
}

interface DurationOption {
  id: number;
  label: string;
  detail: string;
  price: number;
}

interface CatalogVariant {
  id: string;
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
}

interface CatalogProduct {
  id: string;
  code: string;
  name: string;
  shortName: string;
  description: string;
  badge: string | null;
  iconKey: 'loop' | 'globe' | 'star' | 'bolt';
  position: number;
  variants: readonly CatalogVariant[];
}

interface CatalogResponse {
  settings: {
    brandName: string;
    heroTitle: string;
    heroSubtitle: string;
    deliveryNote: string;
    supportNote: string;
    volumeHelper: string;
  };
  products: readonly CatalogProduct[];
}

const iconByKey: Record<
  CatalogProduct['iconKey'],
  ComponentType<{ width?: number; height?: number }>
> = {
  loop: LoopIcon,
  globe: GlobeIcon,
  star: StarIcon,
  bolt: LightningBoltIcon,
};

const viteEnvironment = import.meta.env as unknown as { readonly VITE_API_BASE_URL?: string };
const apiBaseUrl =
  viteEnvironment.VITE_API_BASE_URL ??
  (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
    ? 'http://127.0.0.1:3100'
    : '');

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

interface PurchaseContextValue {
  settings: CatalogResponse['settings'];
  selectedPlan: Plan;
  selectedDuration: DurationOption;
  selectedVolume: VolumeOption | null;
  selectedDeviceLimit: number;
  selectedVariantId: string;
  deviceOptions: readonly number[];
  volumeOptions: readonly VolumeOption[];
  durationOptions: readonly DurationOption[];
  receiptStatus: ReceiptStatus;
  checkoutReady: boolean;
  checkoutError: string | null;
  totalPrice: number;
  plans: readonly Plan[];
  setPlan: (planId: string) => void;
  setDuration: (durationDays: number) => void;
  setVolume: (volumeGb: number) => void;
  setDeviceLimit: (deviceLimit: number) => void;
  setReceiptStatus: (status: ReceiptStatus) => void;
  setCheckoutReady: (ready: boolean) => void;
  setCheckoutError: (error: string | null) => void;
}

const PurchaseContext = createContext<PurchaseContextValue | null>(null);

function usePurchase() {
  const value = useContext(PurchaseContext);
  if (!value) throw new Error('usePurchase must be used inside PurchaseProvider');
  return value;
}

function formatPrice(value: number) {
  return new Intl.NumberFormat('fa-IR').format(Math.round(value));
}

function formatCardNumber(value: string) {
  return value.match(/.{1,4}/gu)?.join(' ') ?? value;
}

function PurchaseProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [planId, setPlanId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [receiptStatus, setReceiptStatus] = useState<ReceiptStatus>('idle');
  const [checkoutReady, setCheckoutReady] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    void fetch(`${apiBaseUrl}/catalog`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('CATALOG_UNAVAILABLE');
        return (await response.json()) as CatalogResponse;
      })
      .then((nextCatalog) => {
        if (nextCatalog.products.length === 0) throw new Error('CATALOG_EMPTY');
        setCatalog(nextCatalog);
        const preferred =
          nextCatalog.products.find((product) => product.badge) ?? nextCatalog.products.at(0);
        if (preferred === undefined) throw new Error('CATALOG_EMPTY');
        const preferredVariant = preferred.variants.at(0);
        if (preferredVariant === undefined) throw new Error('CATALOG_PRODUCT_EMPTY');
        setPlanId(preferred.id);
        setVariantId(preferredVariant.id);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(true);
      });
    return () => {
      controller.abort();
    };
  }, [reloadKey]);

  if (catalog === null) {
    return (
      <MobileScroll className="app-screen catalog-state-page">
        <main className="catalog-state" dir="rtl" role={loadError ? 'alert' : 'status'}>
          <BrandMark />
          <h1>{loadError ? 'کاتالوگ فعلاً در دسترس نیست' : 'در حال دریافت سرویس‌ها'}</h1>
          <p>
            {loadError
              ? 'اتصال به سرور برقرار نشد. چند لحظه دیگر دوباره تلاش کن.'
              : 'قیمت‌ها و گزینه‌های تازه را از پنل مدیریت می‌گیریم.'}
          </p>
          {loadError ? (
            <button
              type="button"
              className="primary-button state-retry"
              onClick={() => {
                setReloadKey((key) => key + 1);
              }}
            >
              تلاش دوباره
            </button>
          ) : (
            <span className="state-loader" aria-hidden="true" />
          )}
        </main>
      </MobileScroll>
    );
  }

  const plans: readonly Plan[] = catalog.products.map((product) => ({
    id: product.id,
    title: product.name,
    shortTitle: product.shortName.length > 0 ? product.shortName : product.name,
    description: product.description,
    fromPrice: Math.min(...product.variants.map((variant) => variant.priceToman)),
    icon: iconByKey[product.iconKey],
    iconKey: product.iconKey,
    variants: product.variants,
    ...(product.badge ? { badge: product.badge } : {}),
  }));
  const selectedPlan = plans.find((plan) => plan.id === planId) ?? plans.at(0);
  if (selectedPlan === undefined) {
    return (
      <MobileScroll className="app-screen catalog-state-page">
        <main className="catalog-state" dir="rtl" role="alert">
          <BrandMark />
          <h1>محصول قابل فروشی تعریف نشده</h1>
          <p>از پنل مدیریت حداقل یک ترکیب فعال با قیمت معتبر اضافه کن.</p>
        </main>
      </MobileScroll>
    );
  }
  const selectedVariant =
    selectedPlan.variants.find((variant) => variant.id === variantId) ??
    selectedPlan.variants.at(0);
  if (selectedVariant === undefined) {
    return (
      <MobileScroll className="app-screen catalog-state-page">
        <main className="catalog-state" dir="rtl" role="alert">
          <BrandMark />
          <h1>این محصول گزینه قابل فروشی ندارد</h1>
          <p>از پنل مدیریت حداقل یک ترکیب فعال با قیمت معتبر اضافه کن.</p>
        </main>
      </MobileScroll>
    );
  }

  const volumeOptions = uniqueNumbers(selectedPlan.variants.map((variant) => variant.dataLimitGb))
    .filter((volume) => volume > 0)
    .map((volume) => {
      const variants = selectedPlan.variants.filter((variant) => variant.dataLimitGb === volume);
      const first = variants.at(0);
      return {
        id: volume,
        label:
          first !== undefined && first.dataLimitLabel.length > 0
            ? first.dataLimitLabel
            : `${formatPrice(volume)} گیگ`,
        detail:
          first !== undefined && first.description.length > 0
            ? first.description
            : 'حجم مشترک سرویس',
        fromPrice: Math.min(...variants.map((variant) => variant.priceToman)),
      };
    });
  const selectedVolume =
    volumeOptions.find((volume) => volume.id === selectedVariant.dataLimitGb) ?? null;
  const variantsForVolume = selectedPlan.variants.filter(
    (variant) => variant.dataLimitGb === selectedVariant.dataLimitGb,
  );
  const deviceOptions = uniqueNumbers(
    variantsForVolume
      .filter((variant) => variant.durationDays === selectedVariant.durationDays)
      .map((variant) => variant.deviceLimit),
  );
  const durationOptions = uniqueNumbers(
    variantsForVolume.map((variant) => variant.durationDays),
  ).map((days) => {
    const exact =
      variantsForVolume.find(
        (variant) =>
          variant.durationDays === days && variant.deviceLimit === selectedVariant.deviceLimit,
      ) ?? variantsForVolume.find((variant) => variant.durationDays === days);
    return {
      id: days,
      label:
        exact !== undefined && exact.durationLabel.length > 0
          ? exact.durationLabel
          : `${formatPrice(days)} روزه`,
      detail: `${formatPrice(days)} روز دسترسی`,
      price: exact?.priceToman ?? selectedVariant.priceToman,
    };
  });
  const selectedDuration =
    durationOptions.find((duration) => duration.id === selectedVariant.durationDays) ??
    durationOptions.at(0);
  if (selectedDuration === undefined) throw new Error('CATALOG_VARIANT_WITHOUT_DURATION');

  const chooseVariant = (candidates: readonly (CatalogVariant | undefined)[]) => {
    const next = candidates.find((candidate) => candidate !== undefined);
    if (next !== undefined) setVariantId(next.id);
    setReceiptStatus('idle');
    setCheckoutReady(false);
    setCheckoutError(null);
  };

  const value: PurchaseContextValue = {
    settings: catalog.settings,
    selectedPlan,
    selectedDuration,
    selectedVolume,
    selectedDeviceLimit: selectedVariant.deviceLimit,
    selectedVariantId: selectedVariant.id,
    deviceOptions,
    volumeOptions,
    durationOptions,
    receiptStatus,
    checkoutReady,
    checkoutError,
    totalPrice: selectedVariant.priceToman,
    plans,
    setPlan: (nextPlanId) => {
      const nextPlan = plans.find((plan) => plan.id === nextPlanId);
      if (nextPlan === undefined) return;
      setPlanId(nextPlanId);
      setVariantId(nextPlan.variants[0]?.id ?? null);
      setReceiptStatus('idle');
      setCheckoutReady(false);
      setCheckoutError(null);
    },
    setDuration: (durationDays) => {
      chooseVariant([
        selectedPlan.variants.find(
          (variant) =>
            variant.durationDays === durationDays &&
            variant.dataLimitGb === selectedVariant.dataLimitGb &&
            variant.deviceLimit === selectedVariant.deviceLimit,
        ),
        selectedPlan.variants.find(
          (variant) =>
            variant.durationDays === durationDays &&
            variant.dataLimitGb === selectedVariant.dataLimitGb,
        ),
      ]);
    },
    setVolume: (volumeGb) => {
      chooseVariant([
        selectedPlan.variants.find(
          (variant) =>
            variant.dataLimitGb === volumeGb &&
            variant.durationDays === selectedVariant.durationDays &&
            variant.deviceLimit === selectedVariant.deviceLimit,
        ),
        selectedPlan.variants.find(
          (variant) =>
            variant.dataLimitGb === volumeGb &&
            variant.durationDays === selectedVariant.durationDays,
        ),
        selectedPlan.variants.find((variant) => variant.dataLimitGb === volumeGb),
      ]);
    },
    setDeviceLimit: (deviceLimit) => {
      chooseVariant([
        selectedPlan.variants.find(
          (variant) =>
            variant.deviceLimit === deviceLimit &&
            variant.dataLimitGb === selectedVariant.dataLimitGb &&
            variant.durationDays === selectedVariant.durationDays,
        ),
        selectedPlan.variants.find(
          (variant) =>
            variant.deviceLimit === deviceLimit &&
            variant.dataLimitGb === selectedVariant.dataLimitGb,
        ),
      ]);
    },
    setReceiptStatus,
    setCheckoutReady,
    setCheckoutError,
  };

  return <PurchaseContext.Provider value={value}>{children}</PurchaseContext.Provider>;
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
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

function BrandMark() {
  return (
    <div className="brand-mark" aria-label="نئوبات">
      <LightningBoltIcon width={28} height={28} />
    </div>
  );
}

function CatalogScreen() {
  const { plans, selectedPlan, setPlan, settings } = usePurchase();

  return (
    <MobileScroll className="app-screen catalog-page">
      <main className="catalog-content" dir="rtl" data-testid="catalog-screen">
        <BrandMark />

        <header className="hero-copy">
          <h1>{settings.heroTitle}</h1>
          <p className="hero-subtitle">{settings.heroSubtitle}</p>
        </header>

        <section className="plan-list" role="radiogroup" aria-label="انتخاب نوع سرویس">
          {plans.map((plan) => {
            const selected = plan.id === selectedPlan.id;
            const Icon = plan.icon;

            return (
              <button
                key={plan.id}
                className="plan-option"
                data-selected={selected ? 'true' : 'false'}
                data-testid={`plan-${plan.id}`}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setPlan(plan.id);
                }}
              >
                <span className="plan-icon" aria-hidden="true">
                  <Icon width={28} height={28} />
                </span>
                <span className="plan-body">
                  <span className="plan-title-line">
                    <strong>{plan.title}</strong>
                    {plan.badge ? <span className="plan-badge">{plan.badge}</span> : null}
                  </span>
                  <span className="plan-description">{plan.description}</span>
                  <span className="plan-price">
                    از <b>{formatPrice(plan.fromPrice)}</b> تومان
                  </span>
                </span>
                <span
                  className="radio-mark"
                  data-checked={selected ? 'true' : 'false'}
                  aria-hidden="true"
                >
                  <span />
                </span>
              </button>
            );
          })}
        </section>

        <div className="trust-note">
          <LockClosedIcon width={18} height={18} aria-hidden="true" />
          <span>{settings.deliveryNote}</span>
          <span className="trust-separator" aria-hidden="true" />
          <span>{settings.supportNote}</span>
        </div>
      </main>
    </MobileScroll>
  );
}

function CatalogFooter({ flow }: { flow: FlowControls }) {
  const { selectedPlan, volumeOptions } = usePurchase();
  const requiresVolume = volumeOptions.length > 0;

  return (
    <div className="purchase-footer catalog-footer" dir="rtl">
      <div className="footer-summary" aria-live="polite">
        <span>
          انتخاب شما: <strong>{selectedPlan.shortTitle}</strong>
        </span>
        <span className="footer-price">
          از <b>{formatPrice(selectedPlan.fromPrice)}</b> تومان
        </span>
      </div>
      <button
        className="primary-button"
        type="button"
        onClick={() => {
          flow.push(serviceOptionsScreen);
        }}
      >
        <span>{requiresVolume ? 'ادامه و انتخاب حجم' : 'ادامه و انتخاب مدت زمان'}</span>
        <ArrowLeftIcon width={22} height={22} aria-hidden="true" />
      </button>
    </div>
  );
}

function ServiceOptionsScreen() {
  const {
    selectedPlan,
    selectedDuration,
    selectedVolume,
    selectedDeviceLimit,
    deviceOptions,
    durationOptions,
    volumeOptions,
    settings,
    setDuration,
    setVolume,
    setDeviceLimit,
  } = usePurchase();
  const SelectedPlanIcon = selectedPlan.icon;
  const hasVolumeOptions = volumeOptions.length > 0;

  return (
    <MobileScroll className="app-screen detail-page">
      <main className="detail-content" dir="rtl" data-testid="service-options-screen">
        <section className="selected-plan-card">
          <div className="selected-plan-icon" aria-hidden="true">
            <SelectedPlanIcon width={24} height={24} />
          </div>
          <div>
            <span className="section-kicker">سرویس انتخابی</span>
            <h1>{selectedPlan.title}</h1>
            <p>{selectedPlan.description}</p>
          </div>
          <CheckCircledIcon className="selected-check" width={22} height={22} aria-hidden="true" />
        </section>

        {hasVolumeOptions ? (
          <section className="volume-section" aria-labelledby="volume-title">
            <div className="section-heading">
              <div>
                <p className="section-kicker">مرحله ۲ از ۳</p>
                <h2 id="volume-title">حجم مورد نیازت را انتخاب کن</h2>
              </div>
              <BarChartIcon width={20} height={20} aria-hidden="true" />
            </div>

            <div role="radiogroup" aria-label="حجم سرویس">
              <Carousel
                ariaLabel="انتخاب حجم سرویس"
                className="volume-carousel"
                contentClassName="volume-track"
              >
                {volumeOptions.map((volume) => {
                  const selected = volume.id === selectedVolume?.id;

                  return (
                    <button
                      key={volume.id}
                      className="volume-option"
                      data-selected={selected ? 'true' : 'false'}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`${volume.label}، ${volume.detail}، از ${formatPrice(volume.fromPrice)} تومان`}
                      onClick={() => {
                        setVolume(volume.id);
                      }}
                    >
                      <span className="volume-check" aria-hidden="true">
                        {selected ? <CheckIcon width={14} height={14} /> : null}
                      </span>
                      <strong>{volume.label}</strong>
                      <small>{volume.detail}</small>
                      <b>از {formatPrice(volume.fromPrice)} تومان</b>
                    </button>
                  );
                })}
              </Carousel>
            </div>
            <p className="volume-helper">{settings.volumeHelper}</p>
          </section>
        ) : null}

        {deviceOptions.length > 1 ? (
          <section className="device-section" aria-labelledby="device-title">
            <div className="section-heading">
              <div>
                <p className="section-kicker">تعداد اتصال</p>
                <h2 id="device-title">چند دستگاه هم‌زمان وصل می‌شوند؟</h2>
              </div>
              <GlobeIcon width={20} height={20} aria-hidden="true" />
            </div>
            <div
              className="duration-list compact-options"
              role="radiogroup"
              aria-label="تعداد اتصال هم‌زمان"
            >
              {deviceOptions.map((deviceLimit) => {
                const selected = deviceLimit === selectedDeviceLimit;
                return (
                  <button
                    key={deviceLimit}
                    className="duration-option"
                    data-selected={selected ? 'true' : 'false'}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setDeviceLimit(deviceLimit);
                    }}
                  >
                    <span className="duration-radio" aria-hidden="true">
                      {selected ? <CheckIcon width={16} height={16} /> : null}
                    </span>
                    <span className="duration-copy">
                      <strong>{formatPrice(deviceLimit)} اتصال</strong>
                      <small>استفاده هم‌زمان</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        <section
          className="duration-section"
          data-after-volume={hasVolumeOptions ? 'true' : 'false'}
          aria-labelledby="duration-title"
        >
          <div className="section-heading">
            <div>
              <p className="section-kicker">{hasVolumeOptions ? 'مدت استفاده' : 'مرحله ۲ از ۳'}</p>
              <h2 id="duration-title">مدت سرویس را انتخاب کن</h2>
            </div>
            <ClockIcon width={20} height={20} aria-hidden="true" />
          </div>

          <div className="duration-list" role="radiogroup" aria-label="مدت سرویس">
            {durationOptions.map((duration) => {
              const selected = duration.id === selectedDuration.id;

              return (
                <button
                  key={duration.id}
                  className="duration-option"
                  data-selected={selected ? 'true' : 'false'}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setDuration(duration.id);
                  }}
                >
                  <span className="duration-radio" aria-hidden="true">
                    {selected ? <CheckIcon width={16} height={16} /> : null}
                  </span>
                  <span className="duration-copy">
                    <strong>{duration.label}</strong>
                    <small>{duration.detail}</small>
                  </span>
                  <span className="duration-price">
                    <b>{formatPrice(duration.price)}</b>
                    <small>تومان</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="info-note">
          <CheckCircledIcon width={18} height={18} aria-hidden="true" />
          <span>قبل از پرداخت، همه جزئیات سفارش را دوباره می‌بینی.</span>
        </div>
      </main>
    </MobileScroll>
  );
}

function ServiceOptionsFooter({ flow }: { flow: FlowControls }) {
  const { totalPrice } = usePurchase();

  return (
    <div className="purchase-footer compact-footer" dir="rtl">
      <div className="compact-total">
        <span>مبلغ نهایی</span>
        <strong>{formatPrice(totalPrice)} تومان</strong>
      </div>
      <button
        className="primary-button compact-primary"
        type="button"
        onClick={() => {
          flow.push(paymentScreen);
        }}
      >
        <span>مرور و پرداخت</span>
        <ArrowLeftIcon width={22} height={22} aria-hidden="true" />
      </button>
    </div>
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

function PaymentScreen() {
  const {
    selectedPlan,
    selectedDuration,
    selectedVolume,
    selectedDeviceLimit,
    totalPrice,
    selectedVariantId,
    checkoutError,
    setCheckoutReady,
    setCheckoutError,
  } = usePurchase();
  const [payment, setPayment] = useState<{ cardNumber: string; cardHolder: string } | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const idempotencyKey = useRef(`telegram:miniapp:${crypto.randomUUID()}`);

  useEffect(() => {
    const initData = readTelegramInitData();
    if (initData === null) {
      setCheckoutError('این صفحه را از داخل ربات تلگرام باز کن.');
      setCheckoutReady(false);
      return;
    }
    const headers = {
      'X-Telegram-Init-Data': initData,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey.current,
    };
    const controller = new AbortController();
    setCheckoutError(null);
    setCheckoutReady(false);
    void fetch(`${apiBaseUrl}/customer/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ productVariantId: selectedVariantId }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readApiErrorCode(response));
        }
        return (await response.json()) as CustomerOrderResponse;
      })
      .then((created) => {
        setOrderStatus(created.order?.status ?? null);
        setPayment(created.payment);
        setCheckoutReady(created.payment !== null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const code = error instanceof Error ? error.message : 'CHECKOUT_FAILED';
        setCheckoutError(checkoutErrorCopy(code));
        setCheckoutReady(false);
      });
    const poll = window.setInterval(() => {
      void fetch(`${apiBaseUrl}/customer/orders/current`, {
        headers: { 'X-Telegram-Init-Data': initData },
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return null;
          return (await response.json()) as CustomerOrderResponse;
        })
        .then((current) => {
          if (current === null) return;
          if (current.order === null) {
            setOrderStatus((previous) =>
              previous === null || previous === 'fulfilled' ? previous : 'fulfilled',
            );
            return;
          }
          setOrderStatus(current.order.status);
          setPayment(current.payment);
        })
        .catch(() => undefined);
    }, 4_000);
    return () => {
      controller.abort();
      window.clearInterval(poll);
    };
  }, [selectedVariantId, retryKey, setCheckoutError, setCheckoutReady]);

  return (
    <MobileScroll className="app-screen detail-page">
      <main className="detail-content payment-content" dir="rtl" data-testid="payment-screen">
        <section className="order-card" aria-labelledby="order-summary-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="section-kicker">مرحله ۳ از ۳</p>
              <h2 id="order-summary-title">خلاصه سفارش</h2>
            </div>
            <CheckCircledIcon width={21} height={21} aria-hidden="true" />
          </div>
          <OrderLine label="سرویس" value={selectedPlan.shortTitle} />
          {selectedVolume ? <OrderLine label="حجم" value={selectedVolume.label} /> : null}
          {selectedDeviceLimit > 0 ? (
            <OrderLine label="اتصال هم‌زمان" value={`${formatPrice(selectedDeviceLimit)} دستگاه`} />
          ) : null}
          <OrderLine label="مدت" value={selectedDuration.label} />
          <div className="order-total">
            <span>قابل پرداخت</span>
            <strong>{formatPrice(totalPrice)} تومان</strong>
          </div>
        </section>

        <section className="card-payment-card" aria-labelledby="card-payment-title">
          <div className="card-payment-head">
            <div>
              <p className="section-kicker">پرداخت کارت‌به‌کارت</p>
              <h2 id="card-payment-title">واریز و ارسال رسید</h2>
            </div>
            <LockClosedIcon width={20} height={20} aria-hidden="true" />
          </div>

          {payment ? (
            <>
              <div className="placeholder-card-number" aria-label="شماره کارت پرداخت" dir="ltr">
                <b>{formatCardNumber(payment.cardNumber)}</b>
              </div>
              <p className="placeholder-hint">به نام {payment.cardHolder}</p>
            </>
          ) : (
            <p className="placeholder-hint">
              {checkoutError ?? 'شماره کارت بعد از احراز هویت در تلگرام نمایش داده می‌شود.'}
            </p>
          )}

          {checkoutError ? (
            <button
              type="button"
              className="primary-button state-retry"
              onClick={() => {
                idempotencyKey.current = `telegram:miniapp:${crypto.randomUUID()}`;
                setRetryKey((key) => key + 1);
              }}
            >
              تلاش دوباره
            </button>
          ) : null}

          <div className="info-note">
            <UploadIcon width={20} height={20} aria-hidden="true" />
            <span>عکس رسید را در چت خصوصی ربات بفرست. اینجا فایل آپلود نمی‌شود.</span>
          </div>
          {orderStatus ? (
            <p className="placeholder-hint" data-testid="order-status">
              وضعیت سفارش: {customerOrderStatusLabel(orderStatus)}
            </p>
          ) : null}
        </section>
      </main>
    </MobileScroll>
  );
}

function PaymentFooter({ flow }: { flow: FlowControls }) {
  const { checkoutReady, checkoutError } = usePurchase();
  const canContinue = checkoutReady && checkoutError === null;

  return (
    <div className="purchase-footer payment-footer" dir="rtl">
      <button
        className="primary-button"
        type="button"
        disabled={!canContinue}
        onClick={() => {
          if (!canContinue) return;
          flow.push(successScreen);
        }}
      >
        <span>
          {canContinue
            ? 'متوجه شدم؛ رسید را در ربات می‌فرستم'
            : (checkoutError ?? 'در حال ثبت سفارش…')}
        </span>
        <ArrowLeftIcon width={22} height={22} aria-hidden="true" />
      </button>
      <p>تأیید پرداخت و لینک سرویس فقط از طریق چت ربات می‌آید.</p>
    </div>
  );
}

function SuccessScreen() {
  return (
    <MobileScroll className="app-screen success-page">
      <main className="success-content" dir="rtl" data-testid="success-screen">
        <div className="success-icon" aria-hidden="true">
          <CheckIcon width={34} height={34} />
        </div>
        <p className="section-kicker">سفارش ثبت شد</p>
        <h1>رسید را در چت ربات بفرست</h1>
        <p>
          عکس رسید را در همین ربات ارسال کن. نتیجه تأیید و لینک سرویس همان‌جا می‌آید و لازم نیست
          دوباره از مینی‌اپ فایل بفرستی.
        </p>
        <div className="success-note">
          <ClockIcon width={18} height={18} aria-hidden="true" />
          <span>وضعیت سفارش در صفحه پرداخت هم به‌روز می‌شود.</span>
        </div>
      </main>
    </MobileScroll>
  );
}

const catalogScreen: FlowScreen = {
  id: 'catalog',
  footerHeight: 122,
  footer: (flow) => <CatalogFooter flow={flow} />,
  render: () => <CatalogScreen />,
};

const serviceOptionsScreen: FlowScreen = {
  id: 'service-options',
  headerHeight: 56,
  header: (flow) => <AppToolbar title="مشخصات سرویس" flow={flow} />,
  footerHeight: 132,
  footer: (flow) => <ServiceOptionsFooter flow={flow} />,
  render: () => <ServiceOptionsScreen />,
};

const paymentScreen: FlowScreen = {
  id: 'payment',
  headerHeight: 56,
  header: (flow) => <AppToolbar title="پرداخت امن" flow={flow} />,
  footerHeight: 130,
  footer: (flow) => <PaymentFooter flow={flow} />,
  render: () => <PaymentScreen />,
};

const successScreen: FlowScreen = {
  id: 'success',
  render: () => <SuccessScreen />,
};

export default function Prototype() {
  useEffect(() => {
    prepareTelegramWebApp();
  }, []);
  return (
    <PurchaseProvider>
      <FlowStack initial={catalogScreen} />
    </PurchaseProvider>
  );
}

async function readApiErrorCode(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === 'string' ? body.message : 'CHECKOUT_FAILED';
}

function checkoutErrorCopy(code: string): string {
  switch (code) {
    case 'INIT_DATA_REQUIRED':
    case 'INIT_DATA_INVALID':
    case 'INIT_DATA_EXPIRED':
      return 'این صفحه را از داخل ربات تلگرام باز کن.';
    case 'PAYMENT_DETAILS_MISSING':
      return 'شماره کارت هنوز منتشر نشده. الان پرداخت نکن.';
    case 'OPEN_ORDER_UNDER_REVIEW':
      return 'یک سفارش در حال بررسی داری. اول نتیجه همان را ببین.';
    case 'PRODUCT_VARIANT_NOT_SELLABLE':
      return 'این پلن دیگر قابل خرید نیست.';
    default:
      return 'ثبت سفارش انجام نشد. دوباره تلاش کن.';
  }
}

function customerOrderStatusLabel(status: string): string {
  switch (status) {
    case 'awaiting_receipt':
      return 'منتظر عکس رسید';
    case 'receipt_submitted':
      return 'رسید در حال بررسی';
    case 'rejected':
      return 'رسید تأیید نشد؛ عکس واضح‌تر را در ربات بفرست';
    case 'provisioning':
      return 'در حال آماده‌سازی سرویس';
    case 'provisioning_failed':
      return 'آماده‌سازی ناتمام؛ نتیجه در چت ربات می‌آید';
    case 'fulfilled':
      return 'سرویس آماده است؛ لینک را در چت ربات ببین';
    case 'cancelled':
      return 'سفارش لغو شد';
    default:
      return 'در حال پیگیری';
  }
}
