"use client";

// Main Insurance Management Page - Complete Implementation
import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MoreVertical,
  Eye,
  Edit,
  Upload,
  Ban,
  Trash2,
  FileText,
  Plus,
  ArrowUpDown,
  ExternalLink
} from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// Components
import { InsuranceKPIs } from "@/components/insurance/insurance-kpis";
import { InsuranceFilters } from "@/components/insurance/insurance-filters";
import { InsurancePolicyStatusChip } from "@/components/insurance/insurance-policy-status-chip";
import { InsurancePolicyDialog } from "@/components/insurance/insurance-policy-dialog";
import { InsurancePolicyDrawer } from "@/components/insurance/insurance-policy-drawer";
import { CustomerSelectionDialog } from "@/components/insurance/customer-selection-dialog";
import { DocumentUploadDialog } from "@/components/insurance/document-upload-dialog";

// Hooks & Utils
import {
  useInsuranceData,
  type InsuranceFilters as FiltersType,
  type InsurancePolicy
} from "@/hooks/use-insurance-data";
import { exportInsuranceToCSV } from "@/lib/csv-export";
import { type InsurancePolicyStatus } from "@/lib/insurance-utils";
import { useTenant } from "@/contexts/TenantContext";
import { isInsuranceExemptTenant } from "@/config/tenant-config";

type SortField = "customer" | "vehicle" | "policy_number" | "provider" | "start_date" | "expiry_date" | "status" | "docs_count";
type SortDirection = "asc" | "desc";

