import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

/**
 * Who may use the developer hub: an active super admin, nobody else. The same
 * rule as the super-admin dashboard's, minus its sales-agent door.
 */
interface DeveloperUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url?: string | null;
  is_super_admin: boolean;
  is_active: boolean;
}

interface AuthState {
  user: DeveloperUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const USER_COLUMNS = 'id, email, name, avatar_url, is_active, is_super_admin';

function allowed(row: Partial<DeveloperUser> | null | undefined): row is DeveloperUser {
  return !!row && row.is_super_admin === true && row.is_active !== false;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const { data: row, error: rowError } = await supabase
      .from('app_users')
      .select(USER_COLUMNS)
      .eq('auth_user_id', data.user.id)
      .maybeSingle();

    if (rowError) {
      await supabase.auth.signOut();
      throw rowError;
    }
    if (!allowed(row)) {
      await supabase.auth.signOut();
      throw new Error('Access denied. Super admin privileges required.');
    }

    set({ user: row });
  },

  logout: async () => {
    // Clear local state even if the network sign-out fails, so nobody is
    // left stuck inside with no way out.
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Sign out failed, clearing local session anyway:', err);
    } finally {
      set({ user: null });
    }
  },

  checkAuth: async () => {
    set({ loading: true });

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      set({ user: null, loading: false });
      return;
    }

    const { data: row, error } = await supabase
      .from('app_users')
      .select(USER_COLUMNS)
      .eq('auth_user_id', session.user.id)
      .maybeSingle();

    if (allowed(row)) {
      set({ user: row, loading: false });
      return;
    }

    // A failed lookup (network, RLS hiccup) is not a "no": drop to the login
    // screen but keep the session. A definite "not a super admin" signs out.
    if (error) {
      console.error('checkAuth: failed to load app_user:', error);
      set({ user: null, loading: false });
      return;
    }

    await supabase.auth.signOut();
    set({ user: null, loading: false });
  },
}));
