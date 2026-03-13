"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FileSignature, Download, ExternalLink, Loader2, Search, BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { format } from "date-fns";
import { useState, useMemo, useCallback } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import Link from "next/link";
import JSZip from "jszip";
import { jsPDF } from "jspdf";

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
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

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

  const generateAgreementPdf = (doc: AgreementDoc, index: number): { blob: Blob; fileName: string } => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 20;
    let y = 25;

    const companyName = tenant?.company_name || tenant?.slug || "Drive247";
    pdf.setFontSize(18);
    pdf.setFont("helvetica", "bold");
    pdf.text(companyName, margin, y);
    y += 8;
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(100);
    pdf.text("Agreement Record", margin, y);
    y += 4;

    pdf.setDrawColor(200);
    pdf.setLineWidth(0.5);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 12;

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

    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(40);
    pdf.text("Agreement Details", margin, y);
    y += 9;

    addRow("Agreement Name", doc.document_name);
    addRow("Customer", doc.customers?.name || "Unknown");
    addRow("Created", format(new Date(doc.created_at), "MMM dd, yyyy HH:mm"));
    addRow("Type", doc.agreementType === "original" ? "Original Rental Agreement" : doc.agreementType === "extension" ? "Extension Agreement" : "Signed Agreement");
    addRow("Status", doc.isRentalAgreement ? "Pending Signature" : "Signed");
    if (doc.document_type) addRow("Document Type", doc.document_type);

    // For rental agreements, look up extra rental details
    if (doc.isRentalAgreement && doc.agreementType === "original") {
      const rental = rentalAgreements.find((r: any) => r.id === doc.id);
      if (rental) {
        y += 5;
        pdf.setDrawColor(200);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 10;
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(40);
        pdf.text("Rental Details", margin, y);
        y += 9;

        const vehicle = (rental as any).vehicles;
        if (vehicle) addRow("Vehicle", `${vehicle.reg} - ${vehicle.make} ${vehicle.model}`);
        addRow("Document Status", (rental as any).document_status || "Pending");
      }
    }

    if (doc.isRentalAgreement && doc.agreementType === "extension") {
      const ext = extensionAgreements.find((a: any) => a.id === doc.id);
      if (ext) {
        y += 5;
        pdf.setDrawColor(200);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 10;
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(40);
        pdf.text("Extension Details", margin, y);
        y += 9;

        const vehicle = (ext as any).rentals?.vehicles;
        if (vehicle) addRow("Vehicle", `${vehicle.reg} - ${vehicle.make} ${vehicle.model}`);
        addRow("Agreement Type", "Extension");
        addRow("Document Status", (ext as any).document_status || "Pending");
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
    if (allAgreements.length === 0) {
      toast.error("No agreement records to download");
      return;
    }

    setIsDownloadingAll(true);
    const folderName = `${(tenant?.company_name || tenant?.slug || "tenant").replace(/[^a-zA-Z0-9-_ ]/g, "")}_Agreements`;

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

      for (let i = 0; i < allAgreements.length; i++) {
        const { blob, fileName } = generateAgreementPdf(allAgreements[i], i);
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

      toast.success(`Downloaded ${allAgreements.length} agreement records as PDFs`);
    } catch (error) {
      console.error("Download all error:", error);
      toast.error("Failed to create download archive");
    } finally {
      setIsDownloadingAll(false);
    }
  }, [allAgreements, rentalAgreements, extensionAgreements, tenant]);

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
        <div className="flex items-center gap-2">
          {allAgreements.length > 0 && (
            <Link href="/agreements/analytics">
              <Button variant="outline" size="icon" className="border-primary/20 hover:border-primary/40 hover:bg-primary/5">
                <BarChart3 className="h-4 w-4" />
              </Button>
            </Link>
          )}
          <Button
            onClick={handleDownloadAll}
            disabled={isDownloadingAll || allAgreements.length === 0}
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
            <p className="text-sm font-medium text-muted-foreground">Total Agreements</p>
            <p className="text-2xl font-bold mt-1">{allAgreements.length}</p>
            <p className="text-xs text-muted-foreground mt-1">All agreement types</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-violet-500/10 to-violet-500/5 border-violet-500/20">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground">Original</p>
            <p className="text-2xl font-bold mt-1">{rentalAgreements.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Rental agreements</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-cyan-500/10 to-cyan-500/5 border-cyan-500/20">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground">Extensions</p>
            <p className="text-2xl font-bold mt-1">{extensionAgreements.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Extension agreements</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground">Signed</p>
            <p className="text-2xl font-bold mt-1">{signedAgreements.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Completed signatures</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search by agreement name or customer..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10 h-8 text-sm"
          />
        </div>
      </div>

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
              <div className="max-h-[calc(100vh-380px)] min-h-[300px] overflow-auto relative">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
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
              </div>
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
