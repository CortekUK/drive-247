/**
 * Application Constants
 *
 * This file contains constant values used throughout the application
 * including business logic constants, status types, categories, and mappings.
 */

// ============================================
// VEHICLE STATUS CONSTANTS
// ============================================

export const VEHICLE_STATUS = {
  AVAILABLE: "Available",
  RENTED: "Rented",
  MAINTENANCE: "Maintenance",
  OUT_OF_SERVICE: "Out of Service",
} as const;

export type VehicleStatus = typeof VEHICLE_STATUS[keyof typeof VEHICLE_STATUS];

// ============================================
// CUSTOMER STATUS CONSTANTS
// ============================================

export const CUSTOMER_STATUS = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  PENDING: "Pending",
  REJECTED: "Rejected",
  BLACKLISTED: "Blacklisted",
} as const;

export type CustomerStatus = typeof CUSTOMER_STATUS[keyof typeof CUSTOMER_STATUS];

// ============================================
// CUSTOMER TYPE CONSTANTS
// ============================================

export const CUSTOMER_TYPE = {
  INDIVIDUAL: "Individual",
  COMPANY: "Company",
} as const;

export type CustomerType = typeof CUSTOMER_TYPE[keyof typeof CUSTOMER_TYPE];

// ============================================
// RENTAL STATUS CONSTANTS
// ============================================

export const RENTAL_STATUS = {
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
} as const;

export type RentalStatus = typeof RENTAL_STATUS[keyof typeof RENTAL_STATUS];

// ============================================
// PAYMENT TYPE CONSTANTS
// ============================================

export const PAYMENT_TYPES = {
  INITIAL_FEE: "InitialFee",
  RENTAL: "Rental",
  FINE: "Fine",
  OTHER: "Other",
} as const;

export type PaymentType = typeof PAYMENT_TYPES[keyof typeof PAYMENT_TYPES];

// ============================================
// FINE STATUS CONSTANTS
// ============================================

export const FINE_STATUS = {
  PENDING: "Pending",
  PAID: "Paid",
  OVERDUE: "Overdue",
  DISPUTED: "Disputed",
} as const;

export type FineStatus = typeof FINE_STATUS[keyof typeof FINE_STATUS];

// ============================================
// USER ROLE CONSTANTS
// ============================================

export const USER_ROLES = {
  HEAD_ADMIN: "head_admin",
  ADMIN: "admin",
  OPS: "ops",
  VIEWER: "viewer",
} as const;

export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES];

// ============================================
// PNL (PROFIT & LOSS) CATEGORIES
// ============================================

export const PNL_CATEGORIES = {
  INITIAL_FEES: "Initial Fees",
  RENTAL: "Rental",
  ACQUISITION: "Acquisition",
  FINANCE: "Finance",
  SERVICE: "Service",
  FINES: "Fines",
  EXPENSES: "Expenses",
  OTHER: "Other",
} as const;

export type PnlCategory = typeof PNL_CATEGORIES[keyof typeof PNL_CATEGORIES];

// ============================================
// EXPENSE CATEGORIES
// ============================================

export const EXPENSE_CATEGORIES = {
  FUEL: "Fuel",
  MAINTENANCE: "Maintenance",
  INSURANCE: "Insurance",
  REGISTRATION: "Registration",
  CLEANING: "Cleaning",
  PARKING: "Parking",
  TOLLS: "Tolls",
  DEPRECIATION: "Depreciation",
  OTHER: "Other",
} as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[keyof typeof EXPENSE_CATEGORIES];

// ============================================
// EXPENSE CATEGORY TO PNL MAPPING
// ============================================

export const EXPENSE_CATEGORY_TO_PNL: Record<ExpenseCategory, PnlCategory> = {
  [EXPENSE_CATEGORIES.FUEL]: PNL_CATEGORIES.EXPENSES,
  [EXPENSE_CATEGORIES.MAINTENANCE]: PNL_CATEGORIES.SERVICE,
  [EXPENSE_CATEGORIES.INSURANCE]: PNL_CATEGORIES.EXPENSES,
  [EXPENSE_CATEGORIES.REGISTRATION]: PNL_CATEGORIES.EXPENSES,
  [EXPENSE_CATEGORIES.CLEANING]: PNL_CATEGORIES.SERVICE,
  [EXPENSE_CATEGORIES.PARKING]: PNL_CATEGORIES.EXPENSES,
  [EXPENSE_CATEGORIES.TOLLS]: PNL_CATEGORIES.EXPENSES,
  [EXPENSE_CATEGORIES.DEPRECIATION]: PNL_CATEGORIES.FINANCE,
  [EXPENSE_CATEGORIES.OTHER]: PNL_CATEGORIES.OTHER,
};

