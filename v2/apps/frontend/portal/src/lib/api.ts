import { createApiClient, createAuthApi, createUsersApi } from '@drive247/api-client';
import { usePortalAuthStore } from '@/stores/portal-auth-store';

function getTenantSlug(): string | null {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const parts = hostname.split('.');
    // e.g. dogar.localhost → "dogar"
    if (parts.length > 1 && parts[0] !== 'localhost') {
      return parts[0];
    }
  }
  return process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG ?? null;
}

const BACKEND_PORT = Number(process.env.NEXT_PUBLIC_BACKEND_PORT ?? 4000);

const api = createApiClient({
  backendPort: BACKEND_PORT,
  getAccessToken: () => usePortalAuthStore.getState().accessToken,
  setAccessToken: (token) => usePortalAuthStore.getState().setAccessToken(token),
  onAuthFailure: () => {
    usePortalAuthStore.getState().logout();
    window.location.href = '/login';
  },
  getTenantSlug,
});

export const authApi = createAuthApi(api);
export const usersApi = createUsersApi(api);
export default api;
