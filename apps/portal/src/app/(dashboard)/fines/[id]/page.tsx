"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, ArrowLeft, FileText, DollarSign, Clock, Ban } from "lucide-react";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { useToast } from "@/hooks/use-toast";
import { FineStatusBadge } from "@/components/shared/status/fine-status-badge";
import { InfoGrid } from "@/components/ui/info-grid";
import { useTenant } from "@/contexts/TenantContext";
import {
  Tile,
  KpiTile,
  Eyebrow,
  Money,
  SectionCard,
  EmptyState,
  Shimmer,
} from "@/components/bento";

interface Fine {
  id: string;
  type: string;
  reference_no: string | null;
  issue_date: string;
  due_date: string;
  amount: number;
  status: string;
  notes: string | null;
  customer_id: string | null;
  vehicle_id: string;
  rental_id: string | null;
  customers: { name: string } | null;
  vehicles: { reg: string; make: string; model: string };
  rentals: { rental_number: string | null } | null;
}

interface FineFile {
  id: string;
  file_name: string;
  file_url: string;
  uploaded_at: string;
}

const FineDetail = () => {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();

  const [showPaymentDialog, setShowPaymentDialog] = useState(false);

  // Ensure fine's ledger entry has rental_id before opening payment dialog
  const openPaymentDialog = async () => {
    if (fine?.rental_id) {
      await supabase
        .from('ledger_entries')
        .update({ rental_id: fine.rental_id })
        .eq('reference', `FINE-${id}`)
        .eq('type', 'Charge')
        .is('rental_id', null);
    }
    setShowPaymentDialog(true);
  };

  // After a payment is recorded, sync the fine status based on ledger entry remaining_amount
  const syncFineStatusAfterPayment = async () => {
    try {
      const { data: ledgerEntry } = await supabase
        .from('ledger_entries')
        .select('remaining_amount, amount')
        .eq('reference', `FINE-${id}`)
        .eq('type', 'Charge')
        .maybeSingle();

      let newStatus: string | null = null;

      if (ledgerEntry) {
        if (ledgerEntry.remaining_amount <= 0) {
          newStatus = 'Paid';
        } else if (ledgerEntry.remaining_amount < ledgerEntry.amount) {
          newStatus = 'Charged';
        }
      } else {
        // No ledger entry — fine predates ledger integration, mark as Paid
        newStatus = 'Paid';
      }

      if (newStatus) {
        const updateData: any = { status: newStatus };
        const now = new Date().toISOString();
        if (newStatus === 'Paid') {
          updateData.charged_at = now;
          updateData.resolved_at = now;
        } else if (newStatus === 'Charged') {
          updateData.charged_at = now;
        }

        await supabase
          .from('fines')
          .update(updateData)
          .eq('id', id);
      }

      // Always invalidate queries after payment success
      queryClient.invalidateQueries({ queryKey: ["fine", id] });
      queryClient.invalidateQueries({ queryKey: ["fines-enhanced"] });
      queryClient.invalidateQueries({ queryKey: ["fines-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balance"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balance-status"] });
      queryClient.invalidateQueries({ queryKey: ["customer-fine-stats"] });
      queryClient.invalidateQueries({ queryKey: ["rental-fines"] });
      queryClient.invalidateQueries({ queryKey: ["rental-totals"] });
    } catch (err) {
      console.error('Error syncing fine status after payment:', err);
    }
  };

  const waiveFineAction = useMutation({
    mutationFn: async () => {
      // Client-side: delete ledger entry for Open fines before calling edge function
      await supabase
        .from('ledger_entries')
        .delete()
        .eq('reference', `FINE-${id}`)
        .eq('type', 'Charge');

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
      queryClient.invalidateQueries({ queryKey: ["customer-balance"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balance-status"] });
      queryClient.invalidateQueries({ queryKey: ["fines-kpis"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to waive fine",
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
          vehicles!fines_vehicle_id_fkey(reg, make, model),
          rentals!fines_rental_id_fkey(rental_number)
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

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" disabled>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="space-y-2">
            <Shimmer className="h-7 w-48" />
            <Shimmer className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Tile key={i} noMotion className="flex flex-col gap-3">
              <Shimmer className="h-3 w-20" />
              <Shimmer className="h-8 w-24" />
            </Tile>
          ))}
        </div>
        <Shimmer className="h-64 w-full rounded-tile" />
      </div>
    );
  }

  if (!fine) {
    return (
      <div className="container mx-auto p-6">
        <EmptyState
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Fine not found"
          description="This fine may have been removed or the link is invalid."
          action={
            <Button onClick={() => router.push("/fines")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Fines
            </Button>
          }
        />
      </div>
    );
  }

  // Action button states
  const canCharge = fine.status === 'Open';
  const canWaive = fine.status === 'Open';

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
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
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
              <Eyebrow>Fine</Eyebrow>
              <h1 className="text-[30px] font-extrabold tracking-tight leading-tight">Fine Details</h1>
              <p className="text-muted-foreground text-sm">
                <span className="font-mono tabular-nums">{fine.reference_no || fine.id.slice(0, 8)}</span>
                {" • "}
                <span className="font-mono tabular-nums">{fine.vehicles.reg}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {canCharge && (
              <Button
                variant="outline"
                onClick={() => openPaymentDialog()}
              >
                <DollarSign className="h-4 w-4 mr-2" />
                Record Payment
              </Button>
            )}

            {canWaive && (
              <Button
                variant="outline"
                onClick={() => waiveFineAction.mutate()}
                disabled={waiveFineAction.isPending}
              >
                <Ban className="h-4 w-4 mr-2" />
                Waive Fine
              </Button>
            )}
          </div>
        </div>

        {/* KPI Card Row */}
        <div className="grid gap-4 md:grid-cols-3">
          <KpiTile
            label="Fine Amount"
            variant="feature"
            value={Number(fine.amount)}
            noCountUp
            icon={<DollarSign className="h-4 w-4" />}
            format={() => (
              <Money value={Number(fine.amount)} currency={tenant?.currency_code || 'USD'} locale="en-US" />
            )}
          />

          <Tile className="flex flex-col gap-2">
            <Eyebrow>Status</Eyebrow>
            <div className="flex items-center">
              <FineStatusBadge
                status={fine.status}
                dueDate={fine.due_date}
                remainingAmount={0}
              />
            </div>
          </Tile>

          <KpiTile
            label="Days Until Due"
            variant={getDaysUntilDueColor() === "text-red-600" ? "warn" : "default"}
            value={0}
            noCountUp
            icon={<Clock className="h-4 w-4" />}
            format={() => (
              <span className="font-mono tabular-nums">{getDaysUntilDueDisplay()}</span>
            )}
          />
        </div>

        {/* Tabbed Layout */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            <SectionCard
              icon={<AlertTriangle className="h-4 w-4" />}
              title="Fine Information"
            >
              <InfoGrid items={[
                { label: "Type", value: fine.type },
                { label: "Reference", value: fine.reference_no || '-' },
                { label: "Vehicle", value: `${fine.vehicles.reg} (${fine.vehicles.make} ${fine.vehicles.model})` },
                { label: "Customer", value: fine.customers?.name || 'No customer assigned' },
                { label: "Rental #", value: fine.rentals?.rental_number || '-' },
                { label: "Issue Date", value: new Date(fine.issue_date + 'T00:00:00').toLocaleDateString('en-US') },
                { label: "Due Date", value: new Date(fine.due_date + 'T00:00:00').toLocaleDateString('en-US') }
              ]} />
              {fine.notes && (
                <div className="mt-6 pt-4 border-t border-border">
                  <p className="text-sm font-medium text-muted-foreground mb-2">Notes</p>
                  <div className="rounded-tile-sm [background:var(--bento-tile-2)] p-3">
                    <p className="text-sm">{fine.notes}</p>
                  </div>
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="documents" className="space-y-6 mt-6">
            <SectionCard
              icon={<FileText className="h-4 w-4" />}
              title="Documents"
            >
              {fineFiles && fineFiles.length > 0 ? (
                <div className="grid gap-3">
                  {fineFiles.map((file) => (
                    <div key={file.id} className="flex items-center justify-between rounded-tile-sm border border-border p-4">
                      <div>
                        <p className="font-medium">{file.file_name}</p>
                        <p className="text-sm text-muted-foreground">
                          Uploaded {new Date(file.uploaded_at).toLocaleDateString('en-US')}
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
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full [background:var(--bento-primary-weak)] text-[color:var(--bento-primary-weak-fg)]">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-bold tracking-tight">No documents</h3>
                    <p className="text-sm text-muted-foreground">
                      Documents related to this fine will appear here
                    </p>
                  </div>
                </div>
              )}
            </SectionCard>
          </TabsContent>
        </Tabs>
      </div>

      {fine && (
        <AddPaymentDialog
          open={showPaymentDialog}
          onOpenChange={(open) => {
            setShowPaymentDialog(open);
          }}
          customer_id={fine.customer_id || undefined}
          vehicle_id={fine.vehicle_id}
          rental_id={fine.rental_id || undefined}
          defaultAmount={Number(fine.amount)}
          targetCategories={["Fine"]}
          onPaymentSuccess={() => syncFineStatusAfterPayment()}
        />
      )}
    </TooltipProvider>
  );
};

export default FineDetail;
