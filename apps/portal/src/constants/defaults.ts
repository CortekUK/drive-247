/**
 * Application Default Values
 *
 * This file contains all default configuration values used throughout the application.
 * Centralizing these values makes it easier to maintain and adjust application behavior.
 */

// ============================================
// PAGINATION DEFAULTS
// ============================================

export const PAGINATION_DEFAULTS = {
  /** Default page size for customer listings */
  CUSTOMERS_PAGE_SIZE: 25,

  /** Default page size for payment listings */
  PAYMENTS_PAGE_SIZE: 25,

  /** Default page size for vehicle listings */
  VEHICLES_PAGE_SIZE: 25,

  /** Default page size for rental listings */
  RENTALS_PAGE_SIZE: 25,

  /** Default page size for plate listings */
  PLATES_PAGE_SIZE: 50,

  /** Default page size for fines listings */
  FINES_PAGE_SIZE: 25,
} as const;

// ============================================
// TIMING & DEBOUNCE DEFAULTS
// ============================================

export const TIMING_DEFAULTS = {
  /** Search input debounce delay (milliseconds) */
  SEARCH_DEBOUNCE_MS: 300,

  /** Toast notification auto-removal delay (milliseconds) */
  TOAST_REMOVE_DELAY_MS: 3000,

  /** Print window close delay (milliseconds) */
  PRINT_CLOSE_DELAY_MS: 1000,

  /** Page reload delay after cleanup operations (milliseconds) */
  PAGE_RELOAD_DELAY_MS: 1000,

  /** Customer status auto-refresh interval (milliseconds) */
  CUSTOMER_STATUS_REFRESH_MS: 5000,
} as const;

// ============================================
// REACT QUERY CACHE DEFAULTS
// ============================================

export const QUERY_CACHE_DEFAULTS = {
  /** Global default stale time for cached queries (1 minute) */
  DEFAULT_STALE_TIME_MS: 60 * 1000,

  /** Short stale time for frequently updated data (30 seconds) */
  SHORT_STALE_TIME_MS: 30 * 1000,

  /** Force fresh data (no caching) */
  NO_CACHE_STALE_TIME_MS: 0,

  /** Global refetch on window focus setting */
  REFETCH_ON_WINDOW_FOCUS: false,
} as const;

// ============================================
// REFETCH INTERVAL DEFAULTS
// ============================================

export const REFETCH_INTERVALS = {
  /** Frequent refetch interval (30 seconds) - for critical data */
  FREQUENT_MS: 30 * 1000,

  /** Standard refetch interval (1 minute) - for normal data */
  STANDARD_MS: 60 * 1000,

  /** Long refetch interval (5 minutes) - for stable data */
  LONG_MS: 5 * 60 * 1000,

  /** Disable automatic refetching */
  DISABLED: false,
} as const;

// ============================================
// RETRY & ERROR HANDLING DEFAULTS
// ============================================

export const RETRY_DEFAULTS = {
  /** Standard retry attempts for failed queries */
  STANDARD_RETRY_COUNT: 2,

  /** Extended retry attempts for critical queries */
  EXTENDED_RETRY_COUNT: 3,

  /** Maximum retry delay for exponential backoff (5 seconds) */
  MAX_RETRY_DELAY_MS: 5000,

  /** Maximum retry delay for extended backoff (30 seconds) */
  EXTENDED_MAX_RETRY_DELAY_MS: 30000,
} as const;

// ============================================
// RATE LIMITING DEFAULTS
// ============================================

export const RATE_LIMIT_DEFAULTS = {
  /** Maximum login attempts before lockout */
  MAX_ATTEMPTS: 5,

  /** Lockout duration after exceeding max attempts (minutes) */
  LOCKOUT_DURATION_MINUTES: 15,

  /** Number of attempts remaining when rate limiting is disabled */
  DISABLED_ATTEMPTS_REMAINING: 5,

  /** Lockout minutes when rate limiting is disabled */
  DISABLED_LOCKOUT_MINUTES: 0,
} as const;

// ============================================
// FILE UPLOAD DEFAULTS
// ============================================

export const FILE_UPLOAD_DEFAULTS = {
  /** Maximum file size for CMS media uploads (5 MB) */
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,

  /** Allowed MIME types for CMS media uploads */
  ALLOWED_IMAGE_TYPES: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/svg+xml",
  ] as const,

  /** Supabase storage bucket name for CMS media */
  CMS_MEDIA_BUCKET: "cms-media",
} as const;

// ============================================
// DATA QUERY LIMIT DEFAULTS
// ============================================

export const QUERY_LIMIT_DEFAULTS = {
  /** Maximum recent activity items to display */
  RECENT_ACTIVITY_LIMIT: 10,

  /** Maximum audit log entries to fetch */
  AUDIT_LOGS_LIMIT: 500,

  /** Maximum settings entries to fetch */
  SETTINGS_LIMIT: 3,
} as const;

// ============================================
// TOAST NOTIFICATION DEFAULTS
// ============================================

export const TOAST_DEFAULTS = {
  /** Maximum number of toasts to display simultaneously */
  MAX_TOASTS: 1,

  /** Auto-removal delay (milliseconds) */
  REMOVE_DELAY_MS: 3000,
} as const;

// ============================================
// BUSINESS LOGIC DEFAULTS
// ============================================

export const BUSINESS_DEFAULTS = {
  /** Default fine due date from issue date (28 days in milliseconds) */
  FINE_DUE_DATE_OFFSET_MS: 28 * 24 * 60 * 60 * 1000,

  /** Fine due date lookahead for "due soon" filter (7 days in milliseconds) */
  FINE_DUE_SOON_THRESHOLD_MS: 7 * 24 * 60 * 60 * 1000,

  /** Insurance expiring soon threshold (days) */
  INSURANCE_EXPIRING_THRESHOLD_DAYS: 30,

  /** Company founded year */
  COMPANY_FOUNDED_YEAR: "2020",

  /** Default promotional discount percentage */
  DEFAULT_PROMO_DISCOUNT: "15%",
} as const;

// ============================================
// CONTACT & COMPANY DEFAULTS
// ============================================

export const COMPANY_DEFAULTS = {
  /** Company phone number (E.164 format) */
  PHONE_E164: "+19725156635",

  /** Company phone number (display format) */
  PHONE_DISPLAY: "(972) 515-6635",

  /** Company email address */
  EMAIL: "info@drive917.com",

  /** Company name */
  NAME: "Drive 917",

  /** Business address */
  ADDRESS: {
    line1: "1234 Main Street",
    line2: "Suite 100",
    city: "Dallas",
    state: "TX",
    zip: "75201",
    country: "USA",
  },
} as const;

// ============================================
// LOCALE & FORMATTING DEFAULTS
// ============================================

export const LOCALE_DEFAULTS = {
  /** Default locale for number and currency formatting */
  LOCALE: "en-US",

  /** Default currency code */
  CURRENCY: "USD",

  /** Default timezone */
  TIMEZONE: "America/Chicago",
} as const;
