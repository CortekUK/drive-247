"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Download, ExternalLink, CheckCircle, XCircle } from "lucide-react";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { format } from "date-fns";
import { useState } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { Input } from "@/components/ui/input";
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
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  // Mutation for approving documents
  const approveDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await supabase
        .from("customer_documents")
        .update({
          verified: true,
          status: "Active",
          updated_at: new Date().toISOString()
        })
        .eq("id", documentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["completed-documents"] });
      toast.success("Document approved successfully");
    },
    onError: () => {
      toast.error("Failed to approve document");
    },
  });

  // Mutation for rejecting documents
  const rejectDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await supabase
        .from("customer_documents")
        .update({
          verified: false,
          status: "Expired",
          updated_at: new Date().toISOString()
        })
        .eq("id", documentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["completed-documents"] });
      toast.success("Document rejected");
    },
    onError: () => {
      toast.error("Failed to reject document");
    },
  });

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

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch = doc.document_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         doc.customers?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

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

  const getDocumentTypeColor = (type?: string) => {
    switch (type?.toLowerCase()) {
      case "contract":
      case "agreement":
        return "default";
      case "invoice":
        return "secondary";
      case "receipt":
        return "outline";
      default:
        return "outline";
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status?.toLowerCase()) {
      case "signed":
      case "completed":
        return "default";
      case "sent":
        return "secondary";
      case "pending":
        return "outline";
      default:
        return "outline";
    }
  };

  const getStatusLabel = (status?: string) => {
    if (!status) return "—";
    // Capitalize first letter
    const capitalized = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
    // Replace "Active" with "Completed"
    return capitalized === "Active" ? "Completed" : capitalized;
  };

  const getFileIcon = (mimeType?: string) => {
    if (mimeType?.includes("pdf")) return "PDF";
    if (mimeType?.includes("image")) return "IMG";
    if (mimeType?.includes("word") || mimeType?.includes("document")) return "DOC";
    return "FILE";
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

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <Input
            placeholder="Search by document name or customer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
        </CardContent>
      </Card>

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
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDocuments.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium">{doc.document_name}</TableCell>
                      <TableCell className="font-medium text-foreground">
                        {doc.customers?.name || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(doc.created_at), "MMM dd, yyyy HH:mm")}
                      </TableCell>
                      <TableCell>
                        {doc.status ? (
                          (doc.status?.toLowerCase() === "completed" || 
                           doc.status?.toLowerCase() === "signed" || 
                           doc.status?.toLowerCase() === "active") ? (
                            <span 
                              className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                              style={{
                                backgroundColor: "#22c55e",
                                color: "#ffffff",
                                borderColor: "transparent",
                                borderWidth: "1px"
                              }}
                            >
                              {getStatusLabel(doc.status)}
                            </span>
                          ) : (
                            <Badge variant={getStatusColor(doc.status)}>
                              {getStatusLabel(doc.status)}
                            </Badge>
                          )
                        ) : (
                          "—"
                        )}
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
                              {/* Approve/Reject buttons for pending documents */}
                              {!doc.isRentalAgreement && doc.status?.toLowerCase() !== "active" && !doc.verified && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                    onClick={() => approveDocumentMutation.mutate(doc.id)}
                                    disabled={approveDocumentMutation.isPending || rejectDocumentMutation.isPending}
                                    title="Approve document"
                                  >
                                    <CheckCircle className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    onClick={() => rejectDocumentMutation.mutate(doc.id)}
                                    disabled={approveDocumentMutation.isPending || rejectDocumentMutation.isPending}
                                    title="Reject document"
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
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
