"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  MoreVertical,
  Eye,
  Edit,
  Upload,
  Ban,
  Trash2,
  Shield,
  User,
  ExternalLink,
  Car,
  FileText,
  Clock
} from "lucide-react";
import { DocumentUploadDialog } from "./document-upload-dialog";
import { format, differenceInDays } from "date-fns";
import Link from "next/link";
import { InsurancePolicyStatusChip } from "./insurance-policy-status-chip";
import { InsurancePolicyDialog } from "./insurance-policy-dialog";
import { type InsurancePolicy } from "@/hooks/use-insurance-data";
import { type InsurancePolicyStatus } from "@/lib/insurance-utils";

interface InsurancePolicyDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: string | null;
}

export function InsurancePolicyDrawer({
  open,
  onOpenChange,
  policyId
}: InsurancePolicyDrawerProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: policy, isLoading } = useQuery({
    queryKey: ["insurance-policy-detail", policyId],
    queryFn: async () => {
      if (!policyId) return null;
      
      const { data, error } = await supabase
        .from("insurance_policies")
        .select(`
          *,
          customers!inner(id, name, email, phone),
          vehicles(id, reg, make, model),
          insurance_documents(id, doc_type, file_url, file_name, uploaded_at)
        `)
        .eq("id", policyId)
        .single();

      if (error) throw error;
      return data as InsurancePolicy & {
        insurance_documents: Array<{
          id: string;
          doc_type: string;
          file_url: string;
          file_name: string | null;
          uploaded_at: string;
        }>;
      };
    },
    enabled: !!policyId && open,
  });

  const { data: auditTrail } = useQuery({
    queryKey: ["insurance-audit", policyId],
    queryFn: async () => {
      if (!policyId) return [];
      
      const { data, error } = await supabase
        .from("vehicle_events")
        .select("*")
        .eq("reference_id", policyId)
        .eq("reference_table", "insurance_policies")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!policyId && open,
  });

  const deactivatePolicyMutation = useMutation({
    mutationFn: async () => {
      if (!policyId) return;
      
      const { error } = await supabase
        .from("insurance_policies")
        .update({ status: "Inactive", updated_at: new Date().toISOString() })
        .eq("id", policyId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-policies"] });
      queryClient.invalidateQueries({ queryKey: ["insurance-policy-detail", policyId] });
      toast.success("Policy deactivated successfully");
    },
    onError: () => {
      toast.error("Failed to deactivate policy");
    },
  });

  const deletePolicyMutation = useMutation({
    mutationFn: async () => {
      if (!policyId) return;
      
      const { error } = await supabase
        .from("insurance_policies")
        .delete()
        .eq("id", policyId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-policies"] });
      onOpenChange(false);
      toast.success("Policy deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete policy");
    },
  });

  if (!policy && !isLoading) {
    return null;
  }

  const daysUntilExpiry = policy 
    ? differenceInDays(new Date(policy.expiry_date), new Date())
    : 0;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Policy Details
                </SheetTitle>
                <SheetDescription>
                  {policy ? `Policy ${policy.policy_number}` : "Loading..."}
                </SheetDescription>
              </div>
              
              {policy && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
                      <Edit className="h-4 w-4 mr-2" />
                      Edit Policy
                    </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setUploadDialogOpen(true)}>
                              <Upload className="h-4 w-4 mr-2" />
                              Upload Document
                            </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={() => deactivatePolicyMutation.mutate()}
                      disabled={policy.status === "Inactive"}
                    >
                      <Ban className="h-4 w-4 mr-2" />
                      Deactivate
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => deletePolicyMutation.mutate()}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Policy
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </SheetHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading policy details...</div>
            </div>
          ) : policy ? (
            <div className="space-y-6 mt-6">
              {/* Policy Overview */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center justify-between">
                    Policy Overview
                    <InsurancePolicyStatusChip 
                      status={policy.status as InsurancePolicyStatus}
                      expiryDate={policy.expiry_date}
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm font-medium text-muted-foreground">Policy Number</div>
                      <div className="font-mono">{policy.policy_number}</div>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-muted-foreground">Provider</div>
                      <div>{policy.provider || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-muted-foreground">Start Date</div>
                      <div>{format(new Date(policy.start_date), "MMM d, yyyy")}</div>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-muted-foreground">Expiry Date</div>
                      <div className="flex items-center gap-2">
                        {format(new Date(policy.expiry_date), "MMM d, yyyy")}
                        {daysUntilExpiry >= 0 && daysUntilExpiry <= 30 && (
                          <Badge variant="outline" className="text-xs">
                            {daysUntilExpiry === 0 ? "Today" : `${daysUntilExpiry}d`}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {policy.notes && (
                    <div>
                      <div className="text-sm font-medium text-muted-foreground mb-1">Notes</div>
                      <div className="text-sm bg-muted p-3 rounded">{policy.notes}</div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Customer & Vehicle */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Customer
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="font-medium">{policy.customers.name}</div>
                      {policy.customers.email && (
                        <div className="text-sm text-muted-foreground">{policy.customers.email}</div>
                      )}
                      {policy.customers.phone && (
                        <div className="text-sm text-muted-foreground">{policy.customers.phone}</div>
                      )}
                      <Link 
                        to={`/customers/${policy.customer_id}`}
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        View Customer <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Car className="h-4 w-4" />
                      Vehicle
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {policy.vehicles ? (
                      <div className="space-y-2">
                        <div className="font-medium">{policy.vehicles.reg}</div>
                        <div className="text-sm text-muted-foreground">
                          {policy.vehicles.make} {policy.vehicles.model}
                        </div>
                        <Link 
                          to={`/vehicles/${policy.vehicles.id}`}
                          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                        >
                          View Vehicle <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    ) : (
                      <div className="text-muted-foreground">No vehicle assigned</div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Documents */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Documents ({policy.insurance_documents?.length || 0})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {policy.insurance_documents && policy.insurance_documents.length > 0 ? (
                    <div className="space-y-2">
                      {policy.insurance_documents.map((doc) => (
                        <div 
                          key={doc.id} 
                          className="flex items-center justify-between p-3 border rounded"
                        >
                          <div className="flex items-center gap-3">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium">{doc.file_name || doc.doc_type}</div>
                              <div className="text-sm text-muted-foreground">
                                {doc.doc_type} • {format(new Date(doc.uploaded_at), "MMM d, yyyy")}
                              </div>
                            </div>
                          </div>
                          <Button variant="ghost" size="sm" asChild>
                            <a 
                              href={doc.file_url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                            >
                              View
                            </a>
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-muted-foreground">
                      No documents uploaded yet
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Audit Trail */}
              {auditTrail && auditTrail.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Activity History
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {auditTrail.map((event) => (
                        <div key={event.id} className="flex gap-3 text-sm">
                          <div className="text-muted-foreground">
                            {format(new Date(event.created_at), "MMM d, HH:mm")}
                          </div>
                          <div>{event.summary}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {policy && (
        <>
          <InsurancePolicyDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            customerId={policy.customer_id}
            policyId={policy.id}
          />
          
          <DocumentUploadDialog
            open={uploadDialogOpen}
            onOpenChange={setUploadDialogOpen}
            policyId={policy.id}
          />
        </>
      )}
    </>
  );
}