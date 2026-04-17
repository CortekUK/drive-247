import type { AxiosInstance } from 'axios';
import type {
  ApiResponse,
  UserListItem,
  UserDetail,
  CreateUserPayload,
  CreateUserResponse,
  UpdateRolePayload,
} from '@drive247/shared-types';

export function createUsersApi(api: AxiosInstance) {
  return {
    list: () =>
      api.get<ApiResponse<UserListItem[]>>('/users'),

    getById: (id: string) =>
      api.get<ApiResponse<UserDetail>>(`/users/${id}`),

    create: (payload: CreateUserPayload) =>
      api.post<ApiResponse<CreateUserResponse>>('/users', payload),

    updateRole: (id: string, payload: UpdateRolePayload) =>
      api.patch<ApiResponse>(`/users/${id}/role`, payload),

    activate: (id: string) =>
      api.patch<ApiResponse>(`/users/${id}/activate`),

    deactivate: (id: string) =>
      api.patch<ApiResponse>(`/users/${id}/deactivate`),
  };
}
