import axios, { type AxiosInstance } from 'axios';

export interface ApiClientConfig {
  /** Backend port — the hostname is mirrored from the browser */
  backendPort: number;
  /** API path prefix */
  apiPrefix?: string;
  getAccessToken: () => string | null;
  setAccessToken: (token: string) => void;
  onAuthFailure: () => void;
  getTenantSlug?: () => string | null;
}

/**
 * Builds the API base URL by mirroring the page's hostname.
 * This ensures the browser treats API requests as same-host,
 * so cookies (host-only, no domain attribute) are sent automatically.
 *
 * dogar.localhost:3001 → dogar.localhost:4000/api
 * localhost:3001       → localhost:4000/api
 */
function getBaseURL(config: ApiClientConfig): string {
  if (typeof window === 'undefined') {
    // SSR fallback
    return `http://localhost:${config.backendPort}${config.apiPrefix ?? '/api'}`;
  }
  const hostname = window.location.hostname;
  return `http://${hostname}:${config.backendPort}${config.apiPrefix ?? '/api'}`;
}

export function createApiClient(config: ApiClientConfig): AxiosInstance {
  const api = axios.create({
    withCredentials: true,
  });

  // Set baseURL dynamically per request (mirrors page hostname)
  api.interceptors.request.use((reqConfig) => {
    reqConfig.baseURL = getBaseURL(config);

    const token = config.getAccessToken();
    if (token) {
      reqConfig.headers.Authorization = `Bearer ${token}`;
    }
    const slug = config.getTenantSlug?.();
    if (slug) {
      reqConfig.headers['x-tenant-slug'] = slug;
    }
    return reqConfig;
  });

  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const original = error.config;
      if (error.response?.status === 401 && !original._retry) {
        original._retry = true;
        try {
          const baseURL = getBaseURL(config);
          const { data } = await axios.post(
            `${baseURL}/auth/refresh`,
            {},
            { withCredentials: true },
          );
          config.setAccessToken(data.data.accessToken);
          original.headers.Authorization = `Bearer ${data.data.accessToken}`;
          return api(original);
        } catch {
          config.onAuthFailure();
        }
      }
      return Promise.reject(error);
    },
  );

  return api;
}
