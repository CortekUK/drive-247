import type { AxiosInstance } from 'axios';
import type {
  ApiResponse,
  CreateCustomerPayload,
  CustomerFinancialsResponse,
  CustomerListQuery,
  CustomerListResponse,
  CustomerResponse,
  UpdateCustomerPayload,
} from '@drive247/shared-types';

export function createCustomersApi(api: AxiosInstance) {
  return {
    list: (query?: CustomerListQuery) =>
      api.get<ApiResponse<CustomerListResponse>>('/customers', {
        params: query,
      }),

    getById: (id: string) =>
      api.get<ApiResponse<CustomerResponse>>(`/customers/${id}`),

    create: (payload: CreateCustomerPayload) =>
      api.post<ApiResponse<CustomerResponse>>('/customers', payload),

    update: (id: string, payload: UpdateCustomerPayload) =>
      api.patch<ApiResponse<CustomerResponse>>(`/customers/${id}`, payload),

    remove: (id: string) =>
      api.delete<ApiResponse>(`/customers/${id}`),

    financials: (id: string) =>
      api.get<ApiResponse<CustomerFinancialsResponse>>(
        `/customers/${id}/financials`,
      ),
  };
}
