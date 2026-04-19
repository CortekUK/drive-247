import type { AxiosInstance } from 'axios';
import type {
  ApiResponse,
  CreateInvoiceItemPayload,
  CreateInvoicePayload,
  InvoiceDetail,
  InvoiceItemResponse,
  InvoiceListQuery,
  InvoiceListResponse,
  UpdateInvoiceItemPayload,
  UpdateInvoicePayload,
} from '@drive247/shared-types';

export function createInvoicesApi(api: AxiosInstance) {
  return {
    list: (query?: InvoiceListQuery) =>
      api.get<ApiResponse<InvoiceListResponse>>('/invoices', { params: query }),

    getById: (id: string) =>
      api.get<ApiResponse<InvoiceDetail>>(`/invoices/${id}`),

    create: (payload: CreateInvoicePayload) =>
      api.post<ApiResponse<InvoiceDetail>>('/invoices', payload),

    update: (id: string, payload: UpdateInvoicePayload) =>
      api.patch<ApiResponse<InvoiceDetail>>(`/invoices/${id}`, payload),

    remove: (id: string) => api.delete<ApiResponse>(`/invoices/${id}`),

    void: (id: string) =>
      api.post<ApiResponse<InvoiceDetail>>(`/invoices/${id}/void`),

    addItem: (invoiceId: string, payload: CreateInvoiceItemPayload) =>
      api.post<ApiResponse<InvoiceItemResponse>>(
        `/invoices/${invoiceId}/items`,
        payload,
      ),

    updateItem: (
      invoiceId: string,
      itemId: string,
      payload: UpdateInvoiceItemPayload,
    ) =>
      api.patch<ApiResponse<InvoiceItemResponse>>(
        `/invoices/${invoiceId}/items/${itemId}`,
        payload,
      ),

    removeItem: (invoiceId: string, itemId: string) =>
      api.delete<ApiResponse>(`/invoices/${invoiceId}/items/${itemId}`),
  };
}
