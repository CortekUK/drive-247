import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Shield, Plus, Edit, FileText, Calendar } from "lucide-react";
import { format } from "date-fns";
import { InsurancePolicyDialog } from "./insurance-policy-dialog";
import { InsurancePolicyStatusChip } from "./insurance-policy-status-chip";
import { InsuranceDocumentUpload } from "./insurance-document-upload";
import { type InsurancePolicyStatus } from "@/lib/insurance-utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface InsurancePolicy {
  id: string;
  policy_number: string;
  provider: string | null;
  start_date: string;
  expiry_date: string;
  status: InsurancePolicyStatus;
  notes: string | null;
  vehicle_id: string | null;
  vehicles?: {
    reg: string;
    make: string;
    model: string;
  } | null;
  insurance_documents?: Array<{
    id: string;
    doc_type: string;
    file_url: string;
    file_name: string | null;
    uploaded_at: string;
  }>;
}

interface InsuranceTabContentProps {
  customerId: string;
}

export function InsuranceTabContent({ customerId }: InsuranceTabContentProps) {
  const [showInsuranceDialog, setShowInsuranceDialog] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState<string | undefined>();
  const [expandedPolicy, setExpandedPolicy] = useState<string | null>(null);

  const { data: insurancePolicies = [], isLoading } = useQuery({
    queryKey: ["customer-insurance", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_policies")
        .select(`
          *,
          vehicles(reg, make, model),
          insurance_documents(id, doc_type, file_url, file_name, uploaded_at)
        `)
        .eq("customer_id", customerId)
        .order("expiry_date", { ascending: true });

      if (error) throw error;
      return data as InsurancePolicy[];
    },
    enabled: !!customerId,
  });

  const handleEditPolicy = (policyId: string) => {
    setEditingPolicyId(policyId);
    setShowInsuranceDialog(true);
  };

  const handleAddPolicy = () => {
    setEditingPolicyId(undefined);
    setShowInsuranceDialog(true);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8 text-muted-foreground">
            Loading insurance policies...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle>Insurance Policies</CardTitle>
            </div>
            <Button onClick={handleAddPolicy}>
              <Plus className="h-4 w-4 mr-2" />
              Add Policy
            </Button>
          </div>
          <CardDescription>Insurance compliance and document management</CardDescription>
        </CardHeader>
        <CardContent>
          {insurancePolicies.length > 0 ? (
            <div className="space-y-4">
              {insurancePolicies.map((policy) => (
                <Collapsible
                  key={policy.id}
                  open={expandedPolicy === policy.id}
                  onOpenChange={(isOpen) => setExpandedPolicy(isOpen ? policy.id : null)}
                >
                  <div className="border rounded-lg p-4">
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center justify-between cursor-pointer">
                        <div className="flex-1">
                          <div className="flex items-center gap-4">
                            <div>
                              <h4 className="font-semibold">{policy.policy_number}</h4>
                              <p className="text-sm text-muted-foreground">
                                {policy.provider || "No provider specified"}
                              </p>
                            </div>
                            <div className="text-sm">
                              <div className="flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-muted-foreground" />
                                <span>Expires: {format(new Date(policy.expiry_date), "MMM d, yyyy")}</span>
                              </div>
                              {policy.vehicles && (
                                <div className="text-muted-foreground mt-1">
                                  Vehicle: {policy.vehicles.reg} ({policy.vehicles.make} {policy.vehicles.model})
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <InsurancePolicyStatusChip 
                            status={policy.status}
                            expiryDate={policy.expiry_date}
                          />
                          <Badge variant="outline" className="text-xs">
                            <FileText className="h-3 w-3 mr-1" />
                            {policy.insurance_documents?.length || 0} docs
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditPolicy(policy.id);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    
                    <CollapsibleContent className="pt-4 space-y-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <label className="font-medium text-muted-foreground">Start Date</label>
                          <p>{format(new Date(policy.start_date), "MMM d, yyyy")}</p>
                        </div>
                        <div>
                          <label className="font-medium text-muted-foreground">Status</label>
                          <p>{policy.status}</p>
                        </div>
                        {policy.notes && (
                          <div className="col-span-2">
                            <label className="font-medium text-muted-foreground">Notes</label>
                            <p className="text-sm">{policy.notes}</p>
                          </div>
                        )}
                      </div>
                      
                      <div className="border-t pt-4">
                        <h5 className="font-medium mb-3">Policy Documents</h5>
                        <InsuranceDocumentUpload
                          policyId={policy.id}
                          documents={policy.insurance_documents || []}
                        />
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-medium text-lg mb-2">No insurance policies</h3>
              <p className="text-muted-foreground mb-4">
                Add insurance policies to track compliance and manage documents.
              </p>
              <Button onClick={handleAddPolicy}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Policy
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <InsurancePolicyDialog
        open={showInsuranceDialog}
        onOpenChange={setShowInsuranceDialog}
        customerId={customerId}
        policyId={editingPolicyId}
      />
    </>
  );
}