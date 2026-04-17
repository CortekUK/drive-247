import { create } from 'zustand';
import type { PublicUser } from '@drive247/shared-types';

interface PortalAuthState {
  accessToken: string | null;
  user: PublicUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setAuth: (token: string, user: PublicUser) => void;
  setAccessToken: (token: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const usePortalAuthStore = create<PortalAuthState>((set) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,

  setAuth: (token, user) =>
    set({ accessToken: token, user, isAuthenticated: true, isLoading: false }),

  setAccessToken: (token) => set({ accessToken: token }),

  logout: () =>
    set({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
    }),

  setLoading: (loading) => set({ isLoading: loading }),
}));
