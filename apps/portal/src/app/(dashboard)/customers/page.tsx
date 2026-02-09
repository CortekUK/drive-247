"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Users, Plus, Mail, Phone, Eye, Edit, Search, Shield, ArrowUpDown, ArrowUp, ArrowDown, X, MoreHorizontal, Ban, Trash2, XCircle, UserCheck, Link2 } from "lucide-react";
import { CustomerFormModal } from "@/components/customers/customer-form-modal";
import { GenerateInviteDialog } from "@/components/customers/generate-invite-dialog";
import { CustomerBalanceChip } from "@/components/customers/customer-balance-chip";
import { CustomerSummaryCards } from "@/components/customers/customer-summary-cards";
import { RejectCustomerDialog } from "@/components/customers/reject-customer-dialog";
import { RejectedCustomerDialog } from "@/components/customers/rejected-customer-dialog";
import { useDebounce } from "@/hooks/use-debounce";
import { useCustomerBlockingActions } from "@/hooks/use-customer-blocking";
import { useCustomerStatusActions } from "@/hooks/use-customer-status-actions";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: string;
  customer_type?: "Individual" | "Company";
  status: string;
  whatsapp_opt_in: boolean;
  high_switcher?: boolean;
  license_number?: string;
  id_number?: string;
  is_blocked?: boolean;
  nok_full_name?: string;
  nok_relationship?: string;
  nok_phone?: string;
  nok_email?: string;
  nok_address?: string;
  rejection_reason?: string;
  rejected_at?: string;
  rejected_by?: string;
  created_at?: string;
  user_type?: "Authenticated" | "Guest";
}

type SortField = 'name' | 'status' | 'type' | 'balance';
type SortOrder = 'asc' | 'desc';

