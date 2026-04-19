import type { AxiosInstance } from 'axios';
import type {
  ApiResponse,
  CreateVehiclePayload,
  UpdateVehiclePayload,
  VehicleListQuery,
  VehicleListResponse,
  VehicleResponse,
} from '@drive247/shared-types';

export function createVehiclesApi(api: AxiosInstance) {
  return {
    list: (query?: VehicleListQuery) =>
      api.get<ApiResponse<VehicleListResponse>>('/vehicles', { params: query }),

    getById: (id: string) =>
      api.get<ApiResponse<VehicleResponse>>(`/vehicles/${id}`),

    create: (payload: CreateVehiclePayload) =>
      api.post<ApiResponse<VehicleResponse>>('/vehicles', payload),

    update: (id: string, payload: UpdateVehiclePayload) =>
      api.patch<ApiResponse<VehicleResponse>>(`/vehicles/${id}`, payload),

    remove: (id: string) =>
      api.delete<ApiResponse>(`/vehicles/${id}`),
  };
}
