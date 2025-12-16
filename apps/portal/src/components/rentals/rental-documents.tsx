import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Download, ExternalLink } from "lucide-react";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { format } from "date-fns";

interface RentalDocumentsProps {
  rentalId: string;
}

interface Document {
  id: string;
  document_name: string;
  file_name?: string;
  file_url?: string;
  mime_type?: string;
  created_at: string;
  document_type?: string;
  status?: string;
}

export const RentalDocuments = ({ rentalId }: RentalDocumentsProps) => {
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["rental-documents", rentalId],
    queryFn: async () => {
      // Get the rental to find customer_id
      const { data: rental, error: rentalError } = await supabase
        .from("rentals")
        .select("customer_id, signed_document_id")
        .eq("id", rentalId)
        .single();

      if (rentalError) throw rentalError;

      // Get all documents for this customer
      const { data, error } = await supabase
        .from("customer_documents")
        .select("*")
        .eq("customer_id", rental.customer_id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Document[];
    },
    enabled: !!rentalId,
  });

  const handleDownload = (fileUrl: string, fileName: string) => {
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = fileName;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

  const getFileIcon = (mimeType?: string) => {
    if (mimeType?.includes("pdf")) return "PDF";
    if (mimeType?.includes("image")) return "IMG";
    if (mimeType?.includes("word") || mimeType?.includes("document")) return "DOC";
    return "FILE";
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading documents...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Documents
        </CardTitle>
        <CardDescription>
          All documents related to this rental agreement
        </CardDescription>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents found"
            description="There are no documents associated with this rental yet."
          />
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">Type</TableHead>
                  <TableHead>Document Name</TableHead>
                  <TableHead>File Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Document Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="text-2xl">{getFileIcon(doc.mime_type)}</TableCell>
                    <TableCell className="font-medium">{doc.document_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {doc.file_name || "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(doc.created_at), "MMM dd, yyyy")}
                    </TableCell>
                    <TableCell>
                      {doc.document_type ? (
                        <Badge variant={getDocumentTypeColor(doc.document_type)}>
                          {doc.document_type}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {doc.status ? (
                        <Badge variant={getStatusColor(doc.status)}>
                          {doc.status}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {doc.file_url && (
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
                              onClick={() => window.open(doc.file_url, "_blank")}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </>
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
  );
};
