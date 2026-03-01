"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FileText, Download, ExternalLink, X } from "lucide-react";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { format } from "date-fns";
import { useState } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface Document {
  id: string;
  document_name: string;
  file_name?: string;
  file_url?: string | null;
  mime_type?: string;
  created_at: string;
  document_type?: string;
  status?: string;
  verified?: boolean;
  customer_id: string;
  customers?: {
    name: string;
  };
  isRentalAgreement?: boolean;
  isBonzah?: boolean;
  insurance_provider?: string | null;
  rental_id?: string | null;
}

export default function DocumentsList() {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [bonzahFilter, setBonzahFilter] = useState(false);
  const { tenant } = useTenant();
  const router = useRouter();

  // Fetch completed documents from customer_documents table
  const { data: completedDocuments = [], isLoading: isLoadingCompleted } = useQuery({
    queryKey: ["completed-documents", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("customer_documents")
        .select(`
          *,
          customers!customer_documents_customer_id_fkey(name)
        `)
        .order("created_at", { ascending: false });

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as Document[];
    },
    enabled: !!tenant,
  });

  // Fetch rental agreements (including pending/sent DocuSign)
  const { data: rentalAgreements = [], isLoading: isLoadingRentals } = useQuery({
    queryKey: ["rental-agreements", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("rentals")
        .select(`
          id,
          created_at,
          document_status,
          signed_document_id,
          customers!rentals_customer_id_fkey(name),
          vehicles!rentals_vehicle_id_fkey(reg, make, model)
        `)
        .order("created_at", { ascending: false });

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data;
    },
    enabled: !!tenant,
  });

  // Fetch Bonzah insurance policies
  const { data: bonzahPolicies = [], isLoading: isLoadingBonzah } = useQuery({
    queryKey: ["bonzah-policies-docs", tenant?.id],
    queryFn: async () => {
      let query = supabase
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
        .order("created_at", { ascending: false });

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data;
    },
    enabled: !!tenant,
  });

  const isLoading = isLoadingCompleted || isLoadingRentals || isLoadingBonzah;

  // Combine all types of documents
  const allDocuments = [
    ...completedDocuments.map((doc: any) => ({
      ...doc,
      isBonzah: doc.insurance_provider?.toLowerCase().includes('bonzah') || false,
    })),
    ...rentalAgreements
      .filter((rental: any) => !rental.signed_document_id) // Only show if not yet completed
      .map((rental: any) => ({
        id: rental.id,
        document_name: `Rental Agreement - ${rental.vehicles?.reg || 'Vehicle'}`,
        created_at: rental.created_at,
        document_type: 'Agreement',
        status: rental.document_status || 'pending',
        customer_id: rental.customers?.id,
        customers: rental.customers,
        file_url: null,
        isRentalAgreement: true,
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
  ] as Document[];

  const documents = allDocuments;

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch = doc.document_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         doc.customers?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesBonzah = !bonzahFilter || doc.isBonzah;
    return matchesSearch && matchesBonzah;
  });

  // Pagination
  const totalDocuments = filteredDocuments.length;
  const totalPages = Math.ceil(totalDocuments / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalDocuments);
  const paginatedDocuments = filteredDocuments.slice(startIndex, endIndex);

  // Reset page when search changes
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const getPublicUrl = (filePath: string) => {
    // If it's already a full URL, return as is
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }
    // Otherwise, get the public URL from Supabase Storage
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Documents</h1>
          <p className="text-muted-foreground">
            All customer documents and agreements
          </p>
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
          Insurance
          {bonzahFilter && <X className="ml-1 h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Documents Table */}
      {paginatedDocuments.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents found"
          description={searchQuery || bonzahFilter
            ? "No documents match your search criteria"
            : "There are no documents in the system yet."}
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
                          ) : doc.isRentalAgreement ? (
                            <span className="text-sm text-muted-foreground">Pending signature</span>
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
              Showing {startIndex + 1}-{endIndex} of {totalDocuments} documents
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
