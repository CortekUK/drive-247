'use client';

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus } from "lucide-react";
import { addUserSchema, type AddUserFormValues } from "@/client-schemas/users/add-user";
import { ManagerPermissionsSelector } from "@/components/users/manager-permissions-selector";

interface AddUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: AddUserFormValues) => void;
  isLoading?: boolean;
}

export function AddUserDialog({ open, onOpenChange, onSubmit, isLoading }: AddUserDialogProps) {
  const form = useForm<AddUserFormValues>({
    resolver: zodResolver(addUserSchema),
    defaultValues: {
      name: "",
      email: "",
      role: undefined,
      permissions: [],
    },
  });

  const watchRole = form.watch("role");
  const isManager = watchRole === "manager";

  const handleSubmit = (data: AddUserFormValues) => {
    // Strip permissions for non-manager roles
    if (data.role !== 'manager') {
      data.permissions = undefined;
    }
    onSubmit(data);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      form.reset();
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={isManager ? "sm:max-w-[650px] max-h-[90vh] overflow-y-auto" : "sm:max-w-[425px]"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Add New User
          </DialogTitle>
          <DialogDescription>
            Create a new user account for this tenant. They will receive an email with login credentials.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name <span className="text-red-500">*</span></FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. John Smith" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address <span className="text-red-500">*</span></FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="e.g. john@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role <span className="text-red-500">*</span></FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="admin">Admin - Full access except user management</SelectItem>
                      <SelectItem value="manager">Manager - Custom tab access</SelectItem>
                      <SelectItem value="ops">Operations - Day-to-day operations</SelectItem>
                      <SelectItem value="viewer">Viewer - Read-only access</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isManager && (
              <FormField
                control={form.control}
                name="permissions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tab Permissions <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <ManagerPermissionsSelector
                        value={field.value || []}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter className="pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isLoading}
                className="bg-gradient-primary"
              >
                {isLoading ? "Creating..." : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
