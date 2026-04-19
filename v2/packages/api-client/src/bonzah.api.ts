import type { AxiosInstance } from 'axios';
import type {
  ApiResponse,
  BonzahAlertConfigResponse,
  BonzahBalanceResponse,
  BonzahConnectionStatus,
  BonzahPolicyResponse,
  CalculatePremiumPayload,
  CalculatePremiumResponse,
  ConfirmPaymentResponse,
  CreateQuotePayload,
  CreateQuoteResponse,
  DownloadPdfResponse,
  EligibilityCheckPayload,
  EligibilityCheckResponse,
  ListPoliciesQuery,
  ListPoliciesResponse,
  RetryPendingResponse,
  UpdateBonzahAlertConfigPayload,
  UpdateBonzahSettingsPayload,
  VerifyCredentialsPayload,
  VerifyCredentialsResponse,
} from '@drive247/shared-types';

export function createBonzahApi(api: AxiosInstance) {
  return {
    // --- Connection + settings ---
    getConnection: () =>
      api.get<ApiResponse<BonzahConnectionStatus>>('/bonzah/connection'),

    verifyCredentials: (payload: VerifyCredentialsPayload) =>
      api.post<ApiResponse<VerifyCredentialsResponse>>(
        '/bonzah/verify-credentials',
        payload,
      ),

    updateSettings: (payload: UpdateBonzahSettingsPayload) =>
      api.patch<ApiResponse<BonzahConnectionStatus>>(
        '/bonzah/settings',
        payload,
      ),

    // --- Balance + alerts ---
    getBalance: () =>
      api.get<ApiResponse<BonzahBalanceResponse>>('/bonzah/balance'),

    getAlertConfig: () =>
      api.get<ApiResponse<BonzahAlertConfigResponse>>('/bonzah/alert-config'),

    updateAlertConfig: (payload: UpdateBonzahAlertConfigPayload) =>
      api.patch<ApiResponse<BonzahAlertConfigResponse>>(
        '/bonzah/alert-config',
        payload,
      ),

    // --- Premium + eligibility ---
    calculatePremium: (payload: CalculatePremiumPayload) =>
      api.post<ApiResponse<CalculatePremiumResponse>>(
        '/bonzah/premium-calculate',
        payload,
      ),

    checkEligibility: (payload: EligibilityCheckPayload) =>
      api.post<ApiResponse<EligibilityCheckResponse>>(
        '/bonzah/eligibility',
        payload,
      ),

    // --- Retry pending ---
    retryPending: () =>
      api.post<ApiResponse<RetryPendingResponse>>('/bonzah/retry-pending'),

    // --- Policies ---
    listPolicies: (query?: ListPoliciesQuery) =>
      api.get<ApiResponse<ListPoliciesResponse>>('/bonzah/policies', {
        params: query,
      }),

    getPolicy: (id: string) =>
      api.get<ApiResponse<BonzahPolicyResponse>>(`/bonzah/policies/${id}`),

    createQuote: (payload: CreateQuotePayload) =>
      api.post<ApiResponse<CreateQuoteResponse>>(
        '/bonzah/policies',
        payload,
      ),

    confirmPayment: (chainId: string) =>
      api.post<ApiResponse<ConfirmPaymentResponse>>(
        `/bonzah/policies/${chainId}/confirm-payment`,
      ),

    downloadPdf: (policyId: string, dataId: number) =>
      api.get<ApiResponse<DownloadPdfResponse>>(
        `/bonzah/policies/${policyId}/pdf`,
        { params: { dataId } },
      ),
  };
}
