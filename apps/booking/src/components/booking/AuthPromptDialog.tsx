'use client';

import { useState } from 'react';
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
  User,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';

type AuthMode = 'prompt' | 'signup' | 'login' | 'forgot-password' | 'check-email';

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

  const { signUp, signIn, resetPassword } = useCustomerAuthStore();
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
      const { error, data: signupData } = await signUp(data.email, data.password, {
        customerId,
        tenantId: tenant?.id,
        customerName: data.name,
        customerPhone,
      });

      if (error) {
        if (error.message?.includes('already')) {
          toast.error('An account with this email already exists. Please log in instead.');
          setMode('login');
          loginForm.setValue('email', data.email);
        } else {
          toast.error(error.message || 'Failed to create account');
        }
        return;
      }

      // Check if email confirmation is required
      if (signupData?.needsEmailConfirmation) {
        setConfirmationEmail(data.email);
        setMode('check-email');
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
      const { error } = await signIn(data.email, data.password, tenant?.id);

      if (error) {
        if (error.message?.includes('Invalid login')) {
          toast.error('Invalid email or password');
        } else if (error.message?.includes('No customer')) {
          toast.error('No customer account found. Please create an account.');
          setMode('signup');
          signupForm.setValue('email', data.email);
        } else {
          toast.error(error.message || 'Failed to log in');
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
      const { error } = await resetPassword(email);

      if (error) {
        toast.error(error.message || 'Failed to send reset email');
        return;
      }

      toast.success('Password reset email sent! Check your inbox.');
      setMode('login');
    } catch (error) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = () => {
    onSkip();
    // Reset state when dialog closes
    setTimeout(() => {
      setMode('prompt');
      signupForm.reset();
      loginForm.reset();
    }, 300);
  };

  const handleClose = (open: boolean) => {
    onOpenChange(open);
    if (!open) {
      // Reset state when dialog closes
      setTimeout(() => {
        setMode('prompt');
        signupForm.reset();
        loginForm.reset();
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
          Enter your email and we'll send you a reset link
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
            'Send Reset Link'
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

  const renderCheckEmailMode = () => (
    <>
      <DialogHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
          <Mail className="h-8 w-8 text-accent" />
        </div>
        <DialogTitle className="text-xl">Check Your Email</DialogTitle>
        <DialogDescription className="text-center">
          We've sent a confirmation link to
        </DialogDescription>
      </DialogHeader>

      <div className="py-4 space-y-4">
        <div className="bg-muted/50 rounded-lg p-3 text-center">
          <p className="font-medium text-foreground">{confirmationEmail}</p>
        </div>

        <p className="text-sm text-muted-foreground text-center">
          Click the link in the email to confirm your account. You'll be automatically logged in and redirected back here.
        </p>

        <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Didn't receive the email?</strong> Check your spam folder or try signing up again.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-2">
        <Button variant="outline" onClick={handleSkip} className="w-full">
          Continue Without Account
        </Button>
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
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {mode === 'prompt' && renderPromptMode()}
        {mode === 'signup' && renderSignupMode()}
        {mode === 'login' && renderLoginMode()}
        {mode === 'forgot-password' && renderForgotPasswordMode()}
        {mode === 'check-email' && renderCheckEmailMode()}
      </DialogContent>
    </Dialog>
  );
}
