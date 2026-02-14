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
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  MoreHorizontal,
  Key,
  Shield,
  UserX,
  UserCheck,
  Copy,
  AlertCircle,
  Plus,
  Users,
  Settings2
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { useTenant } from '@/contexts/TenantContext';
import { AddUserDialog } from '@/components/users/add-user-dialog';
import { CredentialsModal } from '@/components/users/credentials-modal';
import { ManagerPermissionsSelector } from '@/components/users/manager-permissions-selector';
import type { AddUserFormValues, PermissionEntry } from '@/client-schemas/users/add-user';

interface UserCredentials {
  name: string;
  email: string;
  password: string;
}

export default function UsersManagement() {
  const { appUser } = useAuth();
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  // Dialog states
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [newUserCredentials, setNewUserCredentials] = useState<UserCredentials | null>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [rolePermissions, setRolePermissions] = useState<PermissionEntry[]>([]);
  const [showEditPermissionsDialog, setShowEditPermissionsDialog] = useState(false);
  const [editPermissions, setEditPermissions] = useState<PermissionEntry[]>([]);
  const [editPermissionsUser, setEditPermissionsUser] = useState<AppUser | null>(null);

  // Fetch users for this tenant
  const { data: users, isLoading, refetch } = useQuery({
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

      if (error) {
        console.error('Error fetching users:', error);
        throw error;
      }
      return data as AppUser[];
    },
    enabled: !!tenant,
    staleTime: 0, // Always consider data stale so it refetches on invalidation
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

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: async (data: AddUserFormValues) => {
      const temporaryPassword = generatePassword();

      // Call admin-create-user edge function
      // Pass the tenant_id from context to ensure user is created in the correct tenant
      const { data: result, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: data.email,
          name: data.name,
          role: data.role,
          temporaryPassword,
          tenant_id: tenant?.id, // Use tenant from URL context, not from logged-in user
          ...(data.role === 'manager' && data.permissions ? { permissions: data.permissions } : {}),
        }
      });

      if (error) throw error;
      if (!result.success) throw new Error(result.error || 'Failed to create user');

      // Send welcome email
      try {
        await supabase.functions.invoke('send-user-welcome-email', {
          body: {
            email: data.email,
            name: data.name,
            temporaryPassword,
            tenant_id: tenant?.id,
          }
        });
      } catch (emailError) {
        console.error('Failed to send welcome email:', emailError);
        // Don't fail the whole operation if email fails
      }

      return { ...result, temporaryPassword, name: data.name, email: data.email };
    },
    onSuccess: async (data) => {
      console.log('User created successfully, refreshing list...');
      // Invalidate and refetch the users query to ensure the list updates
      await queryClient.invalidateQueries({ queryKey: ['users', tenant?.id] });
      await refetch();
      setShowAddDialog(false);
      // Show credentials modal
      setNewUserCredentials({
        name: data.name,
        email: data.email,
        password: data.temporaryPassword,
      });
      setShowCredentialsModal(true);
      toast({
        title: "Success",
        description: "User created successfully. A welcome email has been sent.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create user",
        variant: "destructive",
      });
    }
  });

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
    mutationFn: async ({ userId, newRole, permissions }: { userId: string; newRole: string; permissions?: PermissionEntry[] }) => {
      const { data, error } = await supabase.functions.invoke('admin-update-role', {
        body: { userId, newRole, ...(newRole === 'manager' && permissions ? { permissions } : {}) }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to update role');

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users', tenant?.id] });
      setShowRoleDialog(false);
      setSelectedUser(null);
      setSelectedRole('');
      setRolePermissions([]);
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

  // Update manager permissions mutation
  const updatePermissionsMutation = useMutation({
    mutationFn: async ({ userId, permissions }: { userId: string; permissions: PermissionEntry[] }) => {
      const { data, error } = await supabase.functions.invoke('update-manager-permissions', {
        body: { userId, permissions }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to update permissions');

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users', tenant?.id] });
      setShowEditPermissionsDialog(false);
      setEditPermissionsUser(null);
      setEditPermissions([]);
      toast({
        title: "Success",
        description: "Manager permissions updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update permissions",
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
      queryClient.invalidateQueries({ queryKey: ['users', tenant?.id] });
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

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'head_admin': return 'default';
      case 'admin': return 'secondary';
      case 'manager': return 'secondary';
      case 'ops': return 'outline';
      case 'viewer': return 'outline';
      default: return 'outline';
    }
  };

  const getRoleDisplay = (role: string) => {
    switch (role) {
      case 'head_admin': return 'Head Admin';
      case 'admin': return 'Admin';
      case 'manager': return 'Manager';
      case 'ops': return 'Operations';
      case 'viewer': return 'Viewer';
      default: return role;
    }
  };

  const handleOpenEditPermissions = async (user: AppUser) => {
    setEditPermissionsUser(user);
    // Fetch current permissions for this user
    const { data } = await supabase
      .from('manager_permissions')
      .select('tab_key, access_level')
      .eq('app_user_id', user.id);
    setEditPermissions((data || []).map((p: any) => ({ tab_key: p.tab_key, access_level: p.access_level })));
    setShowEditPermissionsDialog(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Copied to clipboard",
    });
  };

  const handleAddUser = (data: AddUserFormValues) => {
    createUserMutation.mutate(data);
  };

  // Only head_admin can access this page
  if (!appUser || appUser.role !== 'head_admin') {
    return (
      <div className="p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Access denied. Only head administrators can manage users.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-8 w-8" />
            Manage Users
          </h1>
          <p className="text-muted-foreground">Create and manage user accounts for your team</p>
        </div>
        <Button
          onClick={() => setShowAddDialog(true)}
          className="bg-gradient-primary text-primary-foreground"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>
            All users with access to this portal. Head admins can create admins, operations staff, and viewers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading users...</div>
          ) : users?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No users found. Click "Add User" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[50px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name || 'N/A'}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={getRoleBadgeVariant(user.role)}>
                        {getRoleDisplay(user.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Badge variant={user.is_active ? 'default' : 'destructive'}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        {user.must_change_password && (
                          <Badge variant="outline" className="text-xs">
                            Temp Password
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{format(new Date(user.created_at), 'MMM d, yyyy')}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator />
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
                          {user.role !== 'head_admin' && (
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedUser(user);
                                setSelectedRole(user.role);
                                setRolePermissions([]);
                                setShowRoleDialog(true);
                              }}
                            >
                              <Shield className="mr-2 h-4 w-4" />
                              Change Role
                            </DropdownMenuItem>
                          )}
                          {user.role === 'manager' && (
                            <DropdownMenuItem onClick={() => handleOpenEditPermissions(user)}>
                              <Settings2 className="mr-2 h-4 w-4" />
                              Edit Permissions
                            </DropdownMenuItem>
                          )}
                          {user.id !== appUser?.id && (
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
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <AddUserDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSubmit={handleAddUser}
        isLoading={createUserMutation.isPending}
      />

      {/* Credentials Modal */}
      <CredentialsModal
        open={showCredentialsModal}
        onOpenChange={setShowCredentialsModal}
        credentials={newUserCredentials}
      />

      {/* Reset Password Dialog */}
      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Reset password for {selectedUser?.name} ({selectedUser?.email})
            </DialogDescription>
          </DialogHeader>
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
          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Role Dialog */}
      <Dialog open={showRoleDialog} onOpenChange={setShowRoleDialog}>
        <DialogContent className={selectedRole === 'manager' ? 'sm:max-w-[650px]' : ''}>
          <DialogHeader>
            <DialogTitle>Change User Role</DialogTitle>
            <DialogDescription>
              Change role for {selectedUser?.name} ({selectedUser?.email})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-select">New Role</Label>
              <Select value={selectedRole} onValueChange={(v) => { setSelectedRole(v); setRolePermissions([]); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin - Full access except user management</SelectItem>
                  <SelectItem value="manager">Manager - Custom tab access</SelectItem>
                  <SelectItem value="ops">Operations - Day-to-day operations</SelectItem>
                  <SelectItem value="viewer">Viewer - Read-only access</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {selectedRole === 'manager' && (
              <div className="space-y-2">
                <Label>Tab Permissions</Label>
                <ManagerPermissionsSelector
                  value={rolePermissions}
                  onChange={setRolePermissions}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRoleDialog(false)}
              disabled={updateRoleMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => selectedUser && updateRoleMutation.mutate({
                userId: selectedUser.id,
                newRole: selectedRole,
                ...(selectedRole === 'manager' ? { permissions: rolePermissions } : {}),
              })}
              disabled={
                !selectedRole ||
                (selectedRole === selectedUser?.role && selectedRole !== 'manager') ||
                (selectedRole === 'manager' && rolePermissions.length === 0) ||
                updateRoleMutation.isPending
              }
            >
              {updateRoleMutation.isPending ? 'Updating...' : 'Update Role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Manager Permissions Dialog */}
      <Dialog open={showEditPermissionsDialog} onOpenChange={setShowEditPermissionsDialog}>
        <DialogContent className="sm:max-w-[650px]">
          <DialogHeader>
            <DialogTitle>Edit Manager Permissions</DialogTitle>
            <DialogDescription>
              Update tab access for {editPermissionsUser?.name} ({editPermissionsUser?.email})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ManagerPermissionsSelector
              value={editPermissions}
              onChange={setEditPermissions}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditPermissionsDialog(false)}
              disabled={updatePermissionsMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => editPermissionsUser && updatePermissionsMutation.mutate({
                userId: editPermissionsUser.id,
                permissions: editPermissions,
              })}
              disabled={editPermissions.length === 0 || updatePermissionsMutation.isPending}
            >
              {updatePermissionsMutation.isPending ? 'Saving...' : 'Save Permissions'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
