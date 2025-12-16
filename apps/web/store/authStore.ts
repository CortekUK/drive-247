import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

interface SuperAdmin {
  id: string;
  email: string;
  name: string;
  is_primary_super_admin: boolean;
}

interface AuthState {
  user: SuperAdmin | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    // Fetch user details from app_users table
    const { data: userData, error: userError } = await supabase
      .from('app_users')
      .select('id, email, name, is_super_admin, is_primary_super_admin')
      .eq('auth_user_id', data.user.id)
      .single();

    if (userError) throw userError;

    // Verify user is a super admin
    if (!userData.is_super_admin) {
      await supabase.auth.signOut();
      throw new Error('Access denied. Super admin privileges required.');
    }

    set({ user: userData });
  },

  logout: async () => {
    await supabase.auth.signOut();
    set({ user: null });
  },

  checkAuth: async () => {
    set({ loading: true });

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      set({ user: null, loading: false });
      return;
    }

    // Fetch user details
    const { data: userData } = await supabase
      .from('app_users')
      .select('id, email, name, is_super_admin, is_primary_super_admin')
      .eq('auth_user_id', session.user.id)
      .single();

    if (userData && userData.is_super_admin) {
      set({ user: userData, loading: false });
    } else {
      await supabase.auth.signOut();
      set({ user: null, loading: false });
    }
  },
}));
