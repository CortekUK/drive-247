import type { BonzahMode, BonzahPolicyStatus } from './enums';

// --- Connection / settings ---

export type BonzahConnectionStatus = {
  connected: boolean;
  mode: BonzahMode;
  username: string | null;
  brochureUrl: string | null;
};

export type VerifyCredentialsPayload = {
  username: string;
  password: string;
  mode: BonzahMode;
};

export type VerifyCredentialsResponse = {
  valid: boolean;
  email?: string;
  mode?: BonzahMode;
  error?: string;
};

export type UpdateBonzahSettingsPayload = {
  mode?: BonzahMode;
  username?: string;
  password?: string;
  brochureUrl?: string | null;
};

// --- Balance + alerts ---

export type BonzahAlertLevel = 'none' | 'warning' | 'critical';

export type BonzahBalanceResponse = {
  brokerBalance: number;
  allocatedBalance: number | null;
  mode: BonzahMode;
  currency: string;
  asOf: string;
  threshold: number | null;
  alertLevel: BonzahAlertLevel;
};

export type BonzahAlertConfigResponse = {
  enabled: boolean;
  threshold: number;
};

export type UpdateBonzahAlertConfigPayload = {
  enabled?: boolean;
  threshold?: number;
};

// --- Premium ---

export type CoverageSelection = {
  cdw: boolean;
  rcli: boolean;
  sli: boolean;
  pai: boolean;
};

export type CalculatePremiumPayload = {
  tripStartDate: string; // ISO date
  tripEndDate: string;
  pickupState: string;
  coverage: CoverageSelection;
};

export type CalculatePremiumResponse = {
  totalPremium: number;
  currency: string;
  breakdown: {
    cdw: number;
    rcli: number;
    sli: number;
    pai: number;
  };
  days: number;
};

// --- Eligibility ---

export type EligibilityCheckPayload = {
  vehicleId: string; // UUID — server looks up make/model
};

export type EligibilityCheckResponse = {
  eligible: boolean;
  reason: string | null;
};

// --- Renter details (snapshotted) ---

export type RenterAddress = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

export type RenterLicense = {
  number: string;
  state: string;
};

export type RenterDetails = {
  firstName: string;
  lastName: string;
  dob: string; // ISO date
  email: string;
  phone: string; // 11 digits
  address: RenterAddress;
  license: RenterLicense;
};

// --- Quote creation ---

export type CreateQuotePayload = {
  rentalId: string;
  coverage: CoverageSelection;
  pickupState: string;
  renter: RenterDetails;
};

export type CreateQuoteResponse = {
  chainId: string;
  totalPremium: number;
  policies: BonzahPolicyResponse[];
};

// --- Policy shapes ---

export type PolicyCoverage = {
  cdw: boolean;
  rcli: boolean;
  sli: boolean;
  pai: boolean;
  pdf_ids?: {
    cdw?: number;
    rcli?: number;
    sli?: number;
    pai?: number;
  };
};

export type BonzahPolicyResponse = {
  id: string;
  tenantId: string;
  rentalId: string;
  customerId: string;
  chainId: string;
  chainSequence: number;
  policyType: 'original' | 'extension';
  mode: BonzahMode;
  quoteId: string;
  quoteNo: string | null;
  paymentId: string | null;
  policyNo: string | null;
  policyId: string | null;
  coverage: PolicyCoverage;
  tripStartDate: string;
  tripEndDate: string;
  pickupState: string;
  premiumAmount: string; // numeric as string
  status: BonzahPolicyStatus;
  policyIssuedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListPoliciesQuery = {
  rentalId?: string;
  chainId?: string;
  status?: BonzahPolicyStatus;
};

export type ListPoliciesResponse = {
  items: BonzahPolicyResponse[];
};

// --- Payment confirmation ---

export type ConfirmPaymentResponse = {
  chainId: string;
  totalConfirmed: number;
  totalPolicies: number;
  policies: BonzahPolicyResponse[];
  anyFailed: boolean;
};

export type RetryPendingResponse = {
  attempted: number;
  succeeded: number;
  failed: number;
  stillPending: number;
};

// --- PDF download ---

export type DownloadPdfResponse = {
  contentBase64: string;
  contentType: string;
  fileName: string;
};
