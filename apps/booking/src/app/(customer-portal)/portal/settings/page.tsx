'use client';

import { useState, useRef } from 'react';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';
import {
  User,
  Mail,
  Lock,
  Camera,
  Loader2,
  CheckCircle,
  AlertCircle,
  Shield,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';

export default function SettingsPage() {
  const { customerUser, user, refetchCustomerUser } = useCustomerAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile state
  const [name, setName] = useState(customerUser?.customer?.name || '');
  const [phone, setPhone] = useState(customerUser?.customer?.phone || '');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  // Password change state
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Email change state
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [isChangingEmail, setIsChangingEmail] = useState(false);

  const customerEmail = customerUser?.customer?.email || user?.email || '';
  const isEmailVerified = user?.email_confirmed_at != null;

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Handle profile photo upload
  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file (PNG, JPG, etc.)');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Please upload an image smaller than 2MB');
      return;
    }

    setIsUploadingPhoto(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${customerUser?.customer_id}-${Date.now()}.${fileExt}`;

      // Delete old photo if exists
      if (customerUser?.customer?.profile_photo_url) {
        const oldFileName = customerUser.customer.profile_photo_url.split('/').pop();
        if (oldFileName) {
          await supabase.storage.from('customer-photos').remove([oldFileName]);
        }
      }

      // Upload new photo
      const { error: uploadError } = await supabase.storage
        .from('customer-photos')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('customer-photos')
        .getPublicUrl(fileName);

      // Update customer record
      const { error: updateError } = await supabase
        .from('customers')
        .update({ profile_photo_url: publicUrl })
        .eq('id', customerUser?.customer_id);

      if (updateError) throw updateError;

      await refetchCustomerUser();
      toast.success('Profile photo updated successfully');
    } catch (error: any) {
      console.error('Error uploading photo:', error);
      toast.error(error.message || 'Failed to upload photo');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  // Handle profile update
  const handleUpdateProfile = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }

    setIsUpdatingProfile(true);

    try {
      const { error } = await supabase
        .from('customers')
        .update({
          name: name.trim(),
          phone: phone.trim() || null,
        })
        .eq('id', customerUser?.customer_id);

      if (error) throw error;

      await refetchCustomerUser();
      toast.success('Profile updated successfully');
    } catch (error: any) {
      console.error('Error updating profile:', error);
      toast.error(error.message || 'Failed to update profile');
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  // Handle password change
  const handleChangePassword = async () => {
    if (!newPassword || !confirmPassword) {
      toast.error('Please fill in all password fields');
      return;
    }

    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setIsChangingPassword(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      toast.success('Password changed successfully');
      setShowPasswordDialog(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error('Error changing password:', error);
      toast.error(error.message || 'Failed to change password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Handle email change
  const handleChangeEmail = async () => {
    if (!newEmail.trim()) {
      toast.error('Please enter a new email address');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      toast.error('Please enter a valid email address');
      return;
    }

    if (newEmail === customerEmail) {
      toast.error('New email must be different from current email');
      return;
    }

    setIsChangingEmail(true);

    try {
      // Supabase will send a confirmation email to the new address
      const { error } = await supabase.auth.updateUser({
        email: newEmail,
      });

      if (error) throw error;

      toast.success('Verification email sent! Please check your new email address to confirm the change.');
      setShowEmailDialog(false);
      setNewEmail('');
      setEmailPassword('');
    } catch (error: any) {
      console.error('Error changing email:', error);
      toast.error(error.message || 'Failed to change email');
    } finally {
      setIsChangingEmail(false);
    }
  };

  // Handle resend verification email
  const handleResendVerification = async () => {
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: customerEmail,
      });

      if (error) throw error;

      toast.success('Verification email sent! Please check your inbox.');
    } catch (error: any) {
      console.error('Error resending verification:', error);
      toast.error(error.message || 'Failed to send verification email');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Account Settings</h1>
        <p className="text-muted-foreground">
          Manage your profile, security, and account preferences
        </p>
      </div>

      {/* Email Verification Alert */}
      {!isEmailVerified && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Email not verified</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>Please verify your email address to access all features.</span>
            <Button variant="outline" size="sm" onClick={handleResendVerification}>
              Resend Verification
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Profile Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>
                Update your profile photo and personal details
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Profile Photo */}
          <div className="flex items-center gap-6">
            <div className="relative">
              <Avatar className="h-24 w-24">
                <AvatarImage src={customerUser?.customer?.profile_photo_url || undefined} />
                <AvatarFallback className="text-lg bg-primary/10">
                  {getInitials(customerUser?.customer?.name || 'U')}
                </AvatarFallback>
              </Avatar>
              <Button
                size="icon"
                variant="secondary"
                className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingPhoto}
              >
                {isUploadingPhoto ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />
            </div>
            <div>
              <p className="font-medium">Profile Photo</p>
              <p className="text-sm text-muted-foreground">
                Click the camera icon to upload a new photo
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Max size: 2MB. PNG, JPG, or GIF.
              </p>
            </div>
          </div>

          <Separator />

          {/* Name & Phone */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter your phone number"
              />
            </div>
          </div>

          <Button onClick={handleUpdateProfile} disabled={isUpdatingProfile}>
            {isUpdatingProfile && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>

      {/* Email Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Email Address</CardTitle>
              <CardDescription>
                Manage your email address and verification status
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">{customerEmail}</p>
                <div className="flex items-center gap-2 mt-1">
                  {isEmailVerified ? (
                    <span className="flex items-center gap-1 text-sm text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      Verified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-sm text-amber-600">
                      <AlertCircle className="h-4 w-4" />
                      Not verified
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Button variant="outline" onClick={() => setShowEmailDialog(true)}>
              Change Email
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Security Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Security</CardTitle>
              <CardDescription>
                Manage your password and account security
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <Lock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Password</p>
                <p className="text-sm text-muted-foreground">
                  Last changed: Unknown
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={() => setShowPasswordDialog(true)}>
              Change Password
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Password Change Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Enter a new password for your account. Password must be at least 8 characters.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleChangePassword} disabled={isChangingPassword}>
              {isChangingPassword && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Change Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Change Dialog */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Email Address</DialogTitle>
            <DialogDescription>
              Enter your new email address. A verification link will be sent to confirm the change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Current Email</Label>
              <Input value={customerEmail} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-email">New Email Address</Label>
              <Input
                id="new-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Enter new email address"
              />
            </div>
            <Alert>
              <Mail className="h-4 w-4" />
              <AlertTitle>Important</AlertTitle>
              <AlertDescription>
                A verification email will be sent to your new address. You must click the link to confirm the change.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmailDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleChangeEmail} disabled={isChangingEmail}>
              {isChangingEmail && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Send Verification
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
