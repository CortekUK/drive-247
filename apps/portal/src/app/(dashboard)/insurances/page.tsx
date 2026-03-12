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
import { ShieldCheck, Download, ExternalLink, X, Info } from "lucide-react";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { format, subMonths, startOfMonth } from "date-fns";
import { useState, useMemo } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

// --- Chart configs ---
const SOURCE_COLORS: Record<string, string> = {
  "Bonzah": "#CC004A",
  "Uploaded": "#6366f1",
};

const sourceChartConfig = Object.fromEntries(
  Object.entries(SOURCE_COLORS).map(([k, v]) => [k, { label: k, color: v }])
) as ChartConfig;

const monthlyConfig: ChartConfig = {
  count: { label: "Insurances", color: "#6366f1" },
};

const statusRadialConfig: ChartConfig = {
  rate: { label: "Active", color: "#22c55e" },
};

interface InsuranceDoc {
  id: string;
  document_name: string;
  file_name?: string;
  file_url?: string | null;
  created_at: string;
  document_type?: string;
  customer_id: string;
  customers?: { name: string };
  isBonzah?: boolean;
  insurance_provider?: string | null;
  rental_id?: string | null;
  status?: string;
}

export default function InsurancesList() {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(25);
  const [bonzahFilter, setBonzahFilter] = useState(false);
  const { tenant } = useTenant();
  const router = useRouter();

  // Fetch insurance documents from customer_documents table
  const { data: insuranceDocuments = [], isLoading: isLoadingDocs } = useQuery({
    queryKey: ["insurance-documents", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_documents")
        .select(`
          *,
          customers!customer_documents_customer_id_fkey(name)
        `)
        .eq("tenant_id", tenant!.id)
        .or("document_type.eq.Insurance Certificate,insurance_provider.not.is.null")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as InsuranceDoc[];
    },
    enabled: !!tenant,
  });

  // Fetch Bonzah insurance policies
  const { data: bonzahPolicies = [], isLoading: isLoadingBonzah } = useQuery({
    queryKey: ["bonzah-policies-insurances", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bonzah_insurance_policies")
        .select(`
          id,
          policy_no,
          quote_no,
          status,
          coverage_types,
          premium_amount,
          created_at,
          customer_id,
          rental_id,
          customers!bonzah_insurance_policies_customer_id_fkey(name)
        `)
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!tenant,
  });

  const isLoading = isLoadingDocs || isLoadingBonzah;

  // Combine all insurance documents
  const allInsurances: InsuranceDoc[] = [
    ...insuranceDocuments.map((doc: any) => ({
      ...doc,
      isBonzah: doc.insurance_provider?.toLowerCase().includes('bonzah') || false,
    })),
    ...bonzahPolicies.map((policy: any) => ({
      id: `bonzah-${policy.id}`,
      document_name: `Bonzah Insurance${policy.policy_no ? ` - Policy #${policy.policy_no}` : policy.quote_no ? ` - Quote #${policy.quote_no}` : ''}`,
      created_at: policy.created_at,
      document_type: 'Insurance',
      status: policy.status,
      customer_id: policy.customer_id,
      customers: policy.customers,
      file_url: null,
      isBonzah: true,
      rental_id: policy.rental_id,
    })),
  ];

  const filteredInsurances = allInsurances.filter((doc) => {
    const matchesSearch = doc.document_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         doc.customers?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesBonzah = !bonzahFilter || doc.isBonzah;
    return matchesSearch && matchesBonzah;
  });

  // Pagination
  const totalDocuments = filteredInsurances.length;
  const totalPages = Math.ceil(totalDocuments / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalDocuments);
  const paginatedDocuments = filteredInsurances.slice(startIndex, endIndex);

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
  const sourceDonutData = useMemo(() => {
    const bonzahCount = allInsurances.filter(d => d.isBonzah).length;
    const uploadedCount = allInsurances.filter(d => !d.isBonzah).length;
    return [
      { name: "Bonzah", value: bonzahCount, fill: SOURCE_COLORS["Bonzah"] },
      { name: "Uploaded", value: uploadedCount, fill: SOURCE_COLORS["Uploaded"] },
    ].filter(d => d.value > 0);
  }, [allInsurances]);

  const monthlyData = useMemo(() => {
    const now = new Date();
    const months: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(now, i);
      const key = format(startOfMonth(d), "yyyy-MM");
      const label = format(d, "MMM");
      const count = allInsurances.filter((doc) => doc.created_at?.startsWith(key)).length;
      months.push({ month: label, count });
    }
    return months;
  }, [allInsurances]);

  const statusRadialData = useMemo(() => {
    const active = allInsurances.filter(d => d.status === 'active' || d.status === 'confirmed').length;
    const total = allInsurances.length;
    const rate = total > 0 ? Math.round((active / total) * 100) : 0;
    return { rate, active, total, expired: total - active };
  }, [allInsurances]);

  const topCustomersData = useMemo(() => {
    const counts: Record<string, number> = {};
    allInsurances.forEach((doc) => {
      const name = doc.customers?.name || "Unknown";
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name: name.length > 12 ? name.slice(0, 12) + "…" : name, count, fullName: name }));
  }, [allInsurances]);

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
          <h1 className="text-3xl font-bold">Insurances</h1>
          <p className="text-muted-foreground">Manage customer insurance documents and Bonzah policies</p>
        </div>
      </div>

      {/* Search + Bonzah Filter */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by document name or customer..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="flex-1"
        />
        <button
          onClick={() => {
            setBonzahFilter(!bonzahFilter);
            setCurrentPage(1);
          }}
          className="inline-flex items-center gap-2 px-3 h-9 rounded-md border text-sm font-medium whitespace-nowrap transition-colors shrink-0"
          style={{
            borderColor: bonzahFilter ? '#CC004A' : 'rgba(204, 0, 74, 0.3)',
            backgroundColor: bonzahFilter ? '#CC004A' : 'transparent',
            color: bonzahFilter ? '#fff' : '#CC004A',
          }}
        >
          <img
            src="/bonzah-logo.svg"
            alt="Bonzah"
            className={`h-4 w-auto ${bonzahFilter ? 'brightness-0 invert' : ''} dark:hidden`}
          />
          <img
            src="/bonzah-logo-dark.svg"
            alt="Bonzah"
            className={`h-4 w-auto ${bonzahFilter ? 'brightness-0 invert' : ''} hidden dark:block`}
          />
          Bonzah Only
          {bonzahFilter && <X className="ml-1 h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Charts */}
      <TooltipProvider>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Insurance Sources Donut */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Insurance Sources</h3>
              <Tooltip>
                <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent>Bonzah vs uploaded insurance documents</TooltipContent>
              </Tooltip>
            </div>
            {sourceDonutData.length > 0 ? (
              <ChartContainer config={sourceChartConfig} className="h-[180px] w-full">
                <PieChart>
                  <Pie data={sourceDonutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                    {sourceDonutData.map((entry) => (
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
                        <p className="text-sm text-muted-foreground mt-0.5">{d.value} polic{d.value !== 1 ? "ies" : "y"}</p>
                      </div>
                    );
                  }} />
                </PieChart>
              </ChartContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-10">No data</p>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {sourceDonutData.map((d) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.fill }} />
                  {d.name}
                </div>
              ))}
            </div>
          </div>

          {/* Monthly Insurances */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Monthly Insurances</h3>
              <Tooltip>
                <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent>Insurance documents over last 6 months</TooltipContent>
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
                      <p className="text-sm font-semibold">{d.count} insurance{d.count !== 1 ? "s" : ""}</p>
                    </div>
                  );
                }} />
              </BarChart>
            </ChartContainer>
          </div>

          {/* Policy Status Radial */}
          <div className="rounded-lg border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <h3 className="text-sm font-medium">Policy Status</h3>
              <Tooltip>
                <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent>Percentage of active policies</TooltipContent>
              </Tooltip>
            </div>
            <ChartContainer config={statusRadialConfig} className="h-[180px] w-full">
              <RadialBarChart
                innerRadius="70%"
                outerRadius="100%"
                data={[{ rate: statusRadialData.rate, fill: "#22c55e" }]}
                startAngle={180}
                endAngle={0}
                cx="50%"
                cy="65%"
              >
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar background dataKey="rate" cornerRadius={6} />
                <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">
                  {statusRadialData.rate}%
                </text>
                <text x="50%" y="70%" textAnchor="middle" className="fill-muted-foreground text-xs">
                  {statusRadialData.active}/{statusRadialData.total} active
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
                <TooltipContent>Customers with most insurance documents</TooltipContent>
              </Tooltip>
            </div>
            {topCustomersData.length > 0 ? (
              <ChartContainer config={{ count: { label: "Insurances", color: "#6366f1" } }} className="h-[180px] w-full">
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
                        <p className="text-sm text-muted-foreground">{d.count} insurance{d.count !== 1 ? "s" : ""}</p>
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

      {/* Insurance Table */}
      {paginatedDocuments.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No insurance documents found"
          description={searchQuery || bonzahFilter
            ? "No insurance documents match your search criteria"
            : "There are no insurance documents in the system yet."}
        />
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document Name</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedDocuments.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {doc.document_name}
                          {doc.isBonzah && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                              style={{ backgroundColor: 'rgba(204, 0, 74, 0.1)', color: '#CC004A' }}
                            >
                              <img src="/bonzah-logo.svg" alt="" className="h-2.5 w-auto dark:hidden" />
                              <img src="/bonzah-logo-dark.svg" alt="" className="h-2.5 w-auto hidden dark:block" />
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {doc.customers?.name || "—"}
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
                          ) : doc.isBonzah && doc.rental_id ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => router.push(`/rentals/${doc.rental_id}`)}
                              className="text-xs"
                            >
                              <ExternalLink className="h-4 w-4 mr-1" />
                              View Rental
                            </Button>
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
              Showing {startIndex + 1}-{endIndex} of {totalDocuments} insurance documents
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
