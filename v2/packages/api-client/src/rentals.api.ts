import type { AxiosInstance } from 'axios';
import type {
  ApiResponse,
  CreateRentalPayload,
  RentalDetail,
  RentalListQuery,
  RentalListResponse,
  TransitionRentalPayload,
  UpdateRentalPayload,
} from '@drive247/shared-types';

export function createRentalsApi(api: AxiosInstance) {
  return {
    list: (query?: RentalListQuery) =>
      api.get<ApiResponse<RentalListResponse>>('/rentals', { params: query }),

    getById: (id: string) =>
      api.get<ApiResponse<RentalDetail>>(`/rentals/${id}`),

    create: (payload: CreateRentalPayload) =>
      api.post<ApiResponse<RentalDetail>>('/rentals', payload),

    update: (id: string, payload: UpdateRentalPayload) =>
      api.patch<ApiResponse<RentalDetail>>(`/rentals/${id}`, payload),

    transition: (id: string, payload: TransitionRentalPayload) =>
      api.patch<ApiResponse<RentalDetail>>(`/rentals/${id}/status`, payload),

    remove: (id: string) =>
      api.delete<ApiResponse>(`/rentals/${id}`),
  };
}
