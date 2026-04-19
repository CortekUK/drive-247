/**
 * Backend-only Bonzah constants.
 *
 * Anything that's visible to the frontend or shared with the DB schema
 * belongs in `@drive247/shared-types/constants` instead.
 */

export const BONZAH_PATHS = {
  AUTH: '/api/v1/auth',
  QUOTE: '/api/v1/Bonzah/quote',
  PAYMENT: '/api/v1/Bonzah/payment',
  POLICY: '/api/v1/Bonzah/policy',
  PREMIUM_CALC: '/api/v1/Bonzah/premiumCalc',
  CD_BALANCE: '/api/v1/Bonzah/cdBalance',
  MASTER: '/api/v1/Bonzah/master',
  POLICY_DATA: '/api/v1/policy/data',
} as const;

export const BONZAH_AUTH_HEADER = 'in-auth-token';

// Bonzah spec: token valid for 15 minutes (idle). 1-minute safety buffer.
export const BONZAH_TOKEN_TTL_MS = 14 * 60 * 1000;
export const BONZAH_TOKEN_TTL_BUFFER_MS = 60 * 1000;

// Response codes
export const BONZAH_SUCCESS_STATUS = 0;

// Balance error detection (case-insensitive substring match against error text)
export const BONZAH_BALANCE_ERROR_KEYWORDS = [
  'balance',
  'fund',
  'allocat',
  'deposit',
  'insufficient',
] as const;

// Vehicle eligibility — hardcoded deterministic first pass.
// OpenAI fuzzy-match is only triggered when this list has no hit.
// Phase 2: move to admin-managed DB table.
export const BONZAH_RESTRICTED_BRANDS = [
  'Alfa Romeo',
  'Aston Martin',
  'Bentley',
  'BMW',
  'Bugatti',
  'Cadillac',
  'Chevrolet Corvette', // full brand+model treated as brand for simplicity
  'Dodge Challenger',
  'Dodge Charger',
  'Dodge Viper',
  'Ferrari',
  'Ford GT',
  'Ford Mustang',
  'Jaguar',
  'Lamborghini',
  'Land Rover',
  'Lotus',
  'Maserati',
  'Maybach',
  'McLaren',
  'Porsche',
  'Range Rover',
  'Rolls-Royce',
  'Tesla',
] as const;

export const BONZAH_RESTRICTED_MODEL_PATTERNS: ReadonlyArray<{
  brand: RegExp;
  model: RegExp;
}> = [
  { brand: /mercedes/i, model: /amg|g-?class|s-?class/i },
  { brand: /chevrolet/i, model: /corvette/i },
  { brand: /tesla/i, model: /cybertruck/i },
];

// Source of request reported to Bonzah — identifies Drive247 as broker
export const BONZAH_REQUEST_SOURCE = 'drive247';
