/**
 * P&L (Profit & Loss) Constants
 *
 * Constants for financial reporting and P&L categorization
 */

// ============================================
// P&L CATEGORY CONSTANTS
// ============================================

export const PNL_CATEGORIES = {
  INITIAL_FEES: 'Initial Fees',
  RENTAL: 'Rental',
  ACQUISITION: 'Acquisition',
  FINANCE: 'Finance',
  SERVICE: 'Service',
  FINES: 'Fines',
  EXPENSES: 'Expenses',
  OTHER: 'Other'
} as const;

export type PnlCategory = typeof PNL_CATEGORIES[keyof typeof PNL_CATEGORIES];

// ============================================
// EXPENSE CATEGORY TO P&L MAPPING
// ============================================

export const EXPENSE_CATEGORY_TO_PNL = {
  'Service': 'Service',
  'Repair': 'Expenses',
  'Tyres': 'Expenses',
  'Valet': 'Expenses',
  'Accessory': 'Expenses',
  'Other': 'Expenses'
} as const;

// ============================================
// PAYMENT TYPE CONSTANTS
// ============================================

export const PAYMENT_TYPES = {
  INITIAL_FEE: 'InitialFee',
  RENTAL: 'Rental',
  FINE: 'Fine'
} as const;

export type PaymentType = typeof PAYMENT_TYPES[keyof typeof PAYMENT_TYPES];

// ============================================
// PAYMENT TYPE TO P&L CATEGORY MAPPING
// ============================================

export const PAYMENT_TYPE_TO_PNL_CATEGORY = {
  [PAYMENT_TYPES.INITIAL_FEE]: PNL_CATEGORIES.INITIAL_FEES,
  [PAYMENT_TYPES.RENTAL]: PNL_CATEGORIES.RENTAL,
  [PAYMENT_TYPES.FINE]: PNL_CATEGORIES.FINES
} as const;
