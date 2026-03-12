"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Download, ExternalLink, X, Loader2, Search, BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { format } from "date-fns";
import Link from "next/link";
import { useState, useCallback } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import JSZip from "jszip";
import { jsPDF } from "jspdf";

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
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

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
          policy_type,
          pickup_state,
          trip_start_date,
          trip_end_date,
          renter_details,
          policy_issued_at,
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

  const generateInsurancePdf = (doc: InsuranceDoc, index: number): { blob: Blob; fileName: string } => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 20;
    let y = 25;

    // Header
    const companyName = tenant?.company_name || tenant?.slug || "Drive247";
    pdf.setFontSize(18);
    pdf.setFont("helvetica", "bold");
    pdf.text(companyName, margin, y);
    y += 8;
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(100);
    pdf.text("Insurance Record", margin, y);
    y += 4;

    // Divider line
    pdf.setDrawColor(200);
    pdf.setLineWidth(0.5);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 12;

    // Helper to add a labeled row
    const addRow = (label: string, value: string) => {
      if (!value || value === "—") return;
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(100);
      pdf.text(label, margin, y);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(40);
      pdf.text(value, margin + 50, y);
      y += 7;
    };

    // General details
    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(40);
    pdf.text("Document Details", margin, y);
    y += 9;

    addRow("Document Name", doc.document_name);
    addRow("Customer", doc.customers?.name || "Unknown");
    addRow("Created", format(new Date(doc.created_at), "MMM dd, yyyy HH:mm"));
    addRow("Source", doc.isBonzah ? "Bonzah Insurance" : "Uploaded Document");
    if (doc.insurance_provider) addRow("Provider", doc.insurance_provider);
    if (doc.document_type) addRow("Document Type", doc.document_type);
    if (doc.status) addRow("Status", doc.status.charAt(0).toUpperCase() + doc.status.slice(1));

    // For Bonzah policies, add extra details
    if (doc.isBonzah && doc.id.startsWith("bonzah-")) {
      const policyDbId = doc.id.replace("bonzah-", "");
      const policy = bonzahPolicies.find((p: any) => p.id === policyDbId);

      if (policy) {
        y += 5;
        pdf.setDrawColor(200);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 10;

        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(40);
        pdf.text("Bonzah Policy Details", margin, y);
        y += 9;

        if (policy.policy_no) addRow("Policy No", policy.policy_no);
        if (policy.quote_no) addRow("Quote No", policy.quote_no);
        if (policy.policy_type) addRow("Policy Type", policy.policy_type);
        if (policy.premium_amount) addRow("Premium", `$${Number(policy.premium_amount).toFixed(2)}`);
        if (policy.pickup_state) addRow("Pickup State", policy.pickup_state);
        if (policy.trip_start_date) addRow("Trip Start", format(new Date(policy.trip_start_date), "MMM dd, yyyy"));
        if (policy.trip_end_date) addRow("Trip End", format(new Date(policy.trip_end_date), "MMM dd, yyyy"));
        if (policy.policy_issued_at) addRow("Policy Issued", format(new Date(policy.policy_issued_at), "MMM dd, yyyy HH:mm"));

        // Coverage types
        if (policy.coverage_types) {
          const coverages = Array.isArray(policy.coverage_types) ? policy.coverage_types : [];
          if (coverages.length > 0) {
            y += 5;
            pdf.setFontSize(12);
            pdf.setFont("helvetica", "bold");
            pdf.setTextColor(40);
            pdf.text("Coverage Types", margin, y);
            y += 8;

            coverages.forEach((coverage: any) => {
              const name = typeof coverage === "string" ? coverage : coverage?.name || coverage?.type || JSON.stringify(coverage);
              pdf.setFontSize(10);
              pdf.setFont("helvetica", "normal");
              pdf.setTextColor(60);
              pdf.text(`•  ${name}`, margin + 4, y);
              y += 6;
            });
          }
        }

        // Renter details
        if (policy.renter_details && typeof policy.renter_details === "object") {
          const renter = policy.renter_details as Record<string, any>;
          const hasDetails = Object.values(renter).some((v) => v);
          if (hasDetails) {
            y += 5;
            pdf.setDrawColor(200);
            pdf.line(margin, y, pageWidth - margin, y);
            y += 10;

            pdf.setFontSize(12);
            pdf.setFont("helvetica", "bold");
            pdf.setTextColor(40);
            pdf.text("Renter Details", margin, y);
            y += 9;

            if (renter.first_name || renter.last_name) addRow("Name", `${renter.first_name || ""} ${renter.last_name || ""}`.trim());
            if (renter.email) addRow("Email", renter.email);
            if (renter.phone) addRow("Phone", renter.phone);
            if (renter.address) addRow("Address", renter.address);
            if (renter.city) addRow("City", renter.city);
            if (renter.state) addRow("State", renter.state);
            if (renter.zip) addRow("ZIP", renter.zip);
          }
        }
      }
    }

    // Footer
    y = pdf.internal.pageSize.getHeight() - 15;
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(150);
    pdf.text(`Generated on ${format(new Date(), "MMM dd, yyyy HH:mm")} by ${companyName}`, margin, y);
    pdf.text(`Record ${index + 1}`, pageWidth - margin - 20, y);

    const customerName = (doc.customers?.name || "Unknown").replace(/[^a-zA-Z0-9-_ ]/g, "_");
    const docName = doc.document_name.replace(/[^a-zA-Z0-9-_ ]/g, "_").slice(0, 50);
    const fileName = `${customerName}_${docName}.pdf`;

    return { blob: pdf.output("blob"), fileName };
  };

  const handleDownloadAll = useCallback(async () => {
    if (allInsurances.length === 0) {
      toast.error("No insurance records to download");
      return;
    }

    setIsDownloadingAll(true);
    const folderName = `${(tenant?.company_name || tenant?.slug || "tenant").replace(/[^a-zA-Z0-9-_ ]/g, "")}_Insurances`;

    try {
      const zip = new JSZip();
      const folder = zip.folder(folderName)!;
      const usedNames = new Set<string>();

      const getUniqueName = (baseName: string) => {
        let name = baseName;
        let counter = 1;
        while (usedNames.has(name)) {
          const stem = baseName.slice(0, baseName.lastIndexOf("."));
          const ext = baseName.slice(baseName.lastIndexOf("."));
          name = `${stem} (${counter})${ext}`;
          counter++;
        }
        usedNames.add(name);
        return name;
      };

      for (let i = 0; i < allInsurances.length; i++) {
        const { blob, fileName } = generateInsurancePdf(allInsurances[i], i);
        folder.file(getUniqueName(fileName), blob);
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${folderName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(`Downloaded ${allInsurances.length} insurance records as PDFs`);
    } catch (error) {
      console.error("Download all error:", error);
      toast.error("Failed to create download archive");
    } finally {
      setIsDownloadingAll(false);
    }
  }, [allInsurances, bonzahPolicies, tenant]);

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
        <div className="flex items-center gap-2">
          {allInsurances.length > 0 && (
            <Link href="/insurances/analytics">
              <Button variant="outline" size="icon" className="border-primary/20 hover:border-primary/40 hover:bg-primary/5">
                <BarChart3 className="h-4 w-4" />
              </Button>
            </Link>
          )}
          <Button
            onClick={handleDownloadAll}
            disabled={isDownloadingAll || allInsurances.length === 0}
            className="bg-gradient-primary"
          >
            {isDownloadingAll ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Export PDFs
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-indigo-500/10 to-indigo-500/5 border-indigo-500/20">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground">Total Insurances</p>
            <p className="text-2xl font-bold mt-1">{allInsurances.length}</p>
            <p className="text-xs text-muted-foreground mt-1">All insurance records</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-pink-600/10 to-pink-600/5 border-pink-600/20">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground">Bonzah Policies</p>
            <p className="text-2xl font-bold mt-1">{allInsurances.filter(d => d.isBonzah).length}</p>
            <p className="text-xs text-muted-foreground mt-1">Via Bonzah integration</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-violet-500/10 to-violet-500/5 border-violet-500/20">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground">Uploaded</p>
            <p className="text-2xl font-bold mt-1">{allInsurances.filter(d => !d.isBonzah).length}</p>
            <p className="text-xs text-muted-foreground mt-1">Manually uploaded</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground">Active Policies</p>
            <p className="text-2xl font-bold mt-1">{allInsurances.filter(d => d.status === 'active' || d.status === 'confirmed').length}</p>
            <p className="text-xs text-muted-foreground mt-1">Currently active</p>
          </CardContent>
        </Card>
      </div>

      {/* Search + Bonzah Filter */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search by document name or customer..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10 h-8 text-sm"
          />
        </div>
        <button
          onClick={() => {
            setBonzahFilter(!bonzahFilter);
            setCurrentPage(1);
          }}
          className="inline-flex items-center gap-2 px-3 h-8 rounded-md border text-xs font-medium whitespace-nowrap transition-colors shrink-0"
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
              <div className="max-h-[calc(100vh-380px)] min-h-[300px] overflow-auto relative">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
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
              </div>
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
