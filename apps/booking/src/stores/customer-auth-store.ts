import { create } from 'zustand';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { isGloballyBlacklisted, isIdentityBlocked } from '@/lib/tenantQueries';

export interface CustomerData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  identity_verification_status: string | null;
  type: string;
  tenant_id: string | null;
  profile_photo_url: string | null;
  date_of_birth: string | null;
  timezone: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  license_number: string | null;
  license_state: string | null;
  is_blocked: boolean | null;
}

export interface CustomerUser {
  id: string;
  auth_user_id: string;
  customer_id: string;
  tenant_id: string | null;
  customer: CustomerData;
  created_at: string;
  updated_at: string;
}

interface CustomerAuthState {
  user: User | null;
  session: Session | null;
  customerUser: CustomerUser | null;
  loading: boolean;
  initialized: boolean;
  tenantId: string | null;

  // Actions
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setCustomerUser: (customerUser: CustomerUser | null) => void;
  setLoading: (loading: boolean) => void;
  setTenantId: (id: string | null) => void;

  signUp: (
    email: string,
    password: string,
    options?: {
      customerId?: string;
      tenantId?: string;
      customerName?: string;
      customerPhone?: string;
    }
  ) => Promise<{ error: any; data?: any; isBlocked?: boolean }>;

  verifyOTP: (
    email: string,
    code: string,
    password: string,
    tenantId: string
  ) => Promise<{ error: any; verified?: boolean }>;

  resendOTP: (
    email: string,
    tenantId: string
  ) => Promise<{ error: any }>;

  signIn: (email: string, password: string, tenantId?: string) => Promise<{ error: any; isBlocked?: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string, tenantId?: string) => Promise<{ error: any }>;
  verifyPasswordResetOTP: (
    email: string,
    code: string,
    newPassword: string,
    tenantId?: string
  ) => Promise<{ error: any; verified?: boolean }>;
  initialize: () => Promise<void>;
  refetchCustomerUser: () => Promise<void>;
}

// Flag to prevent auth state listener from interfering during explicit auth operations
let _authOpInProgress = false;

const fetchCustomerUser = async (authUser: User, tenantId?: string): Promise<CustomerUser | null> => {
  try {
    let query = supabase
      .from('customer_users')
      .select(`
        *,
        customer:customers (
          id,
          name,
          email,
          phone,
          identity_verification_status,
          type,
          tenant_id,
          profile_photo_url,
          date_of_birth,
          timezone,
          address_street,
          address_city,
          address_state,
          address_zip,
          license_number,
          license_state,
          is_gig_driver,
          is_blocked
        )
      `)
      .eq('auth_user_id', authUser.id);

    // If tenant ID provided, filter by tenant
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error('Error fetching customer user:', error);
      return null;
    }

    return data as CustomerUser | null;
  } catch (error) {
    console.error('Error in fetchCustomerUser:', error);
    return null;
  }
};

