import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

interface SuperAdmin {
  id: string;
  email: string;
  name: string;
  is_primary_super_admin: boolean;
  is_super_admin?: boolean;
  is_sales_agent?: boolean;
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
    // Cast to any: is_sales_agent is not yet in the generated Supabase types.
    const { data: userData, error: userError } = await (supabase as any)
      .from('app_users')
      .select('id, email, name, is_super_admin, is_primary_super_admin, is_sales_agent')
      .eq('auth_user_id', data.user.id)
      .single();

    if (userError) throw userError;

    // Verify user is a super admin or a sales agent
    if (!userData.is_super_admin && !userData.is_sales_agent) {
      await supabase.auth.signOut();
      throw new Error('Access denied. Super admin privileges required.');
    }

    set({ user: userData as SuperAdmin });
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
    // Cast to any: is_sales_agent is not yet in the generated Supabase types.
    const { data: userData } = await (supabase as any)
      .from('app_users')
      .select('id, email, name, is_super_admin, is_primary_super_admin, is_sales_agent')
      .eq('auth_user_id', session.user.id)
      .single();

    if (userData && (userData.is_super_admin || userData.is_sales_agent)) {
      set({ user: userData as SuperAdmin, loading: false });
    } else {
      await supabase.auth.signOut();
      set({ user: null, loading: false });
    }
  },
}));
