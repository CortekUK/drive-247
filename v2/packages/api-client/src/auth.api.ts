import type { AxiosInstance } from 'axios';
import type {
  ApiResponse,
  LoginResponse,
  RefreshResponse,
  ProfileResponse,
} from '@drive247/shared-types';

export function createAuthApi(api: AxiosInstance) {
  return {
    login: (email: string, password: string) =>
      api.post<ApiResponse<LoginResponse>>('/auth/login', { email, password }),

    refresh: () =>
      api.post<ApiResponse<RefreshResponse>>('/auth/refresh'),

    logout: () =>
      api.post<ApiResponse>('/auth/logout'),

    me: () =>
      api.get<ApiResponse<ProfileResponse>>('/auth/me'),

    changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) =>
      api.post<ApiResponse>('/auth/change-password', {
        currentPassword,
        newPassword,
        confirmPassword,
      }),
  };
}
