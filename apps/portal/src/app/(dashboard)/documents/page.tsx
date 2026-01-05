"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FileText, Download, ExternalLink, Search, CalendarIcon, X } from "lucide-react";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { format, isAfter, isBefore, startOfDay, endOfDay } from "date-fns";
import { useState, useMemo } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
}

export default function DocumentsList() {
  const [searchQuery, setSearchQuery] = useState("");
  const [docType, setDocType] = useState("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const { tenant } = useTenant();

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

  const isLoading = isLoadingCompleted || isLoadingRentals;

  // Combine both types of documents
  const allDocuments = [
    ...completedDocuments,
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
      }))
  ] as Document[];

  const documents = allDocuments;

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      // Search filter
      if (searchQuery.trim()) {
        const matchesSearch = doc.document_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                             doc.customers?.name?.toLowerCase().includes(searchQuery.toLowerCase());
        if (!matchesSearch) return false;
      }

      // Type filter
      if (docType !== "all") {
        if (docType === "agreement" && !doc.isRentalAgreement) return false;
        if (docType === "document" && doc.isRentalAgreement) return false;
      }

      // Date filter
      const docDate = new Date(doc.created_at);
      if (dateFrom && isBefore(docDate, startOfDay(dateFrom))) return false;
      if (dateTo && isAfter(docDate, endOfDay(dateTo))) return false;

      return true;
    });
  }, [documents, searchQuery, docType, dateFrom, dateTo]);

  const clearFilters = () => {
    setSearchQuery("");
    setDocType("all");
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const hasActiveFilters = searchQuery || docType !== "all" || dateFrom || dateTo;

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

      {/* Search and Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[250px] max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search by document name or customer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="document">Documents</SelectItem>
            <SelectItem value="agreement">Agreements</SelectItem>
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "justify-start text-left font-normal",
                !dateFrom && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateFrom ? format(dateFrom, "dd/MM/yyyy") : "From"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateFrom}
              onSelect={setDateFrom}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "justify-start text-left font-normal",
                !dateTo && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateTo ? format(dateTo, "dd/MM/yyyy") : "To"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateTo}
              onSelect={setDateTo}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>

        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1">
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}
      </div>

      {/* Documents Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            All Documents
          </CardTitle>
          <CardDescription>
            Showing {filteredDocuments.length} of {documents.length} documents
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredDocuments.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents found"
              description={searchQuery
                ? "No documents match your search criteria"
                : "There are no documents in the system yet."}
            />
          ) : (
            <div className="rounded-md border">
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
                  {filteredDocuments.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium max-w-[180px]">
                        <span
                          className="truncate block"
                          title={doc.document_name}
                        >
                          {doc.document_name.length > 25
                            ? doc.document_name.slice(0, 25) + "..."
                            : doc.document_name}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium text-foreground max-w-[150px]">
                        <span
                          className="truncate block"
                          title={doc.customers?.name}
                        >
                          {(doc.customers?.name?.length || 0) > 20
                            ? doc.customers?.name?.slice(0, 20) + "..."
                            : doc.customers?.name || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{format(new Date(doc.created_at), "dd/MM/yyyy")}</div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(doc.created_at), "h:mm a")}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {doc.file_url ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDownload(doc.file_url!, doc.file_name || doc.document_name)}
                                title="Download"
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleView(doc.file_url!)}
                                title="View"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </>
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