export const useCustomerAuthStore = create<CustomerAuthState>()((set, get) => ({
  user: null,
  session: null,
  customerUser: null,
  loading: true,
  initialized: false,
  tenantId: null,

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setCustomerUser: (customerUser) => set({ customerUser }),
  setLoading: (loading) => set({ loading }),
  setTenantId: (tenantId) => {
    const prev = get().tenantId;
    set({ tenantId });
    // If tenant changed and we have a session, re-validate customerUser against new tenant
    if (tenantId && tenantId !== prev) {
      const { user } = get();
      if (user) {
        fetchCustomerUser(user, tenantId).then(customerUser => {
          set({ customerUser }); // null if user doesn't belong to this tenant
        });
      }
    }
  },

  signUp: async (email, password, options = {}) => {
    _authOpInProgress = true;
    try {
      set({ loading: true });

      // Check if email is blocked before creating auth user
      const globalCheck = await isGloballyBlacklisted(email);
      if (globalCheck.isBlacklisted) {
        return { error: { message: 'Your account has been blocked. Please contact support.' }, isBlocked: true };
      }

      if (options.tenantId) {
        const identityCheck = await isIdentityBlocked(options.tenantId, email);
        if (identityCheck.isBlocked) {
          return { error: { message: 'Your account has been blocked. Please contact support.' }, isBlocked: true };
        }
      }

      // Create the auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            tenant_id: options.tenantId || undefined,
            tenant_slug: (typeof window !== 'undefined'
              ? (() => {
                  const host = window.location.hostname.split(':')[0];
                  const parts = host.split('.');
                  if (parts.length >= 2 && parts[parts.length - 1] === 'localhost' && parts[0] !== 'localhost') {
                    return parts[0];
                  }
                  if (parts.length >= 3) {
                    const sub = parts[0];
                    const reserved = ['www', 'admin', 'portal', 'api', 'app'];
                    return reserved.includes(sub) ? undefined : sub;
                  }
                  return undefined;
                })()
              : undefined),
            name: options.customerName || email.split('@')[0],
          },
          emailRedirectTo: typeof window !== 'undefined'
            ? `${window.location.origin}/auth/callback`
            : undefined,
        }
      });

      if (authError) {
        // With email auto-confirm enabled, supabase.auth.signUp returns a
        // "User already registered" error for an existing email instead of the
        // empty-identities response. That email may be an ORPHAN (auth user with
        // no customer record for this tenant) which previously trapped the user in
        // a signup<->login loop. Route it through customer-signup, which self-heals
        // the orphan (creates the customer + link, resets the password), then send
        // the OTP — exactly like the cross-tenant path below.
        const authMsg = (authError.message || '').toLowerCase();
        const alreadyRegistered =
          authMsg.includes('already registered') ||
          authMsg.includes('already been registered') ||
          authMsg.includes('user already exists');

        if (alreadyRegistered && options.tenantId) {
          const { data: signupResult, error: fnError } = await supabase.functions.invoke('customer-signup', {
            body: {
              email,
              password,
              customer_id: options.customerId || undefined,
              tenant_id: options.tenantId,
              customer_name: options.customerName || undefined,
              customer_phone: options.customerPhone || undefined,
            },
          });

          if (fnError) {
            return { error: { message: fnError.message || 'Failed to create account' } };
          }
          if (signupResult?.error) {
            return { error: { message: signupResult.error } };
          }

          await supabase.functions.invoke('send-verification-otp', {
            body: { email, tenant_id: options.tenantId },
          });

          return { error: null, data: { user: null, session: null, needsOTPVerification: true, email } };
        }

        console.error('Sign up error:', authError);
        return { error: authError };
      }

      if (!authData.user) {
        return { error: { message: 'Failed to create user account' } };
      }

      // Check if email already exists on another tenant
      if (!authData.user.identities || authData.user.identities.length === 0) {
        // Auth user exists — use edge function for cross-tenant signup
        console.log('Email exists on another tenant, using cross-tenant signup');
        const { data: signupResult, error: fnError } = await supabase.functions.invoke('customer-signup', {
          body: {
            email,
            password,
            customer_id: options.customerId || undefined,
            tenant_id: options.tenantId || undefined,
            customer_name: options.customerName || undefined,
            customer_phone: options.customerPhone || undefined,
          },
        });

        if (fnError) {
          console.error('Cross-tenant signup error:', fnError);
          return { error: { message: fnError.message || 'Failed to create account' } };
        }

        if (signupResult?.error) {
          return { error: { message: signupResult.error } };
        }

        // Send OTP for verification
        if (options.tenantId) {
          await supabase.functions.invoke('send-verification-otp', {
            body: { email, tenant_id: options.tenantId },
          });
        }

        return { error: null, data: { user: null, session: null, needsOTPVerification: true, email } };
      }

      // New user created — send OTP verification email
      if (options.tenantId) {
        const { error: otpError } = await supabase.functions.invoke('send-verification-otp', {
          body: { email, tenant_id: options.tenantId },
        });

        if (otpError) {
          console.error('Failed to send OTP:', otpError);
        }
      }

      return { error: null, data: { user: null, session: null, needsOTPVerification: true, email } };
    } catch (error) {
      console.error('Unexpected sign up error:', error);
      return { error: { message: 'An unexpected error occurred' } };
    } finally {
      _authOpInProgress = false;
      set({ loading: false });
    }
  },

  verifyOTP: async (email, code, password, tenantId) => {
    _authOpInProgress = true;
    try {
      set({ loading: true });

      // Verify the OTP via edge function
      const { data: verifyResult, error: fnError } = await supabase.functions.invoke('verify-otp', {
        body: { email, code, tenant_id: tenantId },
      });

      if (fnError) {
        console.error('OTP verification error:', fnError);
        return { error: { message: fnError.message || 'Failed to verify code' } };
      }

      if (!verifyResult?.verified) {
        return { error: { message: verifyResult?.error || 'Invalid or expired code' } };
      }

      // OTP verified — sign in with password
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        console.error('Sign in after OTP error:', signInError);
        return { error: { message: signInError.message || 'Failed to sign in' } };
      }

      if (data.user) {
        // Check for existing customer user or auto-create
        let customerUser = await fetchCustomerUser(data.user, tenantId);

        if (!customerUser && tenantId) {
          // Auto-create customer record after email verification
          const displayName = data.user.user_metadata?.name || email.split('@')[0];

          const { data: newCustomer } = await supabase
            .from('customers')
            .insert({
              email,
              name: displayName,
              tenant_id: tenantId,
              type: 'Individual',
              status: 'Active',
            })
            .select('id')
            .single();

          if (newCustomer) {
            await supabase
              .from('customer_users')
              .insert({
                auth_user_id: data.user.id,
                customer_id: newCustomer.id,
                tenant_id: tenantId,
              });

            customerUser = await fetchCustomerUser(data.user, tenantId);
          }
        }

        set({
          user: data.user,
          session: data.session,
          customerUser,
          loading: false,
        });
      }

      return { error: null, verified: true };
    } catch (error) {
      console.error('Unexpected OTP error:', error);
      return { error: { message: 'An unexpected error occurred' } };
    } finally {
      _authOpInProgress = false;
      set({ loading: false });
    }
  },

  resendOTP: async (email, tenantId) => {
    try {
      const { error } = await supabase.functions.invoke('send-verification-otp', {
        body: { email, tenant_id: tenantId },
      });

      if (error) {
        return { error: { message: error.message || 'Failed to resend code' } };
      }

      return { error: null };
    } catch (error) {
      return { error: { message: 'An unexpected error occurred' } };
    }
  },

  signIn: async (email, password, tenantId?) => {
    try {
      set({ loading: true });

      const effectiveTenantId = tenantId || get().tenantId || undefined;

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Sign in error:', error);
        return { error };
      }

      if (data.user) {
        let customerUser = await fetchCustomerUser(data.user, effectiveTenantId);

        if (!customerUser) {
          // User exists in auth but no customer_users link for this tenant
          // Check if there's a customer record with their email for this tenant that we can link
          let customerQuery = supabase
            .from('customers')
            .select('id, tenant_id')
            .eq('email', email);

          if (effectiveTenantId) {
            customerQuery = customerQuery.eq('tenant_id', effectiveTenantId);
          }

          const { data: existingCustomer } = await customerQuery.maybeSingle();

          if (existingCustomer) {
            // Create the missing customer_users link
            const { error: linkError } = await supabase
              .from('customer_users')
              .insert({
                auth_user_id: data.user.id,
                customer_id: existingCustomer.id,
                tenant_id: existingCustomer.tenant_id,
              });

            if (!linkError) {
              // Fetch the newly created customer user
              customerUser = await fetchCustomerUser(data.user, effectiveTenantId);
            } else {
              console.error('Error auto-linking customer user:', linkError);
            }
          }

          if (!customerUser) {
            // No customer account for this tenant - sign out the Supabase session
            // to prevent a dangling authenticated session on the wrong tenant
            await supabase.auth.signOut();
            return { error: { message: 'No customer account found for this site. Please register first.' } };
          }
        }

        // Check if customer is blocked (tenant-level)
        if (customerUser.customer?.is_blocked) {
          await supabase.auth.signOut();
          return { error: { message: 'Your account has been blocked. Please contact support.' }, isBlocked: true };
        }

        // Check global blacklist
        const globalCheck = await isGloballyBlacklisted(email);
        if (globalCheck.isBlacklisted) {
          await supabase.auth.signOut();
          return { error: { message: 'Your account has been blocked. Please contact support.' }, isBlocked: true };
        }

        // Check email in blocked_identities (tenant-level)
        if (effectiveTenantId) {
          const identityCheck = await isIdentityBlocked(effectiveTenantId, email);
          if (identityCheck.isBlocked) {
            await supabase.auth.signOut();
            return { error: { message: 'Your account has been blocked. Please contact support.' }, isBlocked: true };
          }
        }

        set({
          user: data.user,
          session: data.session,
          customerUser,
          loading: false
        });
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
      set({ user: null, session: null, customerUser: null });

      // Clear booking data on sign-out (dynamic import avoids circular dependency)
      const { useBookingStore } = await import('./booking-store');
      useBookingStore.getState().clearBooking();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  },

  resetPassword: async (email, tenantId) => {
    try {
      const { error } = await supabase.functions.invoke('send-verification-otp', {
        body: { email, tenant_id: tenantId || null, type: 'password_reset' },
      });
      return { error };
    } catch (error) {
      console.error('Password reset error:', error);
      return { error: { message: 'An unexpected error occurred' } };
    }
  },

  verifyPasswordResetOTP: async (email, code, newPassword, tenantId) => {
    try {
      // Verify the OTP
      const { data: verifyResult, error: verifyError } = await supabase.functions.invoke('verify-otp', {
        body: { email, code, tenant_id: tenantId || null },
      });
      if (verifyError) {
        return { error: { message: 'Failed to verify code' }, verified: false };
      }
      if (!verifyResult?.verified) {
        return { error: { message: verifyResult?.error || 'Invalid verification code' }, verified: false };
      }

      // OTP verified — reset password via admin API
      const { data: resetResult, error: resetError } = await supabase.functions.invoke('reset-password-with-otp', {
        body: { email, new_password: newPassword },
      });
      if (resetError) {
        return { error: { message: 'Failed to reset password' }, verified: true };
      }

      return { error: null, verified: true };
    } catch (error) {
      console.error('Password reset OTP error:', error);
      return { error: { message: 'An unexpected error occurred' }, verified: false };
    }
  },

  refetchCustomerUser: async () => {
    const { user, tenantId } = get();
    if (user) {
      const customerUser = await fetchCustomerUser(user, tenantId || undefined);
      set({ customerUser });
    }
  },

  initialize: async () => {
    const { initialized } = get();
    if (initialized) return;

    // Set up auth state listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Customer auth state changed:', event, session?.user?.email);

      set({ session, user: session?.user ?? null });

      if (session?.user) {
        // Use setTimeout to avoid potential Supabase deadlock
        setTimeout(async () => {
          try {
            const customerUser = await fetchCustomerUser(session.user, get().tenantId || undefined);

            // If customer is blocked, sign them out
            if (customerUser && customerUser.customer?.is_blocked) {
              console.log('Blocked customer session detected, signing out');
              await supabase.auth.signOut();
              set({ user: null, session: null, customerUser: null, loading: false });
              return;
            }

            // Check global blacklist
            if (session.user.email) {
              const globalCheck = await isGloballyBlacklisted(session.user.email);
              if (globalCheck.isBlacklisted) {
                console.log('Globally blacklisted customer session detected, signing out');
                await supabase.auth.signOut();
                set({ user: null, session: null, customerUser: null, loading: false });
                return;
              }
            }

            set({ customerUser, loading: false });
          } catch (error) {
            console.error('Error fetching customer user in auth state change:', error);
            set({ loading: false });
          }
        }, 0);
      } else {
        set({ customerUser: null, loading: false });
      }
    });

    // Check for existing session
    const {
      data: { session },
    } = await supabase.auth.getSession();

    set({ session, user: session?.user ?? null });

    if (session?.user) {
      try {
        const customerUser = await fetchCustomerUser(session.user, get().tenantId || undefined);
        set({ customerUser, loading: false, initialized: true });
      } catch (error) {
        console.error('Error fetching customer user in initial session:', error);
        set({ loading: false, initialized: true });
      }
    } else {
      set({ loading: false, initialized: true });
    }

    // Return cleanup function (store doesn't actually use this, but it's available)
    return () => subscription.unsubscribe();
  },
}));

// Convenience hook for common auth operations
export const useCustomerAuth = () => {
  const store = useCustomerAuthStore();
  return {
    user: store.user,
    session: store.session,
    customerUser: store.customerUser,
    loading: store.loading,
    initialized: store.initialized,
    signUp: store.signUp,
    signIn: store.signIn,
    signOut: store.signOut,
    resetPassword: store.resetPassword,
    verifyPasswordResetOTP: store.verifyPasswordResetOTP,
    refetchCustomerUser: store.refetchCustomerUser,
    setTenantId: store.setTenantId,
    isAuthenticated: !!store.customerUser && !!store.session,
  };
};
