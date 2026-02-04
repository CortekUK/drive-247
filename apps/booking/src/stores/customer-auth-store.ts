import { create } from 'zustand';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export interface CustomerData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  identity_verification_status: string | null;
  customer_type: string | null;
  type: string;
  tenant_id: string | null;
  profile_photo_url: string | null;
  date_of_birth: string | null;
  timezone: string | null;
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

  // Actions
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setCustomerUser: (customerUser: CustomerUser | null) => void;
  setLoading: (loading: boolean) => void;

  signUp: (
    email: string,
    password: string,
    options?: {
      customerId?: string;
      tenantId?: string;
      customerName?: string;
      customerPhone?: string;
    }
  ) => Promise<{ error: any; data?: any }>;

  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  initialize: () => Promise<void>;
  refetchCustomerUser: () => Promise<void>;
}

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
          customer_type,
          type,
          tenant_id,
          profile_photo_url,
          date_of_birth,
          timezone
        )
      `)
      .eq('auth_user_id', authUser.id);

    // If tenant ID provided, filter by tenant
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query.single();

    if (error) {
      console.error('Error fetching customer user:', error);
      return null;
    }

    return data as CustomerUser;
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

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setCustomerUser: (customerUser) => set({ customerUser }),
  setLoading: (loading) => set({ loading }),

  signUp: async (email, password, options = {}) => {
    try {
      set({ loading: true });

      // Create the auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: typeof window !== 'undefined'
            ? `${window.location.origin}/portal`
            : undefined,
        }
      });

      if (authError) {
        console.error('Sign up error:', authError);
        return { error: authError };
      }

      if (!authData.user) {
        return { error: { message: 'Failed to create user account' } };
      }

      // Check if this is a "fake" user response (email already exists)
      // Supabase returns a user object even when the email exists for security reasons,
      // but the user won't have identities if it's a fake response
      if (!authData.user.identities || authData.user.identities.length === 0) {
        return {
          error: {
            message: 'An account with this email already exists. Please sign in instead.'
          }
        };
      }

      // Create customer record if we have a customer ID from booking
      // or find existing / create a new customer with provided details
      let customerId = options.customerId;

      if (!customerId) {
        // First, check if a customer with this email already exists
        const { data: existingCustomer } = await supabase
          .from('customers')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        if (existingCustomer) {
          // Use the existing customer
          customerId = existingCustomer.id;
          console.log('Found existing customer:', customerId);
        } else {
          // Create a new customer record
          const { data: newCustomer, error: customerError } = await supabase
            .from('customers')
            .insert({
              email,
              name: options.customerName || email.split('@')[0],
              phone: options.customerPhone || null,
              tenant_id: options.tenantId || null,
              type: 'Individual',
              status: 'Active',
            })
            .select()
            .single();

          if (customerError) {
            console.error('Error creating customer:', customerError);
            return { error: customerError };
          }

          customerId = newCustomer.id;
          console.log('Created new customer:', customerId);
        }
      }

      // Create the customer_users link
      const { error: linkError } = await supabase
        .from('customer_users')
        .insert({
          auth_user_id: authData.user.id,
          customer_id: customerId,
          tenant_id: options.tenantId || null,
        });

      if (linkError) {
        console.error('Error linking customer user:', linkError);
        return { error: linkError };
      }

      // Fetch the complete customer user data
      const customerUser = await fetchCustomerUser(authData.user, options.tenantId);

      set({
        user: authData.user,
        session: authData.session,
        customerUser,
        loading: false
      });

      return { error: null, data: authData };
    } catch (error) {
      console.error('Unexpected sign up error:', error);
      return { error: { message: 'An unexpected error occurred' } };
    } finally {
      set({ loading: false });
    }
  },

  signIn: async (email, password) => {
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
        let customerUser = await fetchCustomerUser(data.user);

        if (!customerUser) {
          // User exists in auth but no customer_users link
          // Check if there's a customer record with their email that we can link
          const { data: existingCustomer } = await supabase
            .from('customers')
            .select('id, tenant_id')
            .eq('email', email)
            .maybeSingle();

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
              customerUser = await fetchCustomerUser(data.user);
            } else {
              console.error('Error auto-linking customer user:', linkError);
            }
          }

          if (!customerUser) {
            // Still no customer user - this could be an admin user trying to use customer login
            return { error: { message: 'No customer account found for this email' } };
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
    } catch (error) {
      console.error('Sign out error:', error);
    }
  },

  resetPassword: async (email) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: typeof window !== 'undefined'
          ? `${window.location.origin}/reset-password`
          : undefined,
      });
      return { error };
    } catch (error) {
      console.error('Password reset error:', error);
      return { error: { message: 'An unexpected error occurred' } };
    }
  },

  refetchCustomerUser: async () => {
    const { user } = get();
    if (user) {
      const customerUser = await fetchCustomerUser(user);
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
            const customerUser = await fetchCustomerUser(session.user);
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
        const customerUser = await fetchCustomerUser(session.user);
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
    refetchCustomerUser: store.refetchCustomerUser,
    isAuthenticated: !!store.customerUser && !!store.session,
  };
};
