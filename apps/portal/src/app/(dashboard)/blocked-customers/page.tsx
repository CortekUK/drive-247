"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Ban, Plus, Trash2, User, CreditCard, Search, CheckCircle, AlertTriangle, Eye } from "lucide-react";
import { useCustomerBlockingActions, useBlockedIdentities } from "@/hooks/use-customer-blocking";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";

interface BlockedCustomer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  license_number: string | null;
  id_number: string | null;
  is_blocked: boolean;
  blocked_at: string | null;
  blocked_reason: string | null;
}

const BlockedCustomers = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();
  const [searchTerm, setSearchTerm] = useState("");
  const [addIdentityDialogOpen, setAddIdentityDialogOpen] = useState(false);
  const [newIdentity, setNewIdentity] = useState({
    type: "license" as "license" | "id_card" | "passport" | "other",
    number: "",
    reason: "",
    notes: ""
  });
  const [unblockCustomerDialog, setUnblockCustomerDialog] = useState<{ open: boolean; id: string; name: string } | null>(null);
  const [removeIdentityDialog, setRemoveIdentityDialog] = useState<{ open: boolean; id: string; number: string } | null>(null);

  const { unblockCustomer, addBlockedIdentity, removeBlockedIdentity, isLoading } = useCustomerBlockingActions();
  const { data: blockedIdentities, isLoading: identitiesLoading } = useBlockedIdentities();

  // Fetch blocked customers
  const { data: blockedCustomers, isLoading: customersLoading, refetch: refetchCustomers } = useQuery({
    queryKey: ["blocked-customers", tenant?.id],
    queryFn: async (): Promise<BlockedCustomer[]> => {
      let query = supabase
        .from("customers")
        .select("id, name, email, phone, license_number, id_number, is_blocked, blocked_at, blocked_reason")
        .eq("is_blocked", true)
        .order("blocked_at", { ascending: false });

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as BlockedCustomer[];
    },
    enabled: !!tenant,
  });

  const handleUnblockCustomer = () => {
    if (unblockCustomerDialog) {
      unblockCustomer.mutate(unblockCustomerDialog.id, {
        onSuccess: () => {
          refetchCustomers();
          setUnblockCustomerDialog(null);
        }
      });
    }
  };

  const handleAddIdentity = () => {
    if (!newIdentity.number.trim() || !newIdentity.reason.trim()) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    addBlockedIdentity.mutate({
      identityType: newIdentity.type,
      identityNumber: newIdentity.number.trim(),
      reason: newIdentity.reason.trim(),
      notes: newIdentity.notes.trim() || undefined
    }, {
      onSuccess: () => {
        setAddIdentityDialogOpen(false);
        setNewIdentity({ type: "license", number: "", reason: "", notes: "" });
      }
    });
  };

  const handleRemoveIdentity = () => {
    if (removeIdentityDialog) {
      removeBlockedIdentity.mutate(removeIdentityDialog.id, {
        onSuccess: () => {
          setRemoveIdentityDialog(null);
        }
      });
    }
  };

  // Filter blocked customers
  const filteredCustomers = blockedCustomers?.filter(customer =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.license_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.id_number?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  // Filter blocked identities
  const filteredIdentities = blockedIdentities?.filter(identity =>
    identity.identity_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    identity.reason.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const getIdentityTypeBadge = (type: string) => {
    switch (type) {
      case "license":
        return <Badge variant="outline">License</Badge>;
      case "id_card":
        return <Badge variant="outline">ID Card</Badge>;
      case "passport":
        return <Badge variant="outline">Passport</Badge>;
      default:
        return <Badge variant="secondary">Other</Badge>;
    }
  };

  return (
    <div className="space-y-4 md:space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            Blocked Customers
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Manage blocked customers and identity blacklist
          </p>
        </div>
        <Button onClick={() => setAddIdentityDialogOpen(true)} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          Add to Blocklist
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <Card>
          <CardHeader className="p-3 md:p-6 pb-1 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">
              Blocked Customers
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-6 pt-0">
            <div className="text-2xl md:text-3xl font-bold text-destructive">
              {blockedCustomers?.length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-3 md:p-6 pb-1 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">
              Blocked Identities
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-6 pt-0">
            <div className="text-2xl md:text-3xl font-bold text-orange-600">
              {blockedIdentities?.length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-3 md:p-6 pb-1 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">
              Blocked Licenses
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-6 pt-0">
            <div className="text-2xl md:text-3xl font-bold">
              {blockedIdentities?.filter(i => i.identity_type === "license").length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, license, or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="customers" className="space-y-4">
        <TabsList className="w-full sm:w-auto grid grid-cols-2 sm:inline-flex">
          <TabsTrigger value="customers" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm">
            <User className="h-3 w-3 md:h-4 md:w-4" />
            <span><span className="hidden sm:inline">Blocked </span>Customers ({filteredCustomers.length})</span>
          </TabsTrigger>
          <TabsTrigger value="identities" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm">
            <CreditCard className="h-3 w-3 md:h-4 md:w-4" />
            <span><span className="hidden sm:inline">Blocked </span>Identities ({filteredIdentities.length})</span>
          </TabsTrigger>
        </TabsList>

        {/* Blocked Customers Tab */}
        <TabsContent value="customers">
          <Card>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="text-lg md:text-xl">Blocked Customers</CardTitle>
              <CardDescription className="text-xs md:text-sm">
                Customers who are blocked from making new rentals
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0">
              {customersLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : filteredCustomers.length === 0 ? (
                <div className="text-center py-8">
                  <Ban className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                  <p className="text-muted-foreground">No blocked customers found</p>
                </div>
              ) : (
                <>
                  {/* Mobile Card View */}
                  <div className="md:hidden space-y-3">
                    {filteredCustomers.map((customer) => (
                      <div key={customer.id} className="border rounded-lg p-4 space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium">{customer.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {customer.email || customer.phone || "No contact"}
                            </div>
                          </div>
                          <Badge variant="destructive" className="text-xs">Blocked</Badge>
                        </div>
                        {(customer.license_number || customer.id_number) && (
                          <div className="text-sm space-y-1">
                            {customer.license_number && (
                              <div><span className="text-muted-foreground">License:</span> {customer.license_number}</div>
                            )}
                            {customer.id_number && (
                              <div><span className="text-muted-foreground">ID:</span> {customer.id_number}</div>
                            )}
                          </div>
                        )}
                        <div className="text-sm">
                          <span className="text-muted-foreground">Blocked:</span> {customer.blocked_at ? format(new Date(customer.blocked_at), "MMM dd, yyyy") : "-"}
                        </div>
                        {customer.blocked_reason && (
                          <div className="text-sm">
                            <span className="text-muted-foreground">Reason:</span> {customer.blocked_reason}
                          </div>
                        )}
                        <div className="flex gap-2 pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => router.push(`/customers/${customer.id}`)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 text-green-600 border-green-600 hover:bg-green-50"
                            onClick={() => setUnblockCustomerDialog({ open: true, id: customer.id, name: customer.name })}
                            disabled={isLoading}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Unblock
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop Table View */}
                  <div className="hidden md:block rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer</TableHead>
                          <TableHead>License / ID</TableHead>
                          <TableHead>Blocked On</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredCustomers.map((customer) => (
                          <TableRow key={customer.id}>
                            <TableCell>
                              <div>
                                <div className="font-medium">{customer.name}</div>
                                <div className="text-sm text-muted-foreground">
                                  {customer.email || customer.phone || "No contact"}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                {customer.license_number && (
                                  <div className="text-sm">
                                    <span className="text-muted-foreground">License:</span> {customer.license_number}
                                  </div>
                                )}
                                {customer.id_number && (
                                  <div className="text-sm">
                                    <span className="text-muted-foreground">ID:</span> {customer.id_number}
                                  </div>
                                )}
                                {!customer.license_number && !customer.id_number && (
                                  <span className="text-muted-foreground text-sm">-</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {customer.blocked_at ? (
                                format(new Date(customer.blocked_at), "MMM dd, yyyy")
                              ) : (
                                "-"
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm max-w-[200px] truncate block">
                                {customer.blocked_reason || "-"}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => router.push(`/customers/${customer.id}`)}
                                >
                                  <Eye className="h-4 w-4 mr-1" />
                                  View
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setUnblockCustomerDialog({ open: true, id: customer.id, name: customer.name })}
                                  disabled={isLoading}
                                  className="text-green-600 border-green-600 hover:bg-green-50"
                                >
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  Unblock
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Blocked Identities Tab */}
        <TabsContent value="identities">
          <Card>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="text-lg md:text-xl">Blocked Identities</CardTitle>
              <CardDescription className="text-xs md:text-sm">
                License numbers, ID cards, and passports that are blacklisted. Any new customer with these identities will be automatically blocked.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 md:p-6 pt-0">
              {identitiesLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : filteredIdentities.length === 0 ? (
                <div className="text-center py-8">
                  <CreditCard className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                  <p className="text-muted-foreground">No blocked identities found</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setAddIdentityDialogOpen(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add First Identity
                  </Button>
                </div>
              ) : (
                <>
                  {/* Mobile Card View */}
                  <div className="md:hidden space-y-3">
                    {filteredIdentities.map((identity) => (
                      <div key={identity.id} className="border rounded-lg p-4 space-y-3">
                        <div className="flex justify-between items-start">
                          <div className="space-y-1">
                            {getIdentityTypeBadge(identity.identity_type)}
                            <div className="font-mono font-medium text-sm mt-2">
                              {identity.identity_number}
                            </div>
                          </div>
                        </div>
                        <div className="text-sm">
                          <span className="text-muted-foreground">Reason:</span> {identity.reason}
                        </div>
                        {identity.notes && (
                          <div className="text-sm">
                            <span className="text-muted-foreground">Notes:</span> {identity.notes}
                          </div>
                        )}
                        <div className="text-sm">
                          <span className="text-muted-foreground">Added:</span> {format(new Date(identity.created_at), "MMM dd, yyyy")}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full text-destructive border-destructive hover:bg-destructive/10"
                          onClick={() => setRemoveIdentityDialog({ open: true, id: identity.id, number: identity.identity_number })}
                          disabled={isLoading}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Remove from Blocklist
                        </Button>
                      </div>
                    ))}
                  </div>

                  {/* Desktop Table View */}
                  <div className="hidden md:block rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Identity Number</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Notes</TableHead>
                          <TableHead>Added On</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredIdentities.map((identity) => (
                          <TableRow key={identity.id}>
                            <TableCell>
                              {getIdentityTypeBadge(identity.identity_type)}
                            </TableCell>
                            <TableCell className="font-mono font-medium">
                              {identity.identity_number}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm max-w-[200px] truncate block">
                                {identity.reason}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-muted-foreground max-w-[150px] truncate block">
                                {identity.notes || "-"}
                              </span>
                            </TableCell>
                            <TableCell>
                              {format(new Date(identity.created_at), "MMM dd, yyyy")}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRemoveIdentityDialog({ open: true, id: identity.id, number: identity.identity_number })}
                                disabled={isLoading}
                                className="text-destructive border-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                Remove
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Identity Dialog */}
      <Dialog open={addIdentityDialogOpen} onOpenChange={setAddIdentityDialogOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-[425px] max-h-[90vh] flex flex-col rounded-lg mx-auto">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-base">Add to Blocklist
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="identity-type" className="text-sm">Identity Type <span className="text-red-500">*</span></Label>
                <Select
                  value={newIdentity.type}
                  onValueChange={(value: "license" | "id_card" | "passport" | "other") =>
                    setNewIdentity(prev => ({ ...prev, type: value }))
                  }
                >
                  <SelectTrigger id="identity-type" className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="license">Driver's License</SelectItem>
                    <SelectItem value="id_card">ID Card</SelectItem>
                    <SelectItem value="passport">Passport</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="identity-number" className="text-sm">Identity Number <span className="text-red-500">*</span></Label>
                <Input
                  id="identity-number"
                  placeholder="Enter license/ID/passport number"
                  value={newIdentity.number}
                  onChange={(e) => setNewIdentity(prev => ({ ...prev, number: e.target.value }))}
                  className="h-10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="block-reason" className="text-sm">Reason <span className="text-red-500">*</span></Label>
                <Textarea
                  id="block-reason"
                  placeholder="Why is this identity being blocked?"
                  value={newIdentity.reason}
                  onChange={(e) => setNewIdentity(prev => ({ ...prev, reason: e.target.value }))}
                  rows={3}
                  className="resize-none"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="block-notes" className="text-sm">Notes (optional)</Label>
                <Textarea
                  id="block-notes"
                  placeholder="Any additional notes..."
                  value={newIdentity.notes}
                  onChange={(e) => setNewIdentity(prev => ({ ...prev, notes: e.target.value }))}
                  rows={2}
                  className="resize-none"
                />
              </div>
              <Alert className="py-2">
                <AlertTriangle className="h-3 w-3" />
                <AlertDescription className="text-xs">
                  New customers or Veriff verifications with this identity will be blocked.
                </AlertDescription>
              </Alert>
            </div>
          </div>
          <DialogFooter className="pt-4 flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setAddIdentityDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="w-full sm:w-auto"
              onClick={handleAddIdentity}
              disabled={!newIdentity.number.trim() || !newIdentity.reason.trim() || isLoading}
            >
              {isLoading ? "Adding..." : "Add to Blocklist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unblock Customer Confirmation Dialog */}
      <AlertDialog open={!!unblockCustomerDialog} onOpenChange={(open) => !open && setUnblockCustomerDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Unblock Customer
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to unblock <strong>{unblockCustomerDialog?.name}</strong>?
              They will be able to make new rentals again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnblockCustomer}
              className="bg-green-600 hover:bg-green-700"
            >
              {isLoading ? "Unblocking..." : "Unblock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove Identity Confirmation Dialog */}
      <AlertDialog open={!!removeIdentityDialog} onOpenChange={(open) => !open && setRemoveIdentityDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Remove from Blocklist
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{removeIdentityDialog?.number}</strong> from the blocklist?
              Customers with this identity will no longer be blocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveIdentity}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isLoading ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BlockedCustomers;
