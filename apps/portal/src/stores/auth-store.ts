import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface AppUser {
  id: string;
  auth_user_id: string;
  email: string;
  name: string | null;
  role: 'head_admin' | 'admin' | 'ops' | 'viewer';
  is_active: boolean;
  must_change_password: boolean;
  is_super_admin?: boolean;
  created_at: string;
  updated_at: string;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  appUser: AppUser | null;
  loading: boolean;
  initialized: boolean;
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setAppUser: (appUser: AppUser | null) => void;
  setLoading: (loading: boolean) => void;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  updatePassword: (newPassword: string) => Promise<{ error: any }>;
  hasRole: (role: string | string[]) => boolean;
  isAdmin: () => boolean;
  refetchAppUser: () => Promise<void>;
  initialize: () => Promise<void>;
}

const fetchAppUser = async (authUser: User): Promise<AppUser | null> => {
  try {
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .single();

    if (error) {
      console.error('Error fetching app user:', error);
      return null;
    }

    // Super admins get head_admin role when accessing rental dashboards
    if (data.is_super_admin) {
      return {
        ...data,
        role: 'head_admin',
        is_active: true,
      } as AppUser;
    }

    return data as AppUser;
  } catch (error) {
    console.error('Error in fetchAppUser:', error);
    return null;
  }
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  session: null,
  appUser: null,
  loading: true,
  initialized: false,

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setAppUser: (appUser) => set({ appUser }),
  setLoading: (loading) => set({ loading }),

  signIn: async (email: string, password: string) => {
    try {
      set({ loading: true });

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Sign in error:', error);
        return { error };
      }

      if (data.user) {
        const userData = await fetchAppUser(data.user);

        if (!userData) {
          await supabase.auth.signOut();
          return { error: { message: 'User profile not found' } };
        }

        // Super admins bypass is_active check
        if (!userData.is_super_admin && !userData.is_active) {
          await supabase.auth.signOut();
          return { error: { message: 'Account has been deactivated' } };
        }

        set({ appUser: userData });

        if (userData.must_change_password && !userData.is_super_admin) {
          toast({
            title: 'Password Change Required',
            description: 'Please change your password using the user menu.',
            variant: 'default',
          });
        }
      }

      return { error: null };
    } catch (error) {
      console.error('Unexpected sign in error:', error);
      return { error: { message: 'An unexpected error occurred' } };
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    try {
      await supabase.auth.signOut();
      set({ user: null, session: null, appUser: null });
    } catch (error) {
      console.error('Sign out error:', error);
    }
  },

  updatePassword: async (newPassword: string) => {
    const { appUser, user } = get();
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        return { error };
      }

      if (appUser && user) {
        await supabase
          .from('app_users')
          .update({ must_change_password: false })
          .eq('auth_user_id', user.id);

        set({
          appUser: appUser ? { ...appUser, must_change_password: false } : null,
        });
      }

      return { error: null };
    } catch (error) {
      console.error('Password update error:', error);
      return { error: { message: 'An unexpected error occurred' } };
    }
  },

  hasRole: (role: string | string[]) => {
    const { appUser } = get();
    if (!appUser || !appUser.is_active) return false;

    if (Array.isArray(role)) {
      return role.includes(appUser.role);
    }

    return appUser.role === role;
  },

  isAdmin: () => {
    return get().hasRole(['head_admin', 'admin']);
  },

  refetchAppUser: async () => {
    const { user } = get();
    if (user) {
      const userData = await fetchAppUser(user);
      set({ appUser: userData });
    }
  },

  initialize: async () => {
    const { initialized } = get();
    if (initialized) return;

    // Set up auth state listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session?.user?.email);

      set({ session, user: session?.user ?? null });

      if (session?.user) {
        setTimeout(async () => {
          try {
            const userData = await fetchAppUser(session.user);
            set({ appUser: userData, loading: false });
          } catch (error) {
            console.error('Error fetching app user in auth state change:', error);
            set({ loading: false });
          }
        }, 0);
      } else {
        set({ appUser: null, loading: false });
      }
    });

    // Check for existing session
    const {
      data: { session },
    } = await supabase.auth.getSession();

    set({ session, user: session?.user ?? null });

    if (session?.user) {
      try {
        const userData = await fetchAppUser(session.user);
        set({ appUser: userData, loading: false, initialized: true });
      } catch (error) {
        console.error('Error fetching app user in initial session:', error);
        set({ loading: false, initialized: true });
      }
    } else {
      set({ loading: false, initialized: true });
    }

    // Return cleanup function
    return () => subscription.unsubscribe();
  },
}));

// Hook for backwards compatibility with useAuth
export const useAuth = () => {
  const store = useAuthStore();
  return {
    user: store.user,
    session: store.session,
    appUser: store.appUser,
    loading: store.loading,
    signIn: store.signIn,
    signOut: store.signOut,
    updatePassword: store.updatePassword,
    hasRole: store.hasRole,
    isAdmin: store.isAdmin,
    refetchAppUser: store.refetchAppUser,
  };
};
