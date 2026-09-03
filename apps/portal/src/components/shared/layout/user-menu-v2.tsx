"use client";

import { useState, useRef, useCallback } from 'react';
import { useAuth, useAuthStore } from '@/stores/auth-store';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui-v2/dropdown-menu';
import { Button } from '@/components/ui-v2/button';
import { Badge } from '@/components/ui-v2/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui-v2/avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui-v2/dialog';
import { Input } from '@/components/ui-v2/input';
import { Label } from '@/components/ui-v2/label';
import { User, LogOut, Key, Camera, Loader2, Moon, Sun, ChevronsUpDown, LifeBuoy, Send } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui-v2/switch';
import { useFeedbackStore } from '@/stores/feedback-store';
import { useFeedbackSettings } from '@/hooks/use-feedback-settings';
import { toast } from '@/hooks/use-toast';
import { AvatarCropDialog } from './avatar-crop-dialog';

/**
 * v2 user menu. New file beside `user-menu.tsx`, never an edit to it — the v1
 * menu keeps serving every tenant not on the `chrome` gate (V2_PLAN §3).
 *
 * Two shapes: `icon` (the compact avatar button, as v1) and `row` (the full
 * profile row that sits in the v2 sidebar footer).
 */
export const UserMenuV2 = ({ variant = 'icon' }: { variant?: 'icon' | 'row' } = {}) => {
  const { appUser, signOut, updatePassword } = useAuth();
  const { tenant, refetchTenant } = useTenant();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const openFeedback = useFeedbackStore((s) => s.open);
  // Same gate the v1 sidebar puts on its "Send Feedback" row. The entry point
  // moved into this menu; the switch that turns it off must move with it, or a
  // tenant who disabled the form gets it back through the side door.
  const { formEnabled: feedbackEnabled } = useFeedbackSettings();

  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showProfileDialog, setShowProfileDialog] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [adminName, setAdminName] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUpdatingName, setIsUpdatingName] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [showCropDialog, setShowCropDialog] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleCroppedUpload = useCallback(async (blob: Blob) => {
    setIsUploadingAvatar(true);
    try {
      const filePath = `avatars/${appUser?.id}-${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage
        .from('cms-media')
        .upload(filePath, blob, { upsert: true, contentType: 'image/png' });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('cms-media')
        .getPublicUrl(filePath);

      // Scoped by the row's own primary key, which belongs to the signed-in
      // user — this writes to nobody else's profile.
      const { error: updateError } = await (supabase as any)
        .from('app_users')
        .update({ avatar_url: publicUrl })
        .eq('id', appUser?.id);

      if (updateError) throw updateError;

      // `useAuth` is a selector wrapper, not the store — `useAuth.setState` is
      // undefined at runtime and threw here on every avatar upload. The store
      // itself carries setState.
      useAuthStore.setState({
        appUser: appUser ? { ...appUser, avatar_url: publicUrl } : appUser,
      });

      toast({ title: "Success", description: "Profile photo updated" });
      setShowCropDialog(false);
      setCropImageSrc(null);
    } catch (error: any) {
      console.error('Avatar upload error:', error);
      toast({ title: "Error", description: error.message || "Failed to upload photo", variant: "destructive" });
    } finally {
      setIsUploadingAvatar(false);
    }
  }, [appUser]);

  // Every hook above this guard runs unconditionally — the early return must
  // stay below them so hook order never changes between renders.
  if (!appUser) return null;

  const userInitials = (appUser.name || appUser.email || 'U')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const handleFileSelected = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({ title: "Error", description: "Please upload an image file", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Error", description: "Image must be less than 5MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCropImageSrc(reader.result as string);
      setShowCropDialog(true);
    };
    reader.readAsDataURL(file);
  };

  const handlePasswordChange = async () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: "Error",
        description: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 12) {
      toast({
        title: "Error",
        description: "Password must be at least 12 characters long",
        variant: "destructive",
      });
      return;
    }

    // Check password complexity
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasLower = /[a-z]/.test(newPassword);
    const hasNumber = /\d/.test(newPassword);

    if (!hasUpper || !hasLower || !hasNumber) {
      toast({
        title: "Error",
        description: "Password must contain uppercase, lowercase, and numeric characters",
        variant: "destructive",
      });
      return;
    }

    setIsUpdating(true);
    try {
      const { error } = await updatePassword(newPassword);

      if (error) {
        toast({
          title: "Error",
          description: error.message || "Failed to update password",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: "Password updated successfully",
        });
        setShowPasswordDialog(false);
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const handleOpenProfile = () => {
    setAdminName(tenant?.admin_name || appUser?.name || '');
    setShowProfileDialog(true);
  };

  const handleNameChange = async () => {
    if (!tenant?.id) {
      toast({
        title: "Error",
        description: "Tenant not found",
        variant: "destructive",
      });
      return;
    }

    if (!adminName.trim()) {
      toast({
        title: "Error",
        description: "Name cannot be empty",
        variant: "destructive",
      });
      return;
    }

    setIsUpdatingName(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ admin_name: adminName.trim() })
        .eq('id', tenant.id);

      if (error) {
        toast({
          title: "Error",
          description: error.message || "Failed to update name",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: "Name updated successfully",
        });
        refetchTenant();
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingName(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === 'row' ? (
            // Neutral hover and open states. These were `bg-sidebar-accent`,
            // which the theme hook drives from the tenant's accent colour, so on
            // a warm brand the whole row turned solid orange the moment the menu
            // opened. A row that is only a trigger should not be the loudest
            // thing on screen.
            <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left outline-none cursor-pointer transition-colors hover:bg-foreground/5 data-[state=open]:bg-foreground/5">
              <Avatar className="h-8 w-8 rounded-full overflow-hidden shrink-0">
                <AvatarImage src={appUser.avatar_url || undefined} alt={appUser.name || 'User'} className="object-cover" />
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold leading-tight truncate">{appUser.name || 'User'}</span>
                <span className="block text-[11px] text-muted-foreground leading-tight truncate">{appUser.email}</span>
              </span>
              {appUser.must_change_password && (
                <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
              )}
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ) : (
            <Button variant="ghost" size="icon" className="relative hover:bg-accent transition-colors cursor-pointer">
              <Avatar className="h-8 w-8 rounded-full overflow-hidden">
                <AvatarImage src={appUser.avatar_url || undefined} alt={appUser.name || 'User'} className="object-cover" />
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              {appUser.must_change_password && (
                <div className="absolute -top-1 -right-1 h-3 w-3 bg-destructive rounded-full" />
              )}
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={8} className="w-64 p-0 rounded-xl overflow-hidden">
          {/* User info header */}
          <div className="p-2.5 pb-2">
            <div className="flex items-center gap-2.5">
              <Avatar className="h-9 w-9 ring-2 ring-border/50 rounded-full overflow-hidden">
                <AvatarImage src={appUser.avatar_url || undefined} alt={appUser.name || 'User'} className="object-cover" />
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[13px] truncate leading-tight">{appUser.name || 'User'}</div>
                <div className="text-[11px] text-muted-foreground/70 truncate leading-tight">{appUser.email}</div>
              </div>
            </div>
          </div>

          <DropdownMenuSeparator className="m-0" />

          {/* Menu items — Profile · Dark Mode */}
          <div className="p-1.5">
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelected(file);
                e.target.value = '';
              }}
            />
            {/* Billing and Settings are not here by request. Both belong to the
                organisation rather than the person, and both live on the org
                switcher — billing in its dropdown, settings as the gear beside
                it — so nothing became unreachable. */}
            <DropdownMenuItem onClick={handleOpenProfile} className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px]">
              <User className="mr-2.5 h-4 w-4 text-muted-foreground" />
              <span>Profile</span>
              {appUser.must_change_password && (
                <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0">Action</Badge>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setTheme(isDark ? 'light' : 'dark');
              }}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px]"
            >
              {isDark ? (
                <Sun className="mr-2.5 h-4 w-4 text-muted-foreground" />
              ) : (
                <Moon className="mr-2.5 h-4 w-4 text-muted-foreground" />
              )}
              <span>Dark Mode</span>
              <Switch checked={isDark} className="ml-auto pointer-events-none" />
            </DropdownMenuItem>
          </div>

          <DropdownMenuSeparator className="m-0" />

          {/* Support & feedback */}
          <div className="p-1.5">
            <DropdownMenuItem asChild>
              <a href="mailto:support@drive-247.com" className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px]">
                <LifeBuoy className="mr-2.5 h-4 w-4 text-muted-foreground" />
                <span>Support</span>
              </a>
            </DropdownMenuItem>
            {/* The in-app dialog, not a mailto — this is the v1 sidebar's
                "Send Feedback" button rehomed here, so the feedback still
                lands in `tenant_feedback` rather than someone's inbox.
                `source` stays "sidebar": the values are persisted behind a
                CHECK constraint, and this menu does live in the sidebar. */}
            {feedbackEnabled && (
              <DropdownMenuItem
                onSelect={() => openFeedback({ source: "sidebar" })}
                className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px]"
              >
                <Send className="mr-2.5 h-4 w-4 text-muted-foreground" />
                <span>Feedback</span>
              </DropdownMenuItem>
            )}
          </div>

          <DropdownMenuSeparator className="m-0" />

          <div className="p-1.5">
            <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px] text-destructive focus:text-destructive focus:bg-destructive/10">
              <LogOut className="mr-2.5 h-4 w-4" />
              <span>Sign Out</span>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Enter a new password. Must be at least 12 characters with uppercase, lowercase, and numeric characters.
              {appUser.must_change_password && (
                <div className="mt-2 text-destructive font-medium">
                  Password change is required before continuing.
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                minLength={12}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                minLength={12}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowPasswordDialog(false)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePasswordChange}
              disabled={!newPassword || !confirmPassword || isUpdating}
            >
              {isUpdating ? 'Updating...' : 'Update Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showProfileDialog} onOpenChange={setShowProfileDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Profile</DialogTitle>
            <DialogDescription>
              Manage your photo, display name, and password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {/* Avatar */}
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 ring-2 ring-border/50 rounded-full overflow-hidden">
                <AvatarImage src={appUser.avatar_url || undefined} alt={appUser.name || 'User'} className="object-cover" />
                <AvatarFallback className="bg-primary/10 text-primary text-base font-semibold">{userInitials}</AvatarFallback>
              </Avatar>
              <Button
                variant="outline"
                size="sm"
                onClick={() => avatarInputRef.current?.click()}
                disabled={isUploadingAvatar}
              >
                {isUploadingAvatar ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Camera className="mr-2 h-4 w-4" />
                    Change Photo
                  </>
                )}
              </Button>
            </div>

            {/* Display name */}
            <div className="space-y-2">
              <Label htmlFor="profile-name">Display Name</Label>
              <div className="flex gap-2">
                <Input
                  id="profile-name"
                  type="text"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="Enter your name"
                />
                <Button onClick={handleNameChange} disabled={!adminName.trim() || isUpdatingName}>
                  {isUpdatingName ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>

            {/* Password */}
            {!appUser.is_super_admin && (
              <div className="space-y-2">
                <Label>Password</Label>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    setShowProfileDialog(false);
                    setShowPasswordDialog(true);
                  }}
                >
                  <Key className="mr-2 h-4 w-4" />
                  Change Password
                  {appUser.must_change_password && (
                    <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0">Required</Badge>
                  )}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AvatarCropDialog
        open={showCropDialog}
        onOpenChange={(open) => {
          setShowCropDialog(open);
          if (!open) setCropImageSrc(null);
        }}
        imageSrc={cropImageSrc}
        onCropComplete={handleCroppedUpload}
        isUploading={isUploadingAvatar}
      />
    </>
  );
};