export default function InsuranceListEnhanced() {
  // State
  const [filters, setFilters] = useState<FiltersType>({
    search: "",
    status: "all",
    dateRange: { from: undefined, to: undefined }
  });
  const [sortField, setSortField] = useState<SortField>("expiry_date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Dialog states
  const [customerSelectOpen, setCustomerSelectOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  // Selected items
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");

  // Data fetching
  const { policies, stats, isLoading, error } = useInsuranceData(filters);
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const router = useRouter();

  // Redirect insurance-exempt tenants (like Kedic Services) away from this page
  useEffect(() => {
    if (isInsuranceExemptTenant(tenant?.id)) {
      toast.error("Insurance management is not available for this tenant");
      router.replace("/");
    }
  }, [tenant?.id, router]);

  // Don't render content for exempt tenants
  if (isInsuranceExemptTenant(tenant?.id)) {
    return null;
  }

  // Mutations
  const recalculateStatusMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('recalculate_insurance_status');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["insurance-policies"] });
      if (data && data.length > 0) {
        const result = data[0];
        toast.success(
          `Status recalculation complete. Updated ${result.updated_policies} policies.`
        );
      }
    },
    onError: () => {
      toast.error("Failed to recalculate policy statuses");
    },
  });

  const deactivatePolicyMutation = useMutation({
    mutationFn: async (policyId: string) => {
      let query = supabase
        .from("insurance_policies")
        .update({ status: "Inactive", updated_at: new Date().toISOString() })
        .eq("id", policyId);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-policies"] });
      toast.success("Policy deactivated successfully");
    },
    onError: () => {
      toast.error("Failed to deactivate policy");
    },
  });

  // Handlers
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleExportCSV = useCallback(() => {
    exportInsuranceToCSV(sortedPolicies, `insurance-policies-${format(new Date(), "yyyy-MM-dd")}.csv`);
    toast.success("Insurance policies exported to CSV");
  }, [policies]);

  const handleViewPolicy = (policy: InsurancePolicy) => {
    setSelectedPolicyId(policy.id);
    setDrawerOpen(true);
  };

  const handleEditPolicy = (policy: InsurancePolicy) => {
    setSelectedPolicyId(policy.id);
    setSelectedCustomerId(policy.customer_id);
    setEditDialogOpen(true);
  };

  const handleAddPolicy = () => {
    setSelectedPolicyId(null);
    setSelectedCustomerId("");
    setCustomerSelectOpen(true);
  };

  const handleCustomerSelected = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setAddDialogOpen(true);
  };

  const handleUploadDocument = (policy: InsurancePolicy) => {
    setSelectedPolicyId(policy.id);
    setUploadDialogOpen(true);
  };

  const handleDeactivatePolicy = (policyId: string) => {
    deactivatePolicyMutation.mutate(policyId);
  };

  // Sort policies
  const sortedPolicies = [...policies].sort((a, b) => {
    let aVal, bVal;

    switch (sortField) {
      case "customer":
        aVal = a.customers.name.toLowerCase();
        bVal = b.customers.name.toLowerCase();
        break;
      case "vehicle":
        aVal = a.vehicles?.reg?.toLowerCase() || "";
        bVal = b.vehicles?.reg?.toLowerCase() || "";
        break;
      case "policy_number":
        aVal = a.policy_number.toLowerCase();
        bVal = b.policy_number.toLowerCase();
        break;
      case "provider":
        aVal = (a.provider || "").toLowerCase();
        bVal = (b.provider || "").toLowerCase();
        break;
      case "start_date":
        aVal = new Date(a.start_date).getTime();
        bVal = new Date(b.start_date).getTime();
        break;
      case "expiry_date":
        aVal = new Date(a.expiry_date).getTime();
        bVal = new Date(b.expiry_date).getTime();
        break;
      case "status":
        aVal = a.status.toLowerCase();
        bVal = b.status.toLowerCase();
        break;
      case "docs_count":
        aVal = a.docs_count;
        bVal = b.docs_count;
        break;
      default:
        return 0;
    }

    if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  // Check if policy is expiring within 7 days for visual indicator
  const isPolicyUrgent = (expiryDate: string) => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 7 && daysUntilExpiry >= 0;
  };

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-8 text-destructive">
          Error loading insurance policies: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Insurance Management</h1>
          <p className="text-muted-foreground">
            Comprehensive compliance tracking for customer insurance policies
          </p>
        </div>
        <Button onClick={handleAddPolicy} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Policy
        </Button>
      </div>

      {/* KPIs */}
      <InsuranceKPIs stats={stats} isFiltered={!!(filters.search || filters.status !== "all" || filters.dateRange.from || filters.dateRange.to)} />

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Insurance Policies</CardTitle>
          <CardDescription>
            Manage and track all customer insurance policies with compliance monitoring
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InsuranceFilters
            filters={filters}
            onFiltersChange={setFilters}
            onExportCSV={handleExportCSV}
            onRecalculateStatus={() => recalculateStatusMutation.mutate()}
            isRecalculating={recalculateStatusMutation.isPending}
          />
        </CardContent>
      </Card>

      {/* Policies Table */}
      <Card>
        <CardContent className="p-0">
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Button
                      variant="ghost"
                      className="h-8 p-0 font-medium"
                      onClick={() => handleSort("customer")}
                    >
                      Customer
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      className="h-8 p-0 font-medium"
                      onClick={() => handleSort("vehicle")}
                    >
                      Vehicle
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      className="h-8 p-0 font-medium"
                      onClick={() => handleSort("policy_number")}
                    >
                      Policy Number
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      className="h-8 p-0 font-medium"
                      onClick={() => handleSort("provider")}
                    >
                      Provider
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      className="h-8 p-0 font-medium"
                      onClick={() => handleSort("start_date")}
                    >
                      Start Date
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      className="h-8 p-0 font-medium"
                      onClick={() => handleSort("expiry_date")}
                    >
                      Expiry Date
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      className="h-8 p-0 font-medium"
                      onClick={() => handleSort("status")}
                    >
                      Status
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">
                    <Button
                      variant="ghost"
                      className="h-8 p-0 font-medium"
                      onClick={() => handleSort("docs_count")}
                    >
                      Docs
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    </TableRow>
                  ))
                ) : sortedPolicies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12">
                      <div className="space-y-3">
                        <div className="text-muted-foreground">
                          {filters.search || filters.status !== "all" || filters.dateRange.from || filters.dateRange.to
                            ? "No policies match your current filters"
                            : "No insurance policies found"
                          }
                        </div>
                        <Button onClick={handleAddPolicy} variant="outline" className="mt-2">
                          <Plus className="h-4 w-4 mr-2" />
                          Add Your First Policy
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedPolicies.map((policy) => (
                    <TableRow
                      key={policy.id}
                      className={cn(
                        "cursor-pointer hover:bg-muted/50",
                        isPolicyUrgent(policy.expiry_date) && "border-l-4 border-l-amber-500"
                      )}
                      onClick={() => handleViewPolicy(policy)}
                    >
                      <TableCell>
                        <Link
                          href={`/customers/${policy.customer_id}`}
                          className="font-medium text-foreground hover:underline hover:opacity-80"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {policy.customers.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {policy.vehicles ? (
                          <div className="text-sm">
                            <div className="font-medium">{policy.vehicles.reg}</div>
                            <div className="text-muted-foreground">
                              {policy.vehicles.make} {policy.vehicles.model}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">No vehicle</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {policy.policy_number}
                      </TableCell>
                      <TableCell>{policy.provider || "—"}</TableCell>
                      <TableCell>
                        {format(new Date(policy.start_date), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {format(new Date(policy.expiry_date), "MMM d, yyyy")}
                          {isPolicyUrgent(policy.expiry_date) && (
                            <Badge variant="outline" className="text-xs text-amber-600">
                              Urgent
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <InsurancePolicyStatusChip
                          status={policy.status as InsurancePolicyStatus}
                          expiryDate={policy.expiry_date}
                        />
                      </TableCell>
                      <TableCell className="text-left">
                        <div className="flex items-center justify-start gap-1">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{policy.docs_count}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => {
                              e.stopPropagation();
                              handleViewPolicy(policy);
                            }}>
                              <Eye className="h-4 w-4 mr-2" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => {
                              e.stopPropagation();
                              handleEditPolicy(policy);
                            }}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit Policy
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => {
                              e.stopPropagation();
                              handleUploadDocument(policy);
                            }}>
                              <Upload className="h-4 w-4 mr-2" />
                              Upload Document
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeactivatePolicy(policy.id);
                              }}
                              disabled={policy.status === "Inactive"}
                            >
                              <Ban className="h-4 w-4 mr-2" />
                              Deactivate
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <CustomerSelectionDialog
        open={customerSelectOpen}
        onOpenChange={setCustomerSelectOpen}
        onCustomerSelect={handleCustomerSelected}
      />

      <InsurancePolicyDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        customerId={selectedCustomerId}
      />

      <InsurancePolicyDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        customerId={selectedCustomerId}
        policyId={selectedPolicyId || undefined}
      />

      <InsurancePolicyDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        policyId={selectedPolicyId}
      />

      {selectedPolicyId && (
        <DocumentUploadDialog
          open={uploadDialogOpen}
          onOpenChange={setUploadDialogOpen}
          policyId={selectedPolicyId}
        />
      )}
    </div>
  );
}
