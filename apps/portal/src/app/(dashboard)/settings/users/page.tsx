'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth, type AppUser } from '@/stores/auth-store';
import { supabase } from '@/integrations/supabase/client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  KpiTile,
  TableTile,
  bentoTable,
  StatusPill,
  EmptyState,
  TableSkeleton,
  Modal,
} from '@/components/bento';
import {
  MoreHorizontal,
  Key,
  Shield,
  UserX,
  UserCheck,
  Copy,
  AlertCircle,
  Users as UsersIcon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { useTenant } from '@/contexts/TenantContext';


export default function UsersManagement() {
  const { appUser } = useAuth();
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  // Fetch users for this tenant
  const { data: users, isLoading } = useQuery({
    queryKey: ['users', tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from('app_users')
        .select('*')
        .order('created_at', { ascending: false });

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as AppUser[];
    },
    enabled: !!tenant,
  });

  // Generate random password
  const generatePassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    // Ensure we have at least one of each required type
    password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]; // uppercase
    password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]; // lowercase
    password += '0123456789'[Math.floor(Math.random() * 10)]; // number
    password += '!@#$%^&*'[Math.floor(Math.random() * 8)]; // special

    // Fill the rest
    for (let i = 4; i < 16; i++) {
      password += chars[Math.floor(Math.random() * chars.length)];
    }

    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
  };


  // Reset password mutation
  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      const { data, error } = await supabase.functions.invoke('admin-reset-password', {
        body: { userId, newPassword }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to reset password');

      return data;
    },
    onSuccess: () => {
      setShowResetDialog(false);
      setSelectedUser(null);
      setResetPassword('');
      toast({
        title: "Success",
        description: "Password reset successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reset password",
        variant: "destructive",
      });
    }
  });

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: string }) => {
      const { data, error } = await supabase.functions.invoke('admin-update-role', {
        body: { userId, newRole }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to update role');

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({
        title: "Success",
        description: "User role updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update role",
        variant: "destructive",
      });
    }
  });

  // Toggle active status mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const { data, error } = await supabase.functions.invoke('admin-deactivate-user', {
        body: { userId, isActive }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to update user status');

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({
        title: "Success",
        description: "User status updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user status",
        variant: "destructive",
      });
    }
  });

  const getRoleTone = (role: string): 'primary' | 'info' | 'neutral' => {
    switch (role) {
      case 'head_admin': return 'primary';
      case 'admin': return 'info';
      default: return 'neutral';
    }
  };

  const getRoleDisplay = (role: string) => {
    switch (role) {
      case 'head_admin': return 'Head Admin';
      case 'admin': return 'Admin';
      case 'ops': return 'Operations';
      case 'viewer': return 'Viewer';
      default: return role;
    }
  };


  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Copied to clipboard",
    });
  };

  // Only head_admin can access this page
  if (!appUser || appUser.role !== 'head_admin') {
    return (
      <div className="container mx-auto p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Access denied. Only head administrators can manage users.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const totalUsers = users?.length ?? 0;
  const activeUsers = users?.filter((u) => u.is_active).length ?? 0;
  const adminUsers = users?.filter((u) => u.role === 'head_admin' || u.role === 'admin').length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Users Management</h1>
        <p className="text-muted-foreground">Manage user accounts and permissions</p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiTile label="Total Users" value={totalUsers} icon={<UsersIcon className="h-4 w-4" />} />
        <KpiTile label="Active" value={activeUsers} sub={`${totalUsers - activeUsers} inactive`} />
        <KpiTile label="Administrators" value={adminUsers} icon={<Shield className="h-4 w-4" />} />
      </div>

      <TableTile
        toolbar={<h2 className="text-base font-bold tracking-tight">Users</h2>}
      >
        {isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : !users || users.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="h-5 w-5" />}
            title="No users yet"
            description="Team members you invite will appear here."
          />
        ) : (
          <Table>
            <TableHeader className={bentoTable.header}>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[50px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.map((user) => (
                <TableRow key={user.id} className="border-border">
                  <TableCell className="font-semibold">{user.name || 'N/A'}</TableCell>
                  <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    <StatusPill tone={getRoleTone(user.role)}>
                      {getRoleDisplay(user.role)}
                    </StatusPill>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <StatusPill tone={user.is_active ? 'success' : 'danger'} dot>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </StatusPill>
                      {user.must_change_password && (
                        <StatusPill tone="warn">Temp Password</StatusPill>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">{format(new Date(user.created_at), 'MMM d, yyyy')}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem
                          onClick={() => {
                            setSelectedUser(user);
                            setResetPassword(generatePassword());
                            setShowResetDialog(true);
                          }}
                        >
                          <Key className="mr-2 h-4 w-4" />
                          Reset Password
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const newRole = user.role === 'viewer' ? 'ops' :
                                          user.role === 'ops' ? 'admin' : 'viewer';
                            updateRoleMutation.mutate({ userId: user.id, newRole });
                          }}
                        >
                          <Shield className="mr-2 h-4 w-4" />
                          Change Role
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            toggleActiveMutation.mutate({
                              userId: user.id,
                              isActive: !user.is_active
                            })
                          }
                        >
                          {user.is_active ? (
                            <>
                              <UserX className="mr-2 h-4 w-4" />
                              Deactivate
                            </>
                          ) : (
                            <>
                              <UserCheck className="mr-2 h-4 w-4" />
                              Activate
                            </>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableTile>


      {/* Reset Password Dialog */}
      <Modal
        open={showResetDialog}
        onOpenChange={setShowResetDialog}
        title="Reset Password"
        description={selectedUser ? `Reset password for ${selectedUser.name} (${selectedUser.email})` : undefined}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setShowResetDialog(false)}
              disabled={resetPasswordMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => selectedUser && resetPasswordMutation.mutate({
                userId: selectedUser.id,
                newPassword: resetPassword
              })}
              disabled={!resetPassword || resetPasswordMutation.isPending}
            >
              {resetPasswordMutation.isPending ? 'Resetting...' : 'Reset Password'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <div className="flex gap-2">
              <Input
                id="new-password"
                type="text"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="Enter new password"
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setResetPassword(generatePassword())}
              >
                Generate
              </Button>
              {resetPassword && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(resetPassword)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
