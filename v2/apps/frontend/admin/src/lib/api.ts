import {
  createApiClient,
  createAuthApi,
  createTenantsApi,
} from '@drive247/api-client';
import { useAdminAuthStore } from '@/stores/admin-auth-store';

const BACKEND_PORT = Number(process.env.NEXT_PUBLIC_BACKEND_PORT ?? 4000);

const api = createApiClient({
  backendPort: BACKEND_PORT,
  getAccessToken: () => useAdminAuthStore.getState().accessToken,
  setAccessToken: (token) => useAdminAuthStore.getState().setAccessToken(token),
  onAuthFailure: () => {
    useAdminAuthStore.getState().logout();
    window.location.href = '/login';
  },
  // No tenant slug for admin — super admin has no tenant
});

export const authApi = createAuthApi(api);
export const tenantsApi = createTenantsApi(api);
export default api;
