"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
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
import { Ban, Plus, Trash2, User, CreditCard, Search, CheckCircle, AlertTriangle, Eye, Check } from "lucide-react";
import { cn } from "@/lib/utils";
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
  const [customersPage, setCustomersPage] = useState(1);
  const [identitiesPage, setIdentitiesPage] = useState(1);
  const pageSize = 25;
  const [addIdentityDialogOpen, setAddIdentityDialogOpen] = useState(false);
  const [newIdentity, setNewIdentity] = useState({
    type: "license" as "license" | "id_card" | "passport" | "other",
    number: "",
    name: "",
    reason: "",
    notes: ""
  });
  const [unblockCustomerDialog, setUnblockCustomerDialog] = useState<{ open: boolean; id: string; name: string } | null>(null);
  const [removeIdentityDialog, setRemoveIdentityDialog] = useState<{ open: boolean; id: string; number: string } | null>(null);
  const [customerComboboxOpen, setCustomerComboboxOpen] = useState(false);

  const { unblockCustomer, addBlockedIdentity, removeBlockedIdentity, isLoading } = useCustomerBlockingActions();

  // Fetch all customers for combobox (with license/ID for pre-fill)
  const { data: allCustomers = [] } = useQuery({
    queryKey: ["all-customers-list", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("customers")
        .select("id, name, license_number, id_number")
        .order("name");

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as { id: string; name: string; license_number: string | null; id_number: string | null }[];
    },
    enabled: !!tenant,
  });

  // Handle customer selection from combobox
  const handleCustomerSelect = (customerId: string) => {
    const customer = allCustomers.find(c => c.id === customerId);
    if (customer) {
      // Pre-fill name and identity number if available
      const identityNumber = customer.license_number || customer.id_number || "";
      const identityType = customer.license_number ? "license" : customer.id_number ? "id_card" : newIdentity.type;

      setNewIdentity(prev => ({
        ...prev,
        name: customer.name,
        number: identityNumber,
        type: identityType
      }));
    }
    setCustomerComboboxOpen(false);
  };
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
      notes: newIdentity.notes.trim() || undefined,
      customerName: newIdentity.name.trim() || undefined
    }, {
      onSuccess: () => {
        setAddIdentityDialogOpen(false);
        setNewIdentity({ type: "license", number: "", name: "", reason: "", notes: "" });
        setCustomerComboboxOpen(false);
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
    identity.reason.toLowerCase().includes(searchTerm.toLowerCase()) ||
    identity.customer_name?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  // Pagination for customers
  const totalCustomersCount = filteredCustomers.length;
  const totalCustomersPages = Math.ceil(totalCustomersCount / pageSize);
  const customersStartIndex = (customersPage - 1) * pageSize;
  const customersEndIndex = Math.min(customersStartIndex + pageSize, totalCustomersCount);
  const paginatedCustomers = filteredCustomers.slice(customersStartIndex, customersEndIndex);

  // Pagination for identities
  const totalIdentitiesCount = filteredIdentities.length;
  const totalIdentitiesPages = Math.ceil(totalIdentitiesCount / pageSize);
  const identitiesStartIndex = (identitiesPage - 1) * pageSize;
  const identitiesEndIndex = Math.min(identitiesStartIndex + pageSize, totalIdentitiesCount);
  const paginatedIdentities = filteredIdentities.slice(identitiesStartIndex, identitiesEndIndex);

  // Reset pages when search changes
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCustomersPage(1);
    setIdentitiesPage(1);
  };

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
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        <Card className="p-4 md:p-6">
          <div className="text-2xl md:text-3xl font-bold text-destructive">
            {blockedCustomers?.length || 0}
          </div>
          <div className="text-xs md:text-sm text-muted-foreground mt-1">
            Blocked Customers
          </div>
        </Card>
        <Card className="p-4 md:p-6">
          <div className="text-2xl md:text-3xl font-bold text-orange-500">
            {blockedIdentities?.length || 0}
          </div>
          <div className="text-xs md:text-sm text-muted-foreground mt-1">
            Blocked Identities
          </div>
        </Card>
        <Card className="p-4 md:p-6">
          <div className="text-2xl md:text-3xl font-bold">
            {blockedIdentities?.filter(i => i.identity_type === "license").length || 0}
          </div>
          <div className="text-xs md:text-sm text-muted-foreground mt-1">
            Blocked Licenses
          </div>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, license, or ID..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
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
        <TabsContent value="customers" className="space-y-4">
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
                    {paginatedCustomers.map((customer) => (
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
              <Card className="hidden md:block">
                <CardContent className="p-0">
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
                      {paginatedCustomers.map((customer) => (
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
                </CardContent>
              </Card>

              {/* Pagination */}
              {totalCustomersPages > 1 && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Showing {customersStartIndex + 1}-{customersEndIndex} of {totalCustomersCount} customers
                  </p>
                  <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap justify-center sm:justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCustomersPage(Math.max(1, customersPage - 1))}
                      disabled={customersPage === 1}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      Page {customersPage} of {totalCustomersPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCustomersPage(Math.min(totalCustomersPages, customersPage + 1))}
                      disabled={customersPage === totalCustomersPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* Blocked Identities Tab */}
        <TabsContent value="identities" className="space-y-4">
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
                    {paginatedIdentities.map((identity) => (
                      <div key={identity.id} className="border rounded-lg p-4 space-y-3">
                        <div className="flex justify-between items-start">
                          <div className="space-y-1">
                            {getIdentityTypeBadge(identity.identity_type)}
                            <div className="font-mono font-medium text-sm mt-2">
                              {identity.identity_number}
                            </div>
                          </div>
                        </div>
                        {identity.customer_name && (
                          <div className="text-sm">
                            <span className="text-muted-foreground">Customer:</span> {identity.customer_name}
                          </div>
                        )}
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
              <Card className="hidden md:block">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Identity Number</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead>Added On</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedIdentities.map((identity) => (
                        <TableRow key={identity.id}>
                          <TableCell>
                            {getIdentityTypeBadge(identity.identity_type)}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm font-medium">
                              {identity.customer_name || "-"}
                            </span>
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
                </CardContent>
              </Card>

              {/* Pagination for Identities */}
              {totalIdentitiesPages > 1 && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Showing {identitiesStartIndex + 1}-{identitiesEndIndex} of {totalIdentitiesCount} identities
                  </p>
                  <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap justify-center sm:justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIdentitiesPage(Math.max(1, identitiesPage - 1))}
                      disabled={identitiesPage === 1}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      Page {identitiesPage} of {totalIdentitiesPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIdentitiesPage(Math.min(totalIdentitiesPages, identitiesPage + 1))}
                      disabled={identitiesPage === totalIdentitiesPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Identity Dialog */}
      <Dialog open={addIdentityDialogOpen} onOpenChange={(open) => {
        setAddIdentityDialogOpen(open);
        if (!open) {
          setCustomerComboboxOpen(false);
        }
      }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-[425px] max-h-[90vh] flex flex-col rounded-lg mx-auto p-4">
          <DialogHeader className="pb-1">
            <DialogTitle className="text-base">Add to Blocklist</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="customer-name" className="text-sm">Customer Name</Label>
                <div className="relative">
                  <div className="flex items-center border rounded-md px-3 h-9">
                    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                    <input
                      placeholder="Search or type customer name..."
                      value={newIdentity.name}
                      onChange={(e) => {
                        setNewIdentity(prev => ({ ...prev, name: e.target.value }));
                        setCustomerComboboxOpen(true);
                      }}
                      onFocus={() => setCustomerComboboxOpen(true)}
                      className="flex h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                    {newIdentity.name && (
                      <button
                        type="button"
                        onClick={() => {
                          setNewIdentity(prev => ({ ...prev, name: "", number: "" }));
                          setCustomerComboboxOpen(false);
                        }}
                        className="ml-2 text-muted-foreground hover:text-foreground"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {customerComboboxOpen && allCustomers.filter(customer =>
                    customer.name.toLowerCase().includes(newIdentity.name.toLowerCase())
                  ).length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md">
                      <div className="max-h-[200px] overflow-y-auto p-1">
                        {allCustomers
                          .filter(customer =>
                            customer.name.toLowerCase().includes(newIdentity.name.toLowerCase())
                          )
                          .slice(0, 10)
                          .map((customer) => (
                            <div
                              key={customer.id}
                              className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleCustomerSelect(customer.id);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  newIdentity.name === customer.name ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex flex-col">
                                <span>{customer.name}</span>
                                {(customer.license_number || customer.id_number) && (
                                  <span className="text-xs text-muted-foreground">
                                    {customer.license_number ? `License: ${customer.license_number}` : `ID: ${customer.id_number}`}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="identity-type" className="text-sm">Identity Type <span className="text-red-500">*</span></Label>
                <Select
                  value={newIdentity.type}
                  onValueChange={(value: "license" | "id_card" | "passport" | "other") =>
                    setNewIdentity(prev => ({ ...prev, type: value }))
                  }
                >
                  <SelectTrigger id="identity-type" className="h-9">
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
              <div className="grid gap-1.5">
                <Label htmlFor="identity-number" className="text-sm">Identity Number <span className="text-red-500">*</span></Label>
                <Input
                  id="identity-number"
                  placeholder="Enter license/ID/passport number"
                  value={newIdentity.number}
                  onChange={(e) => setNewIdentity(prev => ({ ...prev, number: e.target.value }))}
                  className="h-9"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="block-reason" className="text-sm">Reason <span className="text-red-500">*</span></Label>
                <Textarea
                  id="block-reason"
                  placeholder="Why is this identity being blocked?"
                  value={newIdentity.reason}
                  onChange={(e) => setNewIdentity(prev => ({ ...prev, reason: e.target.value }))}
                  rows={2}
                  className="resize-none"
                />
              </div>
              <div className="grid gap-1.5">
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
          <DialogFooter className="pt-3 flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => {
              setAddIdentityDialogOpen(false);
              setCustomerComboboxOpen(false);
            }}>
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
