import type { AxiosInstance } from 'axios';
import type {
  ApiResponse,
  TenantListItem,
  TenantDetail,
  TenantStats,
  CreateTenantPayload,
  CreateTenantResponse,
  UpdateTenantPayload,
} from '@drive247/shared-types';

export function createTenantsApi(api: AxiosInstance) {
  return {
    list: (params?: { search?: string; type?: string; status?: string }) =>
      api.get<ApiResponse<TenantListItem[]>>('/tenants', { params }),

    getById: (id: string) =>
      api.get<ApiResponse<TenantDetail>>(`/tenants/${id}`),

    create: (payload: CreateTenantPayload) =>
      api.post<ApiResponse<CreateTenantResponse>>('/tenants', payload),

    update: (id: string, payload: UpdateTenantPayload) =>
      api.patch<ApiResponse<TenantListItem>>(`/tenants/${id}`, payload),

    remove: (id: string) =>
      api.delete<ApiResponse>(`/tenants/${id}`),

    stats: () =>
      api.get<ApiResponse<TenantStats>>('/tenants/stats'),
  };
}
