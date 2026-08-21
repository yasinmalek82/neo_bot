# Design QA — Neo Bot Mini App

## Source of truth

- Selected visual direction: `/Users/yasin_mst/.codex/generated_images/01a02015-9ccd-7553-8b91-ef24e73a0a0c/exec-5d3c1932-7f72-4a1c-9607-e6eee50fbdb6.png`
- Implemented iPhone screen: `/Users/yasin_mst/Documents/neo_bot/apps/admin-web/docs/design-qa/implementation-iphone.jpg`
- Implemented service options screen: `/Users/yasin_mst/Documents/neo_bot/apps/admin-web/docs/design-qa/service-options-volume.jpg`
- Side-by-side comparison: `/Users/yasin_mst/Documents/neo_bot/apps/admin-web/docs/design-qa/source-vs-implementation.jpg`

## Capture contract

- App viewport: iPhone `393 × 852` CSS px
- Capture density: `1x`
- Browser viewport used to avoid runtime scaling: `1400 × 1100`
- Compared state: initial catalog, `مولتی‌لوکیشن اقتصادی` selected
- Alternate runtime checked: Pixel 10, `427 × 952`

## Full comparison

The final side-by-side input compares the complete initial catalog from top brand mark through the fixed purchase summary and CTA. Separate focused crops were not required because the entire mobile viewport fits at native comparison height and all critical regions remain legible together.

## QA history

### Pass 1

- P1 — The plan icon and radio columns were physically reversed for RTL. Fixed by separating physical grid direction from text direction.
- P1 — The footer occupied too much vertical space and hid the third plan/support row. Fixed by removing duplicate safe-area padding and reducing the route footer height.
- P2 — The brand mark appeared on the left instead of the right. Fixed by correcting the RTL auto margin.
- P2 — The selected plan title was truncated by the recommendation badge. Fixed by moving the badge into its own non-blocking position.

### Pass 2

- P1 — System Arabic fallback was wider and visually rougher than the source. Fixed with the locally bundled variable Vazirmatn font.
- P2 — The selected plan looked like a generic rounded card instead of the source's lighter row treatment. Fixed with a subtle tint and a physical-left cyan state rail.
- P2 — The recommendation badge lacked the source's filled mint emphasis. Fixed with the shared accent token and dark ink color.

### Pass 3

- The complete flow was exercised: plan selection → duration selection → order review → missing-receipt validation → receipt ready → success.
- All initial-screen interactive targets measured at least `56px` high for the CTA and `124px` high for plan rows.
- iPhone and Pixel 10 layouts were visually checked; no overlap, clipped controls, or broken hierarchy found.
- Browser console errors: none.
- Semantic radio state, alert state, reduced-motion handling, RTL direction, and descriptive labels are present.

### Pass 4 — Volume-aware variants

- P1 — Multi-location products did not expose their required traffic volume before duration selection. Fixed with a horizontally draggable, RTL volume selector on the service-options step.
- P1 — Price and payment summary were not tied to volume. Fixed with exact fixture prices per volume/duration combination and a conditional volume row in order review.
- The unlimited plan skips volume completely and keeps the shorter duration-only journey.
- Economy `100 GB × 3 months`, Special `200 GB × 6 months`, and Unlimited `3 months` were exercised through payment review; selected volume, exact price, and summary stayed consistent with no console errors.
- Catalog CTA now says `ادامه و انتخاب حجم` only when the selected plan requires traffic selection.

### Pass 5 — Admin-published catalog

- Removed product, volume, duration and price fixtures from the Mini App runtime. The public catalog
  API is now the only source for visible products and exact selectable combinations.
- Published an additional `75 GB × 30 days` economy row from the administration console and verified
  that the Mini App rendered the new volume and `125,000 toman` price without a frontend code change.
- Verified loading, unavailable-catalog and empty-product states.
- Verified that provider codes and PasarGuard group IDs are absent from the public response.
- Verified the complete `75 GB` route through payment review, including database-backed card details,
  with no console errors in fresh admin and Mini App tabs.

## Intentional product improvements

- The unverified “money-back guarantee” claim from the concept was replaced with truthful delivery/support language.
- The concept became a working three-step purchase journey while retaining the selected navy/mint palette, hierarchy, row anatomy, and fixed CTA.
- Card information is administrator-managed but currently contains an explicit test value. Order
  creation and receipt upload remain simulated in this visual prototype until Telegram Mini App
  authentication and checkout endpoints are connected.
- Visual layout and entirely new selector dimensions remain code-owned; catalog values on the volume,
  duration and connection axes are data-driven and unbounded.

## Final result

passed
