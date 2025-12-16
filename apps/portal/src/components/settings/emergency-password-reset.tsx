import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';

export const EmergencyPasswordReset = () => {
  const [email, setEmail] = useState('admin@company.com');
  const [tempPassword, setTempPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const handleEmergencyReset = async () => {
    if (!tempPassword) {
      setMessage('Please enter a temporary password');
      return;
    }

    setIsSubmitting(true);
    setMessage('');

    try {
      const { data, error } = await supabase.functions.invoke('emergency-password-reset', {
        body: {
          email,
          tempPassword
        }
      });

      if (error) {
        setMessage(`Error: ${error.message}`);
        setIsSuccess(false);
      } else if (data?.success) {
        setMessage('Password reset successfully! You can now login with your new password.');
        setIsSuccess(true);
      } else {
        setMessage(data?.error || 'Failed to reset password');
        setIsSuccess(false);
      }
    } catch (err) {
      setMessage('Failed to reset password. Please try again.');
      setIsSuccess(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Emergency Password Reset</CardTitle>
        <CardDescription>
          Reset your password directly without email verification
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isSubmitting}
          />
        </div>
        
        <div className="space-y-2">
          <label htmlFor="tempPassword" className="text-sm font-medium">
            New Password
          </label>
          <Input
            id="tempPassword"
            type="password"
            value={tempPassword}
            onChange={(e) => setTempPassword(e.target.value)}
            placeholder="Enter your new password"
            disabled={isSubmitting}
          />
        </div>

        {message && (
          <Alert variant={isSuccess ? "default" : "destructive"}>
            <AlertDescription>
              {message}
              {isSuccess && (
                <div className="mt-2 text-sm font-medium">
                  👈 Now enter this password in the main Sign In form and click "Sign In"
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Button 
          onClick={handleEmergencyReset}
          disabled={isSubmitting}
          className="w-full"
        >
          {isSubmitting ? 'Resetting...' : 'Reset Password'}
        </Button>
      </CardContent>
    </Card>
  );
};