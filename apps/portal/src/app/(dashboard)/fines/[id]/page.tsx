"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, ArrowLeft, FileText, DollarSign, Scale, CreditCard, Ban, Receipt, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FineAppealDialog } from "@/components/fines/fine-appeal-dialog";
import { FineStatusBadge } from "@/components/shared/status/fine-status-badge";
import { AuthorityPaymentDialog } from "@/components/fines/authority-payment-dialog";
import { InfoGrid } from "@/components/ui/info-grid";

interface Fine {
  id: string;
  type: string;
  reference_no: string | null;
  issue_date: string;
  due_date: string;
  amount: number;
  liability: string;
  status: string;
  notes: string | null;
  customer_id: string | null;
  vehicle_id: string;
  customers: { name: string } | null;
  vehicles: { reg: string; make: string; model: string };
}

interface FineFile {
  id: string;
  file_name: string;
  file_url: string;
  uploaded_at: string;
}

interface LedgerEntry {
  id: string;
  entry_date: string;
  due_date: string | null;
  amount: number;
  remaining_amount: number;
  type: string;
  category: string;
}

interface AuthorityPayment {
  id: string;
  payment_date: string;
  amount: number;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
}

const FineDetail = () => {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAppealDialog, setShowAppealDialog] = useState(false);
  const [showAuthorityPaymentDialog, setShowAuthorityPaymentDialog] = useState(false);

  // Action mutations
  const chargeFineAction = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('apply-fine', {
        body: { fineId: id, action: 'charge' }
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to charge fine');
      return data;
    },
    onSuccess: () => {
      toast({ title: "Fine charged to customer account successfully" });
      queryClient.invalidateQueries({ queryKey: ["fine", id] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to charge fine",
        variant: "destructive",
      });
    },
  });

  const waiveFineAction = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('apply-fine', {
        body: { fineId: id, action: 'waive' }
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to waive fine');
      return data;
    },
    onSuccess: () => {
      toast({ title: "Fine waived successfully" });
      queryClient.invalidateQueries({ queryKey: ["fine", id] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to waive fine",
        variant: "destructive",
      });
    },
  });

  const appealFineAction = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('apply-fine', {
        body: { fineId: id, action: 'appeal' }
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to mark as appealed');
      return data;
    },
    onSuccess: () => {
      toast({ title: "Fine marked as appealed" });
      queryClient.invalidateQueries({ queryKey: ["fine", id] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to mark fine as appealed",
        variant: "destructive",
      });
    },
  });

  const { data: fine, isLoading } = useQuery({
    queryKey: ["fine", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fines")
        .select(`
          *,
          customers!fines_customer_id_fkey(name),
          vehicles!fines_vehicle_id_fkey(reg, make, model)
        `)
        .eq("id", id)
        .single();

      if (error) throw error;
      return data as Fine;
    },
    enabled: !!id,
  });

  const { data: fineFiles } = useQuery({
    queryKey: ["fine-files", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fine_files")
        .select("*")
        .eq("fine_id", id)
        .order("uploaded_at", { ascending: false });

      if (error) throw error;
      return data as FineFile[];
    },
    enabled: !!id,
  });

  const { data: authorityPayments } = useQuery({
    queryKey: ["authority-payments", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("authority_payments")
        .select("*")
        .eq("fine_id", id)
        .order("payment_date", { ascending: false });

      if (error) throw error;
      return data as AuthorityPayment[];
    },
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="py-[24px] px-[8px]">Loading fine details...</div>;
  }

  if (!fine) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <h2 className="text-2xl font-bold">Fine not found</h2>
        <Button onClick={() => router.push("/fines")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Fines
        </Button>
      </div>
    );
  }

  const totalAuthorityPayments = authorityPayments?.reduce((sum, payment) => sum + Number(payment.amount), 0) || 0;
  const hasAuthorityPayments = authorityPayments && authorityPayments.length > 0;

  // Action button states
  const canCharge = fine.liability === 'Customer' && (fine.status === 'Open' || fine.status === 'Appealed');
  const canWaive = fine.status === 'Open' || fine.status === 'Appealed';
  const canAppeal = fine.status === 'Open';
  const isCharged = fine.status === 'Charged';
  const isAppealed = fine.status === 'Appealed' || fine.status === 'Appeal Submitted';

  const getDaysUntilDueDisplay = () => {
    const dueDate = new Date(fine.due_date);
    const today = new Date();
    const daysDiff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff > 0) return `${daysDiff} days`;
    if (daysDiff === 0) return "Due Today";
    return `Overdue ${Math.abs(daysDiff)}`;
  };

  const getDaysUntilDueColor = () => {
    const dueDate = new Date(fine.due_date);
    const today = new Date();
    const daysDiff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff > 7) return "text-foreground";
    if (daysDiff > 0) return "text-amber-600";
    return "text-red-600";
  };

  return (
    <TooltipProvider>
      <div className="space-y-6 py-[24px] px-[8px]">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => router.push("/fines")}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Back to Fines</p>
              </TooltipContent>
            </Tooltip>
            <div>
              <h1 className="text-3xl font-bold">Fine Details</h1>
              <p className="text-muted-foreground">
                {fine.reference_no || fine.id.slice(0, 8)} • {fine.vehicles.reg}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {canCharge && (
              <Button
                variant="outline"
                onClick={() => chargeFineAction.mutate()}
                disabled={chargeFineAction.isPending || isCharged}
              >
                <CreditCard className="h-4 w-4 mr-2" />
                {isCharged ? "Already Charged" : "Charge to Account"}
              </Button>
            )}

            <Button
              variant="outline"
              onClick={() => setShowAuthorityPaymentDialog(true)}
            >
              <Receipt className="h-4 w-4 mr-2" />
              Record Payment
            </Button>

            {canAppeal && (
              <Button
                variant="outline"
                onClick={() => setShowAppealDialog(true)}
                disabled={appealFineAction.isPending || isAppealed}
              >
                <Scale className="h-4 w-4 mr-2" />
                {isAppealed ? "Appealed" : "Appeal"}
              </Button>
            )}

            {canWaive && (
              <Button
                variant="outline"
                onClick={() => waiveFineAction.mutate()}
                disabled={waiveFineAction.isPending}
              >
                <Ban className="h-4 w-4 mr-2" />
                Waive
              </Button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-6 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Fine Amount</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                ${Number(fine.amount).toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <FineStatusBadge
                status={fine.status}
                dueDate={fine.due_date}
                remainingAmount={0}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Authority Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${hasAuthorityPayments ? 'text-green-600' : 'text-muted-foreground'}`}>
                ${totalAuthorityPayments.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Due Date</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${getDaysUntilDueColor()}`}>
                {getDaysUntilDueDisplay()}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Enhanced Tabbed Layout */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
            <TabsTrigger value="accounting">Accounting</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-primary" />
                  Fine Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InfoGrid items={[
                  { label: "Type", value: fine.type },
                  { label: "Reference", value: fine.reference_no || '-' },
                  { label: "Vehicle", value: `${fine.vehicles.reg} (${fine.vehicles.make} ${fine.vehicles.model})` },
                  { label: "Customer", value: fine.customers?.name || 'No customer assigned' },
                  { label: "Issue Date", value: new Date(fine.issue_date).toLocaleDateString() },
                  { label: "Due Date", value: new Date(fine.due_date).toLocaleDateString() }
                ]} />
                {fine.notes && (
                  <div className="mt-6 pt-4 border-t">
                    <p className="text-sm font-medium text-muted-foreground mb-2">Notes</p>
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-sm">{fine.notes}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="evidence" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Evidence Files
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fineFiles && fineFiles.length > 0 ? (
                  <div className="grid gap-4">
                    {fineFiles.map((file) => (
                      <div key={file.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div>
                          <p className="font-medium">{file.file_name}</p>
                          <p className="text-sm text-muted-foreground">
                            Uploaded {new Date(file.uploaded_at).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => window.open(file.file_url, '_blank')}
                        >
                          View File
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">No evidence files</h3>
                    <Button variant="outline" disabled>
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Evidence (Coming Soon)
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="accounting" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-primary" />
                  Authority Payments
                </CardTitle>
              </CardHeader>
              <CardContent>
                {hasAuthorityPayments ? (
                  <div className="space-y-4">
                    {authorityPayments.map((payment) => (
                      <div key={payment.id} className="flex justify-between p-3 bg-muted rounded-lg">
                        <div>
                          <p className="font-medium text-green-600">${Number(payment.amount).toLocaleString()}</p>
                          <p className="text-sm text-muted-foreground">{new Date(payment.payment_date).toLocaleDateString()}</p>
                        </div>
                        <Badge variant="outline">{payment.payment_method || 'Unknown'}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Receipt className="mx-auto h-8 w-8 mb-2" />
                    <p>No payments recorded</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Dialogs */}
        <FineAppealDialog
          open={showAppealDialog}
          onOpenChange={setShowAppealDialog}
          fineId={fine.id}
          fineAmount={fine.amount}
          customerId={fine.customer_id || undefined}
        />

        <AuthorityPaymentDialog
          open={showAuthorityPaymentDialog}
          onOpenChange={setShowAuthorityPaymentDialog}
          fineId={fine.id}
          fineAmount={fine.amount}
          fineReference={fine.reference_no}
        />
      </div>
    </TooltipProvider>
  );
};

export default FineDetail;