// ============================================
// PAYMENT TYPE TO PNL CATEGORY MAPPING
// ============================================

export const PAYMENT_TYPE_TO_PNL_CATEGORY: Record<PaymentType, PnlCategory> = {
  [PAYMENT_TYPES.INITIAL_FEE]: PNL_CATEGORIES.INITIAL_FEES,
  [PAYMENT_TYPES.RENTAL]: PNL_CATEGORIES.RENTAL,
  [PAYMENT_TYPES.FINE]: PNL_CATEGORIES.FINES,
  [PAYMENT_TYPES.OTHER]: PNL_CATEGORIES.OTHER,
};

// ============================================
// BOOKING STATUS CONSTANTS
// ============================================

export const BOOKING_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
} as const;

export type BookingStatus = typeof BOOKING_STATUS[keyof typeof BOOKING_STATUS];

// ============================================
// VERIFICATION STATUS CONSTANTS
// ============================================

export const VERIFICATION_STATUS = {
  PENDING: "pending",
  VERIFIED: "verified",
  FAILED: "failed",
} as const;

export type VerificationStatus = typeof VERIFICATION_STATUS[keyof typeof VERIFICATION_STATUS];

// ============================================
// DOCUMENT TYPES
// ============================================

export const DOCUMENT_TYPES = {
  DRIVERS_LICENSE: "drivers_license",
  INSURANCE: "insurance",
  REGISTRATION: "registration",
  CONTRACT: "contract",
  INVOICE: "invoice",
  RECEIPT: "receipt",
  OTHER: "other",
} as const;

export type DocumentType = typeof DOCUMENT_TYPES[keyof typeof DOCUMENT_TYPES];

// ============================================
// AUDIT LOG ACTION TYPES
// ============================================

export const AUDIT_ACTIONS = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  LOGIN: "login",
  LOGOUT: "logout",
  APPROVE: "approve",
  REJECT: "reject",
  CANCEL: "cancel",
  PAYMENT: "payment",
  REFUND: "refund",
} as const;

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS];

// ============================================
// REMINDER TYPES
// ============================================

export const REMINDER_TYPES = {
  INSURANCE_EXPIRY: "insurance_expiry",
  REGISTRATION_EXPIRY: "registration_expiry",
  RENTAL_DUE: "rental_due",
  FINE_DUE: "fine_due",
  PAYMENT_DUE: "payment_due",
  VEHICLE_MAINTENANCE: "vehicle_maintenance",
} as const;

export type ReminderType = typeof REMINDER_TYPES[keyof typeof REMINDER_TYPES];

// ============================================
// NOTIFICATION CHANNELS
// ============================================

export const NOTIFICATION_CHANNELS = {
  EMAIL: "email",
  SMS: "sms",
  PUSH: "push",
  IN_APP: "in_app",
} as const;

export type NotificationChannel = typeof NOTIFICATION_CHANNELS[keyof typeof NOTIFICATION_CHANNELS];

// ============================================
// STRIPE PAYMENT INTENTS STATUS
// ============================================

export const STRIPE_PAYMENT_STATUS = {
  REQUIRES_PAYMENT_METHOD: "requires_payment_method",
  REQUIRES_CONFIRMATION: "requires_confirmation",
  REQUIRES_ACTION: "requires_action",
  PROCESSING: "processing",
  REQUIRES_CAPTURE: "requires_capture",
  CANCELLED: "canceled",
  SUCCEEDED: "succeeded",
} as const;

export type StripePaymentStatus = typeof STRIPE_PAYMENT_STATUS[keyof typeof STRIPE_PAYMENT_STATUS];

// ============================================
// DOCUSIGN ENVELOPE STATUS
// ============================================

export const DOCUSIGN_STATUS = {
  CREATED: "created",
  SENT: "sent",
  DELIVERED: "delivered",
  SIGNED: "signed",
  COMPLETED: "completed",
  DECLINED: "declined",
  VOIDED: "voided",
} as const;

