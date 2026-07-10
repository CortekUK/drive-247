import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

interface PartnerUser {
  id: string;
  email: string;
  name: string | null;
  is_bonzah_partner: boolean;
  is_super_admin: boolean;
}

interface AuthState {
  user: PartnerUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

// The Bonzah console is for Bonzah partner accounts (is_bonzah_partner). Drive247
// super admins are also allowed in for oversight, but partner-only actions
// (approve/reject) are additionally gated server-side by is_bonzah_partner().
const canAccess = (u: { is_bonzah_partner?: boolean; is_super_admin?: boolean }) =>
  u.is_bonzah_partner === true || u.is_super_admin === true;

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    const { data: userData, error: userError } = await supabase
      .from('app_users')
      .select('id, email, name, is_bonzah_partner, is_super_admin')
      .eq('auth_user_id', data.user.id)
      .single();

    if (userError) throw userError;

    if (!canAccess(userData)) {
      await supabase.auth.signOut();
      throw new Error('Access denied. Bonzah partner access required.');
    }

    set({ user: userData as PartnerUser });
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
    const { data: userData } = await supabase
      .from('app_users')
      .select('id, email, name, is_bonzah_partner, is_super_admin')
      .eq('auth_user_id', session.user.id)
      .single();

    if (userData && canAccess(userData)) {
      set({ user: userData as PartnerUser, loading: false });
    } else {
      await supabase.auth.signOut();
      set({ user: null, loading: false });
    }
  },
}));