const CustomersList = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();

  // State from URL params
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all');
  const [userTypeFilter, setUserTypeFilter] = useState(searchParams.get('userType') || 'all');
  const [sortField, setSortField] = useState<SortField | null>((searchParams.get('sortBy') as SortField) || null);
  const [sortOrder, setSortOrder] = useState<SortOrder>((searchParams.get('sortOrder') as SortOrder) || 'asc');
  const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page') || '1'));
  const [pageSize, setPageSize] = useState(parseInt(searchParams.get('pageSize') || '25'));

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // Block/Delete dialog state
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [blockReason, setBlockReason] = useState("");

  const { blockCustomer, addBlockedIdentity, isLoading: blockingLoading } = useCustomerBlockingActions();
  const { rejectCustomer, approveCustomer, isLoading: statusActionLoading } = useCustomerStatusActions();

  // Reject/Approve dialog state
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectedDetailsDialogOpen, setRejectedDetailsDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  // Debounce search term
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearchTerm) params.set('search', debouncedSearchTerm);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (userTypeFilter !== 'all') params.set('userType', userTypeFilter);
    if (sortField) params.set('sortBy', sortField);
    if (sortOrder !== 'asc') params.set('sortOrder', sortOrder);
    if (currentPage !== 1) params.set('page', currentPage.toString());
    if (pageSize !== 25) params.set('pageSize', pageSize.toString());

    router.push(`?${params.toString()}`);
  }, [debouncedSearchTerm, statusFilter, userTypeFilter, sortField, sortOrder, currentPage, pageSize, router]);

  // Fetch customers
  const { data: customers, isLoading, refetch: refetchCustomers } = useQuery({
    queryKey: ["customers-list", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("customers")
        .select("*")
        .order("created_at", { ascending: false });

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Customers fetch error:", error);
        throw error;
      }

      // Fetch customer_users to determine authenticated vs guest
      const customerIds = data?.map(c => c.id) || [];
      if (customerIds.length > 0) {
        const { data: customerUsers } = await supabase
          .from("customer_users")
          .select("customer_id")
          .in("customer_id", customerIds);

        const authenticatedCustomerIds = new Set(customerUsers?.map(cu => cu.customer_id) || []);

        // Add user_type to each customer
        return data?.map(customer => ({
          ...customer,
          user_type: authenticatedCustomerIds.has(customer.id) ? "Authenticated" : "Guest"
        })) as Customer[];
      }

      return data?.map(customer => ({
        ...customer,
        user_type: "Guest" as const
      })) as Customer[];
    },
    enabled: !!tenant,
  });

  // Fetch customer balances using remaining_amount from ledger entries
  const customerBalanceQueries = useQuery({
    queryKey: ["customer-balances-enhanced"],
    queryFn: async () => {
      if (!customers?.length) return {};

      const balanceMap: Record<string, any> = {};

      // Get all ledger entries for all customers at once for efficiency
      const customerIds = customers.map(c => c.id);
      let ledgerQuery = supabase
        .from("ledger_entries")
        .select("customer_id, type, amount, remaining_amount, due_date, category")
        .in("customer_id", customerIds);

      if (tenant?.id) {
        ledgerQuery = ledgerQuery.eq("tenant_id", tenant.id);
      }

      const { data: allEntries, error } = await ledgerQuery;

      if (error) {
        console.error('Error fetching ledger entries:', error);
        return {};
      }

      // Group entries by customer
      const entriesByCustomer: Record<string, typeof allEntries> = {};
      allEntries?.forEach(entry => {
        if (!entriesByCustomer[entry.customer_id]) {
          entriesByCustomer[entry.customer_id] = [];
        }
        entriesByCustomer[entry.customer_id].push(entry);
      });

      // Calculate balance for each customer
      for (const customer of customers) {
        const entries = entriesByCustomer[customer.id] || [];

        let totalCharges = 0;
        let totalPayments = 0;
        let balance = 0; // Outstanding = sum of remaining_amount on due charges

        entries.forEach(entry => {
          if (entry.type === 'Charge') {
            totalCharges += entry.amount;

            // For rental charges, only include remaining if currently due
            if (entry.category === 'Rental' && entry.due_date && new Date(entry.due_date) > new Date()) {
              return; // Future charge - don't add to balance
            }
            balance += (entry.remaining_amount || 0);
          } else if (entry.type === 'Payment') {
            totalPayments += Math.abs(entry.amount);
          }
        });

        // Determine status
        let status: 'In Credit' | 'Settled' | 'In Debt';
        if (Math.abs(balance) < 0.01) {
          status = 'Settled';
        } else if (balance > 0) {
          status = 'In Debt';
        } else {
          status = 'In Credit';
        }

        balanceMap[customer.id] = {
          balance: Math.abs(balance),
          status,
          totalCharges,
          totalPayments
        };
      }

      return balanceMap;
    },
    enabled: !!customers?.length,
  });

  const customerBalances = customerBalanceQueries.data || {};

  // Filter and sort customers
  const filteredAndSortedCustomers = useMemo(() => {
    if (!customers) return [];

    let filtered = customers.filter(customer => {
      // Exclude blocked customers (they appear in Blocked Customers page)
      if (customer.is_blocked === true) return false;

      // Search filter
      if (debouncedSearchTerm) {
        const search = debouncedSearchTerm.toLowerCase();
        const matchesSearch = (
          customer.name.toLowerCase().includes(search) ||
          customer.email?.toLowerCase().includes(search) ||
          customer.phone?.toLowerCase().includes(search)
        );
        if (!matchesSearch) return false;
      }

      // Status filter
      if (statusFilter !== "all") {
        if (customer.status !== statusFilter) return false;
      }

      // User type filter (Guest/Authenticated)
      if (userTypeFilter !== "all") {
        if (customer.user_type !== userTypeFilter) return false;
      }

      return true;
    });

    // Only apply client-side sorting if user has explicitly selected a sort field
    if (sortField) {
      filtered.sort((a, b) => {
        let aValue, bValue;

        switch (sortField) {
          case 'name':
            aValue = a.name.toLowerCase();
            bValue = b.name.toLowerCase();
            break;
          case 'status':
            aValue = a.status;
            bValue = b.status;
            break;
          case 'type':
            aValue = a.user_type || 'Guest';
            bValue = b.user_type || 'Guest';
            break;
          case 'balance':
            aValue = customerBalances[a.id]?.balance || 0;
            bValue = customerBalances[b.id]?.balance || 0;
            break;
          default:
            aValue = a.name.toLowerCase();
            bValue = b.name.toLowerCase();
        }

        if (sortOrder === 'asc') {
          return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
        } else {
          return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
        }
      });
    }

    return filtered;
  }, [customers, debouncedSearchTerm, statusFilter, userTypeFilter, sortField, sortOrder, customerBalances]);

  // Pagination
  const totalCustomers = filteredAndSortedCustomers.length;
  const totalPages = Math.ceil(totalCustomers / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalCustomers);
  const paginatedCustomers = filteredAndSortedCustomers.slice(startIndex, endIndex);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchTerm, statusFilter, userTypeFilter]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        handleAddCustomer();
      }
      if (e.key === 'Escape' && isModalOpen) {
        setIsModalOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  const handleAddCustomer = () => {
    setEditingCustomer(null);
    setIsModalOpen(true);
  };

  const handleEditCustomer = (customer: Customer) => {
    setEditingCustomer(customer);
    setIsModalOpen(true);
  };

  const handleBlockClick = (customer: Customer) => {
    setSelectedCustomer(customer);
    setBlockReason("");
    setBlockDialogOpen(true);
  };

  const handleBlockCustomer = async () => {
    if (!selectedCustomer || !blockReason.trim()) return;

    // Determine what to block: license > id_number > email
    const identityToBlock = selectedCustomer.license_number || selectedCustomer.id_number || selectedCustomer.email;
    const identityType = selectedCustomer.license_number ? 'license' :
                         selectedCustomer.id_number ? 'id_card' : 'email';

    try {
      // First block the customer
      const { error: blockError } = await (supabase as any)
        .from('customers')
        .update({
          is_blocked: true,
          blocked_at: new Date().toISOString(),
          blocked_reason: blockReason
        })
        .eq('id', selectedCustomer.id);

      if (blockError) throw blockError;

      // Then add to blocked identities list
      if (identityToBlock) {
        await addBlockedIdentity.mutateAsync({
          identityType: identityType as 'license' | 'id_card' | 'passport' | 'other',
          identityNumber: identityToBlock,
          reason: blockReason,
          notes: `Blocked from customer: ${selectedCustomer.name}`
        });
      }

      toast.success(`${selectedCustomer.name} has been blocked`);
      setBlockDialogOpen(false);
      setSelectedCustomer(null);
      setBlockReason("");
      refetchCustomers();
      queryClient.invalidateQueries({ queryKey: ['blocked-customers'] });
      queryClient.invalidateQueries({ queryKey: ['blocked-identities'] });
    } catch (error: any) {
      toast.error(error.message || 'Failed to block customer');
    }
  };

  const handleDeleteClick = (customer: Customer) => {
    setSelectedCustomer(customer);
    setDeleteDialogOpen(true);
  };

  const handleDeleteCustomer = async () => {
    if (!selectedCustomer) return;

    try {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', selectedCustomer.id);

      if (error) throw error;

      // Audit log for customer deletion
      logAction({
        action: "customer_deleted",
        entityType: "customer",
        entityId: selectedCustomer.id,
        details: { customer_name: selectedCustomer.name }
      });

      toast.success(`${selectedCustomer.name} has been deleted`);
      setDeleteDialogOpen(false);
      setSelectedCustomer(null);
      refetchCustomers();
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete customer. They may have associated rentals or payments.');
    }
  };

  const handleRejectClick = (customer: Customer) => {
    setSelectedCustomer(customer);
    setRejectDialogOpen(true);
  };

  const handleRejectConfirm = async (reason: string) => {
    if (!selectedCustomer) return;

    await rejectCustomer.mutateAsync({
      customerId: selectedCustomer.id,
      reason,
    });

    setRejectDialogOpen(false);
    setSelectedCustomer(null);
    refetchCustomers();
  };

  const handleViewRejectedDetails = (customer: Customer) => {
    setSelectedCustomer(customer);
    setRejectedDetailsDialogOpen(true);
  };

  const handleApproveCustomer = async (customerToApprove?: Customer) => {
    const customer = customerToApprove || selectedCustomer;
    if (!customer) return;

    await approveCustomer.mutateAsync({
      customerId: customer.id,
    });

    setRejectedDetailsDialogOpen(false);
    setSelectedCustomer(null);
    refetchCustomers();
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setUserTypeFilter('all');
    setSortField(null);
    setSortOrder('asc');
    setCurrentPage(1);
    toast.success('Filters cleared');
  };

  const hasActiveFilters = debouncedSearchTerm || statusFilter !== 'all' || userTypeFilter !== 'all';

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-4 w-4 text-muted-foreground" />;
    return sortOrder === 'asc' ? <ArrowUp className="h-4 w-4 text-primary" /> : <ArrowDown className="h-4 w-4 text-primary" />;
  };

  const hasNextOfKin = (customer: Customer) => {
    return !!(customer.nok_full_name || customer.nok_relationship || customer.nok_phone || customer.nok_email);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Customers</h1>
          <p className="text-muted-foreground">View and manage all customers with contact information and account balances</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => setInviteDialogOpen(true)}>
            <Link2 className="h-4 w-4 mr-2" />
            Invite Link
          </Button>
          <Button className="bg-gradient-primary w-full sm:w-auto" onClick={handleAddCustomer}>
            <Plus className="h-4 w-4 mr-2" />
            Add Customer
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {customers && <CustomerSummaryCards customers={customers} />}

      {/* Search and Filters */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative md:col-span-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Inactive">Inactive</SelectItem>
              <SelectItem value="Rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>

          <Select value={userTypeFilter} onValueChange={setUserTypeFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All Users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              <SelectItem value="Authenticated">Authenticated</SelectItem>
              <SelectItem value="Guest">Guest</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear Filters
          </Button>
        )}
      </div>

      {/* Table */}
      {paginatedCustomers.length > 0 ? (
        <>
        <Card>
          <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center gap-2">
                        Name
                        <SortIcon field="name" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort('type')}
                    >
                      <div className="flex items-center gap-2">
                        Type
                        <SortIcon field="type" />
                      </div>
                    </TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center gap-2">
                        Status
                        <SortIcon field="status" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort('balance')}
                    >
                      <div className="flex items-center gap-2">
                        Balance
                        <SortIcon field="balance" />
                      </div>
                    </TableHead>
                    <TableHead className="w-12">View</TableHead>
                    <TableHead className="text-right w-12">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedCustomers.map((customer) => {
                    const balanceData = customerBalances[customer.id];

                    return (
                      <TableRow key={customer.id} className="table-row">
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => router.push(`/customers/${customer.id}`)}
                              className="font-bold text-foreground hover:underline hover:opacity-80 text-left"
                            >
                              {customer.name}
                            </button>
                            <div className="flex items-center gap-1">
                              {hasNextOfKin(customer) && (
                                <div title="Emergency contact on file">
                                  <Shield className="h-3 w-3 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              customer.user_type === 'Authenticated'
                                ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
                                : 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
                            }
                          >
                            {customer.user_type || 'Guest'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1 max-w-[200px]">
                            {customer.email && (
                              <div className="flex items-center gap-1 text-sm text-muted-foreground truncate">
                                <Mail className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate" title={customer.email}>{customer.email}</span>
                              </div>
                            )}
                            {customer.phone && (
                              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                <Phone className="h-3 w-3 flex-shrink-0" />
                                <span>{customer.phone}</span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={customer.status === 'Active' ? 'default' : 'secondary'}
                            className={
                              customer.status === 'Active'
                                ? 'bg-pink-100 text-pink-800'
                                : customer.status === 'Rejected'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                  : 'bg-gray-100 text-gray-800'
                            }
                          >
                            {customer.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {balanceData ? (
                            <CustomerBalanceChip
                              balance={balanceData.balance}
                              status={balanceData.status}
                              totalCharges={balanceData.totalCharges}
                              totalPayments={balanceData.totalPayments}
                              size="small"
                            />
                          ) : (
                            <CustomerBalanceChip balance={0} status="Settled" size="small" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push(`/customers/${customer.id}`)}
                            aria-label={`View ${customer.name} details`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {customer.status === 'Rejected' ? (
                                  <>
                                    <DropdownMenuItem
                                      onClick={() => handleViewRejectedDetails(customer)}
                                    >
                                      <Eye className="h-4 w-4 mr-2" />
                                      View Details
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleEditCustomer(customer)}>
                                      <Edit className="h-4 w-4 mr-2" />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => handleApproveCustomer(customer)}
                                      className="text-green-600 focus:text-green-600"
                                    >
                                      <UserCheck className="h-4 w-4 mr-2" />
                                      Approve Customer
                                    </DropdownMenuItem>
                                  </>
                                ) : (
                                  <>
                                    <DropdownMenuItem onClick={() => handleEditCustomer(customer)}>
                                      <Edit className="h-4 w-4 mr-2" />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => handleBlockClick(customer)}
                                      className="text-orange-600 focus:text-orange-600"
                                    >
                                      <Ban className="h-4 w-4 mr-2" />
                                      Block Customer
                                    </DropdownMenuItem>
                                  </>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleDeleteClick(customer)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
          </CardContent>
        </Card>

        {/* Pagination */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Showing {startIndex + 1}-{endIndex} of {totalCustomers} customers
          </p>
          <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap justify-center sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              Page {currentPage} of {totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages || totalPages <= 1}
            >
              Next
            </Button>
          </div>
        </div>
        </>
      ) : (
        <div className="text-center py-12">
          <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">
            {hasActiveFilters ? 'No customers match your filters' : 'No customers yet'}
          </h3>
          <p className="text-muted-foreground mb-4">
            {hasActiveFilters
              ? 'Try adjusting your search or filter criteria'
              : 'Add your first customer to get started'
            }
          </p>
          {hasActiveFilters ? (
            <Button variant="outline" onClick={clearFilters}>
              <X className="h-4 w-4 mr-2" />
              Clear Filters
            </Button>
          ) : (
            <Button onClick={handleAddCustomer}>
              <Plus className="h-4 w-4 mr-2" />
              Add Customer
            </Button>
          )}
        </div>
      )}

      <CustomerFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        customer={editingCustomer}
      />

      {/* Block Customer Dialog */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <Ban className="h-5 w-5" />
              Block Customer
            </DialogTitle>
            <DialogDescription>
              {selectedCustomer && (
                <>
                  Block <strong>{selectedCustomer.name}</strong> from making new rentals.
                  {selectedCustomer.license_number && (
                    <span className="block mt-1 text-sm">License: {selectedCustomer.license_number} will be added to blocklist</span>
                  )}
                  {!selectedCustomer.license_number && selectedCustomer.id_number && (
                    <span className="block mt-1 text-sm">ID: {selectedCustomer.id_number} will be added to blocklist</span>
                  )}
                  {!selectedCustomer.license_number && !selectedCustomer.id_number && selectedCustomer.email && (
                    <span className="block mt-1 text-sm">Email: {selectedCustomer.email} will be added to blocklist</span>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="block-reason">Reason for blocking <span className="text-red-500">*</span></Label>
              <Textarea
                id="block-reason"
                placeholder="Enter the reason for blocking this customer..."
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBlockCustomer}
              disabled={!blockReason.trim() || blockingLoading}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {blockingLoading ? "Blocking..." : "Block Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Customer Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Customer
            </DialogTitle>
            <DialogDescription>
              {selectedCustomer && (
                <>
                  Are you sure you want to delete <strong>{selectedCustomer.name}</strong>?
                  <span className="block mt-2 text-destructive font-medium">
                    This action cannot be undone. The customer and all their data will be permanently removed.
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCustomer}
            >
              Delete Customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Customer Dialog */}
      <RejectCustomerDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        customer={selectedCustomer}
        onConfirm={handleRejectConfirm}
        isLoading={statusActionLoading}
      />

      {/* Rejected Customer Details Dialog */}
      <RejectedCustomerDialog
        open={rejectedDetailsDialogOpen}
        onOpenChange={setRejectedDetailsDialogOpen}
        customer={selectedCustomer}
        onApprove={handleApproveCustomer}
        isLoading={statusActionLoading}
      />

      {/* Generate Invite Link Dialog */}
      <GenerateInviteDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
      />
    </div>
  );
};

export default CustomersList;
