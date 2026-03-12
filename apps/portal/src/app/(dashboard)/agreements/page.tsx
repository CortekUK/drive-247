"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import {
  BarChart, Bar, PieChart, Pie, Cell, CartesianGrid, XAxis, YAxis,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";
import { FileSignature, Download, ExternalLink, Info } from "lucide-react";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { format, subMonths, startOfMonth } from "date-fns";
import { useState, useMemo } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// --- Chart configs ---
const TYPE_COLORS: Record<string, string> = {
  "Original": "#6366f1",
  "Extension": "#8b5cf6",
  "Signed": "#22c55e",
};

const typeChartConfig = Object.fromEntries(
  Object.entries(TYPE_COLORS).map(([k, v]) => [k, { label: k, color: v }])
) as ChartConfig;

const monthlyConfig: ChartConfig = {
  count: { label: "Agreements", color: "#6366f1" },
};

const signedRadialConfig: ChartConfig = {
  rate: { label: "Signed", color: "#22c55e" },
};

interface AgreementDoc {
  id: string;
  document_name: string;
  file_name?: string;
  file_url?: string | null;
  created_at: string;
  document_type?: string;
  customer_id?: string;
  customers?: { name: string };
  isRentalAgreement?: boolean;
  agreementType?: "original" | "extension" | "signed";
  status?: string;
}