export type DocusignStatus = typeof DOCUSIGN_STATUS[keyof typeof DOCUSIGN_STATUS];

// ============================================
// AWS CONFIGURATION CONSTANTS
// ============================================

export const AWS_CONFIG = {
  /** AWS Account ID */
  ACCOUNT_ID: "464115713515",

  /** AWS Region */
  REGION: "us-east-1",

  /** SES Email Service Endpoint */
  SES_ENDPOINT: "email.us-east-1.amazonaws.com",

  /** SNS SMS Service Endpoint */
  SNS_ENDPOINT: "sns.us-east-1.amazonaws.com",

  /** Domain for SES */
  DOMAIN: "drive-247.com",

  /** SES Domain Verification Token */
  SES_VERIFICATION_TOKEN: "yLsYg7fGRQVNlbGv+dsFmYxSApFpMG613iXXZBfsTbg=",
} as const;

// ============================================
// FILTER OPTIONS CONSTANTS
// ============================================

export const FINE_FILTER_OPTIONS = {
  ALL: "all",
  PAID: "paid",
  UNPAID: "unpaid",
  OVERDUE: "overdue",
  DUE_NEXT_7: "due-next-7",
} as const;

export type FineFilter = typeof FINE_FILTER_OPTIONS[keyof typeof FINE_FILTER_OPTIONS];

export const VEHICLE_FILTER_OPTIONS = {
  ALL: "all",
  AVAILABLE: "available",
  RENTED: "rented",
  MAINTENANCE: "maintenance",
} as const;

export type VehicleFilter = typeof VEHICLE_FILTER_OPTIONS[keyof typeof VEHICLE_FILTER_OPTIONS];

export const CUSTOMER_FILTER_OPTIONS = {
  ALL: "all",
  ACTIVE: "active",
  INACTIVE: "inactive",
  PENDING: "pending",
  REJECTED: "rejected",
} as const;

export type CustomerFilter = typeof CUSTOMER_FILTER_OPTIONS[keyof typeof CUSTOMER_FILTER_OPTIONS];

// ============================================
// SORT ORDER CONSTANTS
// ============================================

export const SORT_ORDER = {
  ASC: "asc",
  DESC: "desc",
} as const;

export type SortOrder = typeof SORT_ORDER[keyof typeof SORT_ORDER];

// ============================================
// DATE FORMAT CONSTANTS
// ============================================

export const DATE_FORMATS = {
  /** US date format (MM/DD/YYYY) */
  US_DATE: "MM/DD/YYYY",

  /** ISO date format (YYYY-MM-DD) */
  ISO_DATE: "YYYY-MM-DD",

  /** Full date time format */
  FULL_DATETIME: "MM/DD/YYYY hh:mm A",

  /** Short date time format */
  SHORT_DATETIME: "MM/DD/YY hh:mm A",

  /** Time only format */
  TIME_ONLY: "hh:mm A",
} as const;

// ============================================
// VALIDATION CONSTANTS
// ============================================

export const VALIDATION = {
  /** Minimum password length */
  MIN_PASSWORD_LENGTH: 8,

  /** Minimum name length */
  MIN_NAME_LENGTH: 2,

  /** Maximum name length */
  MAX_NAME_LENGTH: 100,

  /** Maximum email length */
  MAX_EMAIL_LENGTH: 255,

  /** Maximum phone number length */
  MAX_PHONE_LENGTH: 20,

  /** Maximum textarea length */
  MAX_TEXTAREA_LENGTH: 5000,

  /** Minimum age to rent */
  MIN_RENTAL_AGE: 21,
} as const;

// ============================================
// URL/ROUTE CONSTANTS
// ============================================

export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  DASHBOARD: "/dashboard",
  CUSTOMERS: "/customers",
  VEHICLES: "/vehicles",
  RENTALS: "/rentals",
  PAYMENTS: "/payments",
  FINES: "/fines",
  PLATES: "/plates",
  INSURANCE: "/insurance",
  INVOICES: "/invoices",
  DOCUMENTS: "/documents",
  SETTINGS: "/settings",
  PENDING_BOOKINGS: "/pending-bookings",
  TESTIMONIALS: "/testimonials",
  BLOCKED_DATES: "/blocked-dates",
  PL_DASHBOARD: "/pl-dashboard",
} as const;
