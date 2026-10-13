/**
 * Single source of truth for every backend path the mobile app calls.
 *
 * Why: before Phase 1 the paths were string literals scattered across screens, which let two real
 * mismatches ship (`/api/mobile/driver/proof` vs the server's `/driver/delivery-receipt`, and
 * `/mobile/device-token` missing its `/api` prefix — swallowed by the old mock engine). Every call
 * site must import from here; a path that exists in only one place cannot drift.
 *
 * Paths are absolute (they include `/api/...`) so they can be used with the configured axios
 * `baseURL` exactly as before.
 */

export const API_PREFIX = '/api/mobile';

export const Endpoints = {
  /** Public: app version / maintenance window / server jalali date. */
  meta: `${API_PREFIX}/meta`,

  /** Push notification device registration (auth required). */
  deviceToken: `${API_PREFIX}/device-token`,

  auth: {
    requestOtp: `${API_PREFIX}/auth/otp/request`,
    verifyOtp: `${API_PREFIX}/auth/otp/verify`,
    login: `${API_PREFIX}/auth/login`,
    refresh: `${API_PREFIX}/auth/refresh`,
    logout: `${API_PREFIX}/auth/logout`,
  },

  driver: {
    /** Loads assigned to the logged-in driver (active + completed). */
    loads: `${API_PREFIX}/driver/loads`,
    /**
     * Trip status report (Phase 2, G-8): PATCH `{ status }` with one of
     * assigned | at_origin | loading | at_destination | unloading | delivered | cancelled.
     * The server refuses backwards moves (409) and `delivered` without a delivery receipt.
     */
    tripStatus: (invoiceId: number | string) =>
      `${API_PREFIX}/driver/loads/${encodeURIComponent(String(invoiceId))}/trip-status`,
    /** Proof of delivery (photos + signature + GPS). Canonical server route. */
    submitProof: `${API_PREFIX}/driver/delivery-receipt`,
    /** @deprecated server-side alias kept only for APKs built before Phase 1 — do not use. */
    legacySubmitProof: `${API_PREFIX}/driver/proof`,
  },

  farmer: {
    dashboard: `${API_PREFIX}/farmer/dashboard`,
    invoices: `${API_PREFIX}/farmer/invoices`,
    orders: `${API_PREFIX}/farmer/orders`,
  },

  manager: {
    kpi: `${API_PREFIX}/manager/kpi`,
    weighbridge: `${API_PREFIX}/manager/weighbridge`,
    /** Farmer feed orders cartable (کارتابل سفارش‌های جیره). */
    orders: `${API_PREFIX}/manager/orders`,
    /** Approve / reject a single feed order. */
    orderStatus: (orderId: number | string) => `${API_PREFIX}/manager/orders/${encodeURIComponent(String(orderId))}`,
    /** Delivery proofs (POD) submitted by drivers. */
    proofs: `${API_PREFIX}/manager/proofs`,
    /**
     * Waybills that carry a driver name but no `driver_id` link, grouped by name (Phase 2, G-7).
     * Read-only: it reports the groups plus the best candidate driver per name.
     */
    unmatchedDrivers: `${API_PREFIX}/manager/unmatched-drivers`,
  },

  /** Shared web endpoints the mobile app reuses (already served by the web API). */
  web: {
    farmers: '/api/farmers',
    warehouses: '/api/warehouses',
    invoices: '/api/invoices',
  },
} as const;

export default Endpoints;
