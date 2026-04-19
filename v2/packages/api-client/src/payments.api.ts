import type { AxiosInstance } from 'axios';
import type {
  ApiResponse,
  PaymentResponse,
  RecordPaymentPayload,
  RefundPaymentPayload,
} from '@drive247/shared-types';

export function createPaymentsApi(api: AxiosInstance) {
  return {
    record: (invoiceId: string, payload: RecordPaymentPayload) =>
      api.post<ApiResponse<PaymentResponse>>(
        `/invoices/${invoiceId}/payments`,
        payload,
      ),

    refund: (
      invoiceId: string,
      paymentId: string,
      payload: RefundPaymentPayload,
    ) =>
      api.post<ApiResponse<PaymentResponse>>(
        `/invoices/${invoiceId}/payments/${paymentId}/refund`,
        payload,
      ),
  };
}