export default function AgreementsList() {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(25);
  const { tenant } = useTenant();

  // Fetch signed agreements from customer_documents
  const { data: signedAgreements = [], isLoading: isLoadingSigned } = useQuery({
    queryKey: ["signed-agreements", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_documents")
        .select(`
          *,
          customers!customer_documents_customer_id_fkey(name)
        `)
        .eq("tenant_id", tenant!.id)
        .eq("document_type", "Agreement")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!tenant,
  });

  // Fetch pending rental agreements from rentals table
  const { data: rentalAgreements = [], isLoading: isLoadingRentals } = useQuery({
    queryKey: ["rental-agreements-page", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select(`
          id,
          created_at,
          document_status,
          signed_document_id,
          customers!rentals_customer_id_fkey(name),
          vehicles!rentals_vehicle_id_fkey(reg, make, model)
        `)
        .eq("tenant_id", tenant!.id)
        .is("signed_document_id", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!tenant,
  });

  // Fetch extension agreements from rental_agreements table
  const { data: extensionAgreements = [], isLoading: isLoadingExtensions } = useQuery({
    queryKey: ["extension-agreements-page", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_agreements")
        .select(`
          id,
          created_at,
          document_status,
          signed_document_id,
          agreement_type,
          rentals!rental_agreements_rental_id_fkey(
            id,
            customers!rentals_customer_id_fkey(name),
            vehicles!rentals_vehicle_id_fkey(reg, make, model)
          )
        `)
        .eq("tenant_id", tenant!.id)
        .eq("agreement_type", "extension")
        .is("signed_document_id", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!tenant,
  });

  const isLoading = isLoadingSigned || isLoadingRentals || isLoadingExtensions;

  // Combine all agreement types
  const allAgreements: AgreementDoc[] = [
    ...rentalAgreements.map((rental: any) => ({
      id: rental.id,
      document_name: `Rental Agreement - ${rental.vehicles?.reg || 'Vehicle'}`,
      created_at: rental.created_at,
      document_type: 'Agreement',
      status: rental.document_status || 'pending',
      customer_id: rental.customers?.id,
      customers: rental.customers,
      file_url: null,
      isRentalAgreement: true,
      agreementType: "original" as const,
    })),
    ...extensionAgreements.map((agreement: any) => ({
      id: agreement.id,
      document_name: `Extension Agreement - ${agreement.rentals?.vehicles?.reg || 'Vehicle'}`,
      created_at: agreement.created_at,
      document_type: 'Agreement',
      status: agreement.document_status || 'pending',
      customer_id: agreement.rentals?.customers?.id,
      customers: agreement.rentals?.customers,
      file_url: null,
      isRentalAgreement: true,
      agreementType: "extension" as const,
    })),
    ...signedAgreements.map((doc: any) => ({
      ...doc,
      agreementType: "signed" as const,
    })),
  ];

  const filteredAgreements = allAgreements.filter((doc) => {
    const matchesSearch = doc.document_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         doc.customers?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  // Pagination
  const totalDocuments = filteredAgreements.length;
  const totalPages = Math.ceil(totalDocuments / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalDocuments);
  const paginatedDocuments = filteredAgreements.slice(startIndex, endIndex);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const getPublicUrl = (filePath: string) => {
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }
    const { data } = supabase.storage
      .from('customer-documents')
      .getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleDownload = async (fileUrl: string, fileName: string) => {
    try {
      const publicUrl = getPublicUrl(fileUrl);
      const response = await fetch(publicUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Failed to download document');
    }
  };

  const handleView = (fileUrl: string) => {
    const publicUrl = getPublicUrl(fileUrl);
    window.open(publicUrl, "_blank");
  };

  // --- Chart data ---
  const typeDonutData = useMemo(() => {
    const original = allAgreements.filter(d => d.agreementType === "original").length;
    const extension = allAgreements.filter(d => d.agreementType === "extension").length;
    const signed = allAgreements.filter(d => d.agreementType === "signed").length;
    return [
      { name: "Original", value: original, fill: TYPE_COLORS["Original"] },
      { name: "Extension", value: extension, fill: TYPE_COLORS["Extension"] },
      { name: "Signed", value: signed, fill: TYPE_COLORS["Signed"] },
    ].filter(d => d.value > 0);
  }, [allAgreements]);

  const monthlyData = useMemo(() => {
    const now = new Date();
    const months: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(now, i);
      const key = format(startOfMonth(d), "yyyy-MM");
      const label = format(d, "MMM");
      const count = allAgreements.filter((doc) => doc.created_at?.startsWith(key)).length;
      months.push({ month: label, count });
    }
    return months;
  }, [allAgreements]);

  const signedRadialData = useMemo(() => {
    const signed = allAgreements.filter(d => d.agreementType === "signed").length;
    const pending = allAgreements.filter(d => d.isRentalAgreement).length;
    const total = signed + pending;
    const rate = total > 0 ? Math.round((signed / total) * 100) : 0;
    return { rate, signed, total, pending };
  }, [allAgreements]);

  const topCustomersData = useMemo(() => {
    const counts: Record<string, number> = {};
    allAgreements.forEach((doc) => {
      const name = doc.customers?.name || "Unknown";
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name: name.length > 12 ? name.slice(0, 12) + "…" : name, count, fullName: name }));
  }, [allAgreements]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-muted animate-pulse rounded"></div>
        <div className="h-96 bg-muted animate-pulse rounded"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Agreements</h1>
          <p className="text-muted-foreground">Manage rental agreements and signed documents</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by agreement name or customer..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="flex-1"
        />
      </div>

      {/* Charts */}
      <TooltipProvider>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Agreement Types Donut */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Agreement Types</h3>
              <Tooltip>
                <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent>Original vs Extension vs Signed agreements</TooltipContent>
              </Tooltip>
            </div>
            {typeDonutData.length > 0 ? (
              <ChartContainer config={typeChartConfig} className="h-[180px] w-full">
                <PieChart>
                  <Pie data={typeDonutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                    {typeDonutData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <ChartTooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.fill }} />
                          <span className="text-sm font-medium">{d.name}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{d.value} agreement{d.value !== 1 ? "s" : ""}</p>
                      </div>
                    );
                  }} />
                </PieChart>
              </ChartContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-10">No data</p>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {typeDonutData.map((d) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.fill }} />
                  {d.name}
                </div>
              ))}
            </div>
          </div>

          {/* Monthly Agreements */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Monthly Agreements</h3>
              <Tooltip>
                <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent>Agreements over last 6 months</TooltipContent>
              </Tooltip>
            </div>
            <ChartContainer config={monthlyConfig} className="h-[180px] w-full">
              <BarChart data={monthlyData}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={28} />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <ChartTooltip cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                      <p className="text-xs text-muted-foreground">{d.month}</p>
                      <p className="text-sm font-semibold">{d.count} agreement{d.count !== 1 ? "s" : ""}</p>
                    </div>
                  );
                }} />
              </BarChart>
            </ChartContainer>
          </div>

          {/* Signature Rate Radial */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Signature Rate</h3>
              <Tooltip>
                <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent>Percentage of agreements that are signed</TooltipContent>
              </Tooltip>
            </div>
            <ChartContainer config={signedRadialConfig} className="h-[180px] w-full">
              <RadialBarChart
                innerRadius="70%"
                outerRadius="100%"
                data={[{ rate: signedRadialData.rate, fill: "#22c55e" }]}
                startAngle={180}
                endAngle={0}
                cx="50%"
                cy="65%"
              >
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar background dataKey="rate" cornerRadius={6} />
                <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">
                  {signedRadialData.rate}%
                </text>
                <text x="50%" y="70%" textAnchor="middle" className="fill-muted-foreground text-xs">
                  {signedRadialData.signed}/{signedRadialData.total} signed
                </text>
              </RadialBarChart>
            </ChartContainer>
          </div>

          {/* Top Customers */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Top Customers</h3>
              <Tooltip>
                <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent>Customers with most agreements</TooltipContent>
              </Tooltip>
            </div>
            {topCustomersData.length > 0 ? (
              <ChartContainer config={{ count: { label: "Agreements", color: "#6366f1" } }} className="h-[180px] w-full">
                <BarChart data={topCustomersData} layout="vertical" margin={{ left: 0, right: 8 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={80} />
                  <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  <ChartTooltip cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                        <p className="text-sm font-medium">{d.fullName}</p>
                        <p className="text-sm text-muted-foreground">{d.count} agreement{d.count !== 1 ? "s" : ""}</p>
                      </div>
                    );
                  }} />
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-10">No data</p>
            )}
          </div>
        </div>
      </TooltipProvider>

      {/* Agreements Table */}
      {paginatedDocuments.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="No agreements found"
          description={searchQuery
            ? "No agreements match your search criteria"
            : "There are no agreements in the system yet."}
        />
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agreement Name</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedDocuments.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium">
                        {doc.document_name}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {doc.customers?.name || "—"}
                      </TableCell>
                      <TableCell>
                        {doc.isRentalAgreement ? (
                          <span className="text-sm text-orange-600 dark:text-orange-400">Pending signature</span>
                        ) : (
                          <span className="text-sm text-green-600 dark:text-green-400">Signed</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(doc.created_at), "MMM dd, yyyy HH:mm")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {doc.file_url ? (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDownload(doc.file_url!, doc.file_name || doc.document_name)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleView(doc.file_url!)}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {startIndex + 1}-{endIndex} of {totalDocuments} agreements
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
      )}
    </div>
  );
}
