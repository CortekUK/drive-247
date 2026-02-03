"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, ArrowLeft, FileText, DollarSign, CreditCard, Clock, Upload, Ban } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FineStatusBadge } from "@/components/shared/status/fine-status-badge";
import { KPICard } from "@/components/ui/kpi-card";
import { InfoGrid } from "@/components/ui/info-grid";

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
  customers: { name: string } | null;
  vehicles: { reg: string; make: string; model: string };
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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" disabled>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Fines
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Fine Details</h1>
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <KPICard key={i} title="" value="" isLoading />
          ))}
        </div>
      </div>
    );
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

  // Action button states
  const canCharge = fine.status === 'Open';
  const canWaive = fine.status === 'Open';
  const isCharged = fine.status === 'Charged';

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
              <h1 className="text-3xl font-bold">Fine Details</h1>
              <p className="text-muted-foreground">
                {fine.reference_no || fine.id.slice(0, 8)} • {fine.vehicles.reg}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {canCharge && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    onClick={() => chargeFineAction.mutate()}
                    disabled={chargeFineAction.isPending || isCharged}
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    {isCharged ? "Already Charged" : "Charge to Account"}
                  </Button>
                </TooltipTrigger>
                {isCharged && (
                  <TooltipContent>
                    <p>Fine has already been charged to customer account</p>
                  </TooltipContent>
                )}
              </Tooltip>
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
          <KPICard
            title="Fine Amount"
            value={`$${Number(fine.amount).toLocaleString()}`}
            valueClassName="text-destructive dark:text-destructive"
            icon={<DollarSign className="h-4 w-4" />}
            className="bg-destructive/10 border-destructive/20"
          />

          <KPICard
            title="Status"
            value={<FineStatusBadge
              status={fine.status}
              dueDate={fine.due_date}
              remainingAmount={0}
            />}
            className="bg-muted/50 border-muted-foreground/20"
          />

          <KPICard
            title="Days Until Due"
            value={getDaysUntilDueDisplay()}
            valueClassName={getDaysUntilDueColor() === "text-red-600" ? "text-destructive dark:text-destructive" : getDaysUntilDueColor() === "text-amber-600" ? "text-warning dark:text-warning" : "text-success dark:text-success"}
            icon={<Clock className="h-4 w-4" />}
            className={
              getDaysUntilDueColor() === "text-red-600"
                ? "bg-destructive/10 border-destructive/20"
                : getDaysUntilDueColor() === "text-amber-600"
                  ? "bg-warning/10 border-warning/20"
                  : "bg-success/10 border-success/20"
            }
          />
        </div>

        {/* Tabbed Layout */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
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

          <TabsContent value="documents" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Documents
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
                    <h3 className="text-lg font-medium mb-2">No documents</h3>
                    <p className="text-sm text-muted-foreground">
                      Documents related to this fine will appear here
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
};

export default FineDetail;
