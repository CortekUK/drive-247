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
  role: 'head_admin' | 'admin' | 'manager' | 'ops' | 'viewer';
  is_active: boolean;
  must_change_password: boolean;
  is_super_admin?: boolean;
  avatar_url?: string | null;
  created_at: string;
  updated_at: string;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  appUser: AppUser | null;
  loading: boolean;
  initialized: boolean;
  /**
   * True when the staff profile could not be LOADED (transport failure), as
   * opposed to the user genuinely not having one. Consumers must treat this as
   * "unknown", never as "denied" — otherwise a network blip logs people out.
   */
  profileUnavailable: boolean;
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

/**
 * Result of loading the staff profile.
 *
 * The distinction is load-bearing. This lookup used to collapse EVERY failure —
 * a network blip, a 401 on a stale token, a PostgREST 5xx — into `null`, which
 * the caller then treated as "this person has no profile" and bounced them to
 * /login. The login page saw a valid session and bounced them straight back,
 * producing an unrecoverable dashboard<->login ping-pong: signed in, never able
 * to land. One operator hit it hard enough to sign in 12 times in a day.
 *
 * 'absent'      -> the row genuinely is not there. Denying access is correct.
 * 'unavailable' -> we could not ask. Says NOTHING about their access; must never
 *                  be used to revoke a profile we already hold.
 */
type ProfileResult =
  | { status: 'ok'; appUser: AppUser }
  | { status: 'absent' }
  | { status: 'unavailable'; error: unknown };

/** PostgREST code for "expected exactly one row, got none" — a real absence. */
const NO_ROWS = 'PGRST116';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Load the staff profile, retrying transient failures.
 *
 * Only a definitive "no such row" answer is accepted on the first try; anything
 * that looks like a transport problem is retried with backoff before we give up,
 * because giving up locks the user out of the product.
 */
const fetchAppUserResult = async (
  authUser: User,
  attempts = 3
): Promise<ProfileResult> => {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const { data, error } = await supabase
        .from('app_users')
        .select('*')
        .eq('auth_user_id', authUser.id)
        .single();

      if (error) {
        if ((error as { code?: string }).code === NO_ROWS) {
          return { status: 'absent' };
        }
        lastError = error;
        console.warn(
          `[auth] app_users lookup failed (attempt ${attempt + 1}/${attempts})`,
          error
        );
      } else if (data) {
        // Super admins get head_admin role when accessing rental dashboards
        const appUser = (data.is_super_admin
          ? { ...data, role: 'head_admin', is_active: true }
          : data) as AppUser;
        return { status: 'ok', appUser };
      } else {
        return { status: 'absent' };
      }
    } catch (error) {
      lastError = error;
      console.warn(
        `[auth] app_users lookup threw (attempt ${attempt + 1}/${attempts})`,
        error
      );
    }

    if (attempt < attempts - 1) {
      await sleep(300 * Math.pow(2, attempt)); // 300ms, 600ms
    }
  }

  console.error('[auth] Could not load staff profile after retries:', lastError);
  return { status: 'unavailable', error: lastError };
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  session: null,
  appUser: null,
  loading: true,
  initialized: false,
  profileUnavailable: false,

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
        const result = await fetchAppUserResult(data.user);

        // Could not REACH the profile. Do not sign out — the credentials were
        // correct and the account may be perfectly fine. Signing out here (at
        // the previous default 'global' scope) also killed every other device.
        if (result.status === 'unavailable') {
          set({ profileUnavailable: true });
          return {
            error: {
              // Typed code: the login page keys off this to show connection
              // wording instead of blaming the (correct) credentials, and to
              // avoid writing a `login_failed` audit row for a sign-in that
              // actually succeeded.
              code: 'profile_unavailable',
              message:
                'We could not load your account just now — please check your connection and try again.',
            },
          };
        }

        if (result.status === 'absent') {
          await supabase.auth.signOut({ scope: 'local' });
          return { error: { message: 'User profile not found' } };
        }

        const userData = result.appUser;

        // Super admins bypass is_active check
        if (!userData.is_super_admin && !userData.is_active) {
          await supabase.auth.signOut({ scope: 'local' });
          return { error: { message: 'Account has been deactivated' } };
        }

        set({ appUser: userData, profileUnavailable: false });

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
    // 'local' so signing out of this browser does not kill the user's sessions
    // on every other device.
    //
    // supabase-js returns (rather than throws) when the /logout call fails, and
    // on a non-401/403/404 failure it returns EARLY without clearing local
    // storage. During the very outage the retry screen exists for, that left
    // the stored session behind: the store looked signed out, then a reload or
    // token refresh silently signed the user back in. Clear storage ourselves.
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) console.warn('[auth] signOut reported an error:', error);
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      try {
        if (typeof window !== 'undefined') {
          Object.keys(window.localStorage)
            .filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
            .forEach((k) => window.localStorage.removeItem(k));
        }
      } catch {
        /* storage unavailable — nothing more we can do */
      }
      set({ user: null, session: null, appUser: null, profileUnavailable: false });
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
    if (!user) return;

    const result = await fetchAppUserResult(user);
    if (result.status === 'ok') {
      set({ appUser: result.appUser, profileUnavailable: false });
    } else if (result.status === 'absent') {
      set({ appUser: null, profileUnavailable: false });
    } else {
      // Same rule as the listener: a failed lookup must not revoke a good profile.
      set({ profileUnavailable: true });
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
        // setTimeout(...,0) breaks a Supabase client deadlock — do not remove.
        setTimeout(async () => {
          try {
            const result = await fetchAppUserResult(session.user);
            if (result.status === 'ok') {
              set({ appUser: result.appUser, profileUnavailable: false, loading: false });
            } else if (result.status === 'absent') {
              set({ appUser: null, profileUnavailable: false, loading: false });
            } else {
              // Transport failure. KEEP whatever profile we already hold —
              // overwriting it with null here is what stranded users in the
              // dashboard<->login redirect loop. Every auth event (including
              // each token refresh) used to be able to wipe a good profile.
              set({ profileUnavailable: true, loading: false });
            }
          } catch (error) {
            console.error('Error fetching app user in auth state change:', error);
            set({ profileUnavailable: true, loading: false });
          }
        }, 0);
      } else {
        set({ appUser: null, profileUnavailable: false, loading: false });
      }
    });

    // Check for existing session
    const {
      data: { session },
    } = await supabase.auth.getSession();

    set({ session, user: session?.user ?? null });

    if (session?.user) {
      try {
        const result = await fetchAppUserResult(session.user);
        if (result.status === 'ok') {
          set({
            appUser: result.appUser,
            profileUnavailable: false,
            loading: false,
            initialized: true,
          });
        } else if (result.status === 'absent') {
          set({ appUser: null, profileUnavailable: false, loading: false, initialized: true });
        } else {
          set({ profileUnavailable: true, loading: false, initialized: true });
        }
      } catch (error) {
        console.error('Error fetching app user in initial session:', error);
        set({ profileUnavailable: true, loading: false, initialized: true });
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
    profileUnavailable: store.profileUnavailable,
    signIn: store.signIn,
    signOut: store.signOut,
    updatePassword: store.updatePassword,
    hasRole: store.hasRole,
    isAdmin: store.isAdmin,
    refetchAppUser: store.refetchAppUser,
  };
};
