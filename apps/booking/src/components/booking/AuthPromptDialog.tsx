'use client';

import { useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  signupSchema,
  loginSchema,
  SignupFormData,
  LoginFormData,
} from '@/client-schemas/auth';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import {
  Check,
  Eye,
  EyeOff,
  Gift,
  History,
  Loader2,
  Mail,
  Shield,
  ShieldAlert,
  User,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { BlockedAccountDialog } from '@/components/BlockedAccountDialog';

type AuthMode = 'prompt' | 'signup' | 'login' | 'forgot-password' | 'verify-otp' | 'reset-verify-otp' | 'reset-new-password';

interface AuthPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillEmail: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  onSkip: () => void;
  onSuccess: () => void;
}

const benefits = [
  {
    icon: History,
    title: 'View All Bookings',
    description: 'Access your complete booking history in one place',
  },
  {
    icon: Gift,
    title: 'Loyalty Rewards',
    description: 'Earn points on every rental for future discounts',
  },
  {
    icon: User,
    title: 'Personal Portal',
    description: 'Manage your profile and preferences anytime',
  },
  {
    icon: Shield,
    title: 'One-Time Verification',
    description: 'Complete ID verification once, use it for all bookings',
  },
];

export function AuthPromptDialog({
  open,
  onOpenChange,
  prefillEmail,
  customerId,
  customerName,
  customerPhone,
  onSkip,
  onSuccess,
}: AuthPromptDialogProps) {
  const [mode, setMode] = useState<AuthMode>('prompt');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [otpValues, setOtpValues] = useState<string[]>(['', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showBlockedDialog, setShowBlockedDialog] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetOtpValues, setResetOtpValues] = useState<string[]>(['', '', '', '', '', '']);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const resetOtpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const { signUp, signIn, verifyOTP, resendOTP, resetPassword } = useCustomerAuthStore();
  const { tenant } = useTenant();

  const signupForm = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: customerName || '',
      email: prefillEmail,
      password: '',
      confirmPassword: '',
    },
  });

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: prefillEmail,
      password: '',
    },
  });

  const handleSignup = async (data: SignupFormData) => {
    setIsLoading(true);
    try {
      const result = await signUp(data.email, data.password, {
        customerId,
        tenantId: tenant?.id,
        customerName: data.name,
        customerPhone,
      });
      const { error, data: signupData } = result;

      if (error) {
        if ((result as any).isBlocked) {
          onOpenChange(false);
          setShowBlockedDialog(true);
          return;
        }
        if (error.message?.includes('already')) {
          toast.error('An account with this email already exists. Please log in instead.');
          setMode('login');
          loginForm.setValue('email', data.email);
        } else {
          toast.error(error.message || 'Failed to create account');
        }
        return;
      }

      // Check if OTP verification is required
      if (signupData?.needsOTPVerification) {
        setConfirmationEmail(data.email);
        setSignupPassword(data.password);
        setOtpValues(['', '', '', '', '', '']);
        setResendCooldown(60);
        setMode('verify-otp');
        return;
      }

      // If no email confirmation needed, user is already logged in
      toast.success('Account created successfully!');
      onSuccess();
    } catch (error) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      const result = await signIn(data.email, data.password, tenant?.id);

      if (result.error) {
        if (result.isBlocked) {
          onOpenChange(false);
          setShowBlockedDialog(true);
          return;
        }
        if (result.error.message?.includes('Invalid login')) {
          toast.error('Invalid email or password');
        } else if (result.error.message?.includes('No customer')) {
          toast.error('No customer account found. Please create an account.');
          setMode('signup');
          signupForm.setValue('email', data.email);
        } else {
          toast.error(result.error.message || 'Failed to log in');
        }
        return;
      }

      toast.success('Logged in successfully!');
      onSuccess();
    } catch (error) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const email = loginForm.getValues('email') || prefillEmail;
    if (!email) {
      toast.error('Please enter your email address');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.functions.invoke('send-verification-otp', {
        body: { email, tenant_id: tenant?.id, type: 'password_reset' },
      });

      if (error) {
        toast.error(error.message || 'Failed to send reset code');
        return;
      }

      setResetEmail(email);
      setResetOtpValues(['', '', '', '', '', '']);
      setResetCooldown(60);
      setMode('reset-verify-otp');
    } catch (error) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  // Resend cooldown timers
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (resetCooldown <= 0) return;
    const timer = setTimeout(() => setResetCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resetCooldown]);

  // Auto-focus first OTP input when entering verify mode
  useEffect(() => {
    if (mode === 'verify-otp') {
      setTimeout(() => otpInputRefs.current[0]?.focus(), 100);
    }
    if (mode === 'reset-verify-otp') {
      setTimeout(() => resetOtpRefs.current[0]?.focus(), 100);
    }
  }, [mode]);

  const handleOtpChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    setOtpValues((prev) => {
      const next = [...prev];
      next[index] = digit;
      if (digit && index < 5) {
        setTimeout(() => otpInputRefs.current[index + 1]?.focus(), 0);
      }
      return next;
    });
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!otpValues[index] && index > 0) {
        otpInputRefs.current[index - 1]?.focus();
        setOtpValues((prev) => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
        e.preventDefault();
      }
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 0) return;
    const newValues = [...otpValues];
    for (let i = 0; i < pasted.length && i < 6; i++) {
      newValues[i] = pasted[i];
    }
    setOtpValues(newValues);
    const nextEmptyIndex = newValues.findIndex((v) => v === '');
    const focusIndex = nextEmptyIndex === -1 ? 5 : nextEmptyIndex;
    setTimeout(() => otpInputRefs.current[focusIndex]?.focus(), 0);
  };

  const handleOtpSubmit = async () => {
    const otpCode = otpValues.join('');
    if (otpCode.length !== 6) {
      toast.error('Please enter the full 6-digit code');
      return;
    }
    if (!tenant?.id) {
      toast.error('Tenant information missing');
      return;
    }
    setIsLoading(true);
    try {
      const result = await verifyOTP(confirmationEmail, otpCode, signupPassword, tenant.id);
      if (result.error) {
        toast.error(result.error.message || 'Invalid or expired code');
        setOtpValues(['', '', '', '', '', '']);
        setTimeout(() => otpInputRefs.current[0]?.focus(), 100);
        return;
      }
      toast.success('Account verified successfully!');
      window.location.href = '/portal';
    } catch (error) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (resendCooldown > 0 || !tenant?.id) return;
    setIsLoading(true);
    try {
      const result = await resendOTP(confirmationEmail, tenant.id);
      if (result.error) {
        toast.error(result.error.message || 'Failed to resend code');
        return;
      }
      toast.success('A new verification code has been sent');
      setResendCooldown(60);
      setOtpValues(['', '', '', '', '', '']);
      setTimeout(() => otpInputRefs.current[0]?.focus(), 100);
    } catch (error) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetOtpChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    setResetOtpValues((prev) => {
      const next = [...prev];
      next[index] = digit;
      if (digit && index < 5) {
        setTimeout(() => resetOtpRefs.current[index + 1]?.focus(), 0);
      }
      return next;
    });
  };

  const handleResetOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!resetOtpValues[index] && index > 0) {
        resetOtpRefs.current[index - 1]?.focus();
        setResetOtpValues((prev) => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
        e.preventDefault();
      }
    }
  };

  const handleResetOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 0) return;
    const newValues = [...resetOtpValues];
    for (let i = 0; i < pasted.length && i < 6; i++) {
      newValues[i] = pasted[i];
    }
    setResetOtpValues(newValues);
    const nextEmptyIndex = newValues.findIndex((v) => v === '');
    const focusIndex = nextEmptyIndex === -1 ? 5 : nextEmptyIndex;
    setTimeout(() => resetOtpRefs.current[focusIndex]?.focus(), 0);
  };

  const handleResetOtpSubmit = async () => {
    const code = resetOtpValues.join('');
    if (code.length !== 6) {
      toast.error('Please enter the full 6-digit code');
      return;
    }
    setIsLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('verify-otp', {
        body: { email: resetEmail, code, tenant_id: tenant?.id },
      });
      if (error || !result?.verified) {
        toast.error(result?.error || error?.message || 'Invalid or expired code');
        setResetOtpValues(['', '', '', '', '', '']);
        setTimeout(() => resetOtpRefs.current[0]?.focus(), 100);
        return;
      }
      // OTP verified — show new password form
      setMode('reset-new-password');
    } catch (error) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendResetOTP = async () => {
    if (resetCooldown > 0) return;
    setIsLoading(true);
    try {
      const { error } = await supabase.functions.invoke('send-verification-otp', {
        body: { email: resetEmail, tenant_id: tenant?.id, type: 'password_reset' },
      });
      if (error) {
        toast.error('Failed to resend code');
        return;
      }
      toast.success('A new code has been sent');
      setResetCooldown(60);
      setResetOtpValues(['', '', '', '', '', '']);
      setTimeout(() => resetOtpRefs.current[0]?.focus(), 100);
    } catch (error) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetNewPassword = async () => {
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setIsLoading(true);
    try {
      // Sign in first (OTP already confirmed the email), then update password
      // Use admin API via edge function to reset the password
      const { data: result, error } = await supabase.functions.invoke('reset-password-with-otp', {
        body: { email: resetEmail, new_password: newPassword, tenant_id: tenant?.id },
      });
      if (error || result?.error) {
        toast.error(result?.error || error?.message || 'Failed to reset password');
        return;
      }
      toast.success('Password reset successfully! Please log in.');
      setNewPassword('');
      setConfirmNewPassword('');
      setMode('login');
      loginForm.setValue('email', resetEmail);
    } catch (error) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = () => {
    onSkip();
    setTimeout(() => {
      setMode('prompt');
      signupForm.reset();
      loginForm.reset();
      setOtpValues(['', '', '', '', '', '']);
      setSignupPassword('');
      setResendCooldown(0);
    }, 300);
  };

  const handleClose = (open: boolean) => {
    onOpenChange(open);
    if (!open) {
      setTimeout(() => {
        setMode('prompt');
        signupForm.reset();
        loginForm.reset();
        setOtpValues(['', '', '', '', '', '']);
        setSignupPassword('');
        setResendCooldown(0);
      }, 300);
    }
  };

  const renderPromptMode = () => (
    <>
      <DialogHeader>
        <DialogTitle className="text-xl">Create Your Account</DialogTitle>
        <DialogDescription>
          Unlock exclusive benefits by creating a free account
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-4">
        {benefits.map((benefit) => (
          <div key={benefit.title} className="flex items-start gap-3">
            <div className="rounded-full bg-accent/10 p-2">
              <benefit.icon className="h-4 w-4 text-accent" />
            </div>
            <div>
              <p className="font-medium text-sm">{benefit.title}</p>
              <p className="text-xs text-muted-foreground">{benefit.description}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 pt-2">
        <Button
          onClick={() => setMode('signup')}
          className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
        >
          Create Account
        </Button>
        <Button variant="ghost" onClick={handleSkip} className="w-full">
          Skip for Now
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground pt-2">
        Already have an account?{' '}
        <button
          onClick={() => setMode('login')}
          className="text-accent hover:underline font-medium"
        >
          Log in
        </button>
      </p>
    </>
  );

  const renderSignupMode = () => (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode('prompt')}
            className="rounded-full p-1 hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <DialogTitle>Create Account</DialogTitle>
        </div>
        <DialogDescription>
          Enter a password to secure your account
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={signupForm.handleSubmit(handleSignup)} className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="signup-name">Full Name</Label>
          <Input
            id="signup-name"
            type="text"
            {...signupForm.register('name')}
            placeholder="Enter your full name"
            autoComplete="name"
          />
          {signupForm.formState.errors.name && (
            <p className="text-xs text-destructive">
              {signupForm.formState.errors.name.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-email">Email</Label>
          <Input
            id="signup-email"
            type="email"
            {...signupForm.register('email')}
            placeholder="Enter your email"
            autoComplete="email"
          />
          {signupForm.formState.errors.email && (
            <p className="text-xs text-destructive">
              {signupForm.formState.errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-password">Password</Label>
          <div className="relative">
            <Input
              id="signup-password"
              type={showPassword ? 'text' : 'password'}
              {...signupForm.register('password')}
              placeholder="Create a password"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {signupForm.formState.errors.password && (
            <p className="text-xs text-destructive">
              {signupForm.formState.errors.password.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className={signupForm.watch('password')?.length >= 8 ? 'text-green-600' : ''}>
              <Check className="h-3 w-3 inline mr-1" />8+ chars
            </span>
            <span className={/[A-Z]/.test(signupForm.watch('password') || '') ? 'text-green-600' : ''}>
              <Check className="h-3 w-3 inline mr-1" />Uppercase
            </span>
            <span className={/[0-9]/.test(signupForm.watch('password') || '') ? 'text-green-600' : ''}>
              <Check className="h-3 w-3 inline mr-1" />Number
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-confirm-password">Confirm Password</Label>
          <div className="relative">
            <Input
              id="signup-confirm-password"
              type={showConfirmPassword ? 'text' : 'password'}
              {...signupForm.register('confirmPassword')}
              placeholder="Confirm your password"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {signupForm.formState.errors.confirmPassword && (
            <p className="text-xs text-destructive">
              {signupForm.formState.errors.confirmPassword.message}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating Account...
            </>
          ) : (
            'Create Account & Continue'
          )}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{' '}
        <button
          onClick={() => setMode('login')}
          className="text-accent hover:underline font-medium"
        >
          Log in
        </button>
      </p>
    </>
  );

  const renderLoginMode = () => (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode('prompt')}
            className="rounded-full p-1 hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <DialogTitle>Welcome Back</DialogTitle>
        </div>
        <DialogDescription>
          Log in to your account to continue
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            {...loginForm.register('email')}
            placeholder="Enter your email"
            autoComplete="email"
          />
          {loginForm.formState.errors.email && (
            <p className="text-xs text-destructive">
              {loginForm.formState.errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password">Password</Label>
            <button
              type="button"
              onClick={() => setMode('forgot-password')}
              className="text-xs text-accent hover:underline"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              {...loginForm.register('password')}
              placeholder="Enter your password"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {loginForm.formState.errors.password && (
            <p className="text-xs text-destructive">
              {loginForm.formState.errors.password.message}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Logging in...
            </>
          ) : (
            'Log In & Continue'
          )}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Don't have an account?{' '}
        <button
          onClick={() => setMode('signup')}
          className="text-accent hover:underline font-medium"
        >
          Create one
        </button>
      </p>
    </>
  );

  const renderForgotPasswordMode = () => (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode('login')}
            className="rounded-full p-1 hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <DialogTitle>Reset Password</DialogTitle>
        </div>
        <DialogDescription>
          Enter your email and we'll send you a reset code
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="reset-email">Email</Label>
          <Input
            id="reset-email"
            type="email"
            value={loginForm.watch('email') || prefillEmail}
            onChange={(e) => loginForm.setValue('email', e.target.value)}
            placeholder="Enter your email"
          />
        </div>

        <Button onClick={handleForgotPassword} className="w-full" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            'Send Reset Code'
          )}
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Remember your password?{' '}
        <button
          onClick={() => setMode('login')}
          className="text-accent hover:underline font-medium"
        >
          Log in
        </button>
      </p>
    </>
  );

  const renderResetVerifyOTPMode = () => (
    <>
      <DialogHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
          <Shield className="h-8 w-8 text-accent" />
        </div>
        <DialogTitle className="text-xl">Enter Reset Code</DialogTitle>
        <DialogDescription className="text-center">
          Enter the 6-digit code sent to
        </DialogDescription>
      </DialogHeader>

      <div className="py-4 space-y-4">
        <div className="bg-muted/50 rounded-lg p-3 text-center">
          <p className="font-medium text-foreground">{resetEmail}</p>
        </div>

        <div className="flex justify-center gap-2" onPaste={handleResetOtpPaste}>
          {resetOtpValues.map((digit, index) => (
            <input
              key={index}
              ref={(el) => { resetOtpRefs.current[index] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleResetOtpChange(index, e.target.value)}
              onKeyDown={(e) => handleResetOtpKeyDown(index, e)}
              className="w-11 h-13 text-center text-xl font-bold rounded-lg border-2 border-input bg-background focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all"
              disabled={isLoading}
            />
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Code expires in 15 minutes
        </p>
      </div>

      <div className="flex flex-col gap-3 pt-2">
        <Button
          onClick={handleResetOtpSubmit}
          disabled={isLoading || resetOtpValues.join('').length !== 6}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Verifying...
            </>
          ) : (
            'Verify Code'
          )}
        </Button>

        <div className="flex items-center justify-center gap-1 text-sm">
          <span className="text-muted-foreground">Didn't receive it?</span>
          <Button
            variant="link"
            size="sm"
            onClick={handleResendResetOTP}
            disabled={resetCooldown > 0 || isLoading}
            className="p-0 h-auto"
          >
            {resetCooldown > 0 ? `Resend in ${resetCooldown}s` : 'Resend code'}
          </Button>
        </div>

        <Button variant="ghost" onClick={() => setMode('forgot-password')} className="w-full text-xs">
          Try a different email
        </Button>
      </div>
    </>
  );

  const renderResetNewPasswordMode = () => (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <button onClick={() => setMode('login')} className="rounded-full p-1 hover:bg-muted">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <DialogTitle>Set New Password</DialogTitle>
        </div>
        <DialogDescription>
          Enter a new password for {resetEmail}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label>New Password</Label>
          <div className="relative">
            <Input
              type={showNewPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
            />
            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Confirm New Password</Label>
          <Input
            type="password"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            placeholder="Confirm new password"
          />
        </div>

        {newPassword.length > 0 && (
          <div className="flex gap-3 text-xs">
            <span className={newPassword.length >= 8 ? 'text-green-600' : 'text-muted-foreground'}>
              {newPassword.length >= 8 ? '✓' : '○'} 8+ chars
            </span>
            <span className={/[A-Z]/.test(newPassword) ? 'text-green-600' : 'text-muted-foreground'}>
              {/[A-Z]/.test(newPassword) ? '✓' : '○'} Uppercase
            </span>
            <span className={/\d/.test(newPassword) ? 'text-green-600' : 'text-muted-foreground'}>
              {/\d/.test(newPassword) ? '✓' : '○'} Number
            </span>
          </div>
        )}

        <Button
          onClick={handleSetNewPassword}
          disabled={isLoading || newPassword.length < 8 || newPassword !== confirmNewPassword}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Resetting...
            </>
          ) : (
            'Reset Password'
          )}
        </Button>
      </div>
    </>
  );

  const renderVerifyOTPMode = () => (
    <>
      <DialogHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
          <Shield className="h-8 w-8 text-accent" />
        </div>
        <DialogTitle className="text-xl">Verify Your Email</DialogTitle>
        <DialogDescription className="text-center">
          Enter the 6-digit code sent to
        </DialogDescription>
      </DialogHeader>

      <div className="py-4 space-y-4">
        <div className="bg-muted/50 rounded-lg p-3 text-center">
          <p className="font-medium text-foreground">{confirmationEmail}</p>
        </div>

        {/* OTP Input */}
        <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
          {otpValues.map((digit, index) => (
            <input
              key={index}
              ref={(el) => { otpInputRefs.current[index] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleOtpChange(index, e.target.value)}
              onKeyDown={(e) => handleOtpKeyDown(index, e)}
              className="w-11 h-13 text-center text-xl font-bold rounded-lg border-2 border-input bg-background focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all"
              disabled={isLoading}
            />
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Code expires in 15 minutes
        </p>
      </div>

      <div className="flex flex-col gap-3 pt-2">
        <Button
          onClick={handleOtpSubmit}
          disabled={isLoading || otpValues.join('').length !== 6}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Verifying...
            </>
          ) : (
            'Verify & Continue'
          )}
        </Button>

        <div className="flex items-center justify-center gap-1 text-sm">
          <span className="text-muted-foreground">Didn't receive it?</span>
          <Button
            variant="link"
            size="sm"
            onClick={handleResendOTP}
            disabled={resendCooldown > 0 || isLoading}
            className="p-0 h-auto"
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
          </Button>
        </div>

        <Button
          variant="ghost"
          onClick={() => {
            setMode('signup');
            signupForm.setValue('email', confirmationEmail);
          }}
          className="w-full text-xs"
        >
          Try a different email
        </Button>
      </div>
    </>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          {mode === 'prompt' && renderPromptMode()}
          {mode === 'signup' && renderSignupMode()}
          {mode === 'login' && renderLoginMode()}
          {mode === 'forgot-password' && renderForgotPasswordMode()}
          {mode === 'reset-verify-otp' && renderResetVerifyOTPMode()}
          {mode === 'reset-new-password' && renderResetNewPasswordMode()}
          {mode === 'verify-otp' && renderVerifyOTPMode()}
        </DialogContent>
      </Dialog>
      <BlockedAccountDialog
        open={showBlockedDialog}
        onOpenChange={setShowBlockedDialog}
      />
    </>
  );
}
