"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus,
  FileImage,
  Search,
  ExternalLink,
  Trash2,
  Sparkles,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import {
  useInsuranceVerifications,
  useDeleteInsuranceVerification,
  type InsuranceVerification,
} from "@/hooks/use-insurance-verifications";
import { VerificationStatusChip } from "./verification-score-badge";
import { VerificationUploadDialog } from "./verification-upload-dialog";
import { AttachVerificationDialog } from "./attach-verification-dialog";
import { VerificationDetailSheet } from "./verification-detail-sheet";

export function VerificationsTab() {
  const { data: verifications = [], isLoading } = useInsuranceVerifications();
  const del = useDeleteInsuranceVerification();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const selected = useMemo(
    () => verifications.find((v) => v.id === selectedId) ?? null,
    [verifications, selectedId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return verifications;
    return verifications.filter((v) => {
      const ex = v.extracted_fields;
      return [
        v.file_name,
        v.rentals?.rental_number,
        v.rentals?.customers?.name,
        ex?.insurer,
        ex?.policy_number,
        ex?.policy_holder,
      ]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });
  }, [verifications, search]);

  const openDetail = (v: InsuranceVerification) => {
    setSelectedId(v.id);
    setDetailOpen(true);
  };

  const openAttach = (id: string) => {
    setSelectedId(id);
    setDetailOpen(false);
    setAttachOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this verification? This cannot be undone.")) return;
    try {
      await del.mutateAsync(id);
      toast.success("Verification deleted");
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search verifications…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-9 text-sm"
          />
        </div>
        <Button onClick={() => setUploadOpen(true)} className="bg-gradient-primary">
          <Plus className="h-4 w-4 mr-2" />
          Verify Insurance
        </Button>
      </div>

      {isLoading ? (
        <div className="h-48 bg-muted animate-pulse rounded" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={search ? "No matching verifications" : "No insurance verifications yet"}
          description={
            search
              ? "Try a different search term."
              : "Upload an insurance document to have AI check legitimacy and extract details."
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader className="bg-indigo-50/60 dark:bg-indigo-950/30">
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Insurer / Policy</TableHead>
                    <TableHead>AI Result</TableHead>
                    <TableHead>Attached Rental</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((v) => {
                    const ex = v.extracted_fields;
                    return (
                      <TableRow
                        key={v.id}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => openDetail(v)}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <FileImage className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-[220px]">
                              {v.file_name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {ex?.insurer || ex?.policy_number ? (
                            <div>
                              <div className="font-medium">
                                {ex?.insurer || "—"}
                              </div>
                              <div className="text-xs text-muted-foreground font-mono">
                                {ex?.policy_number || ""}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <VerificationStatusChip
                            status={v.status}
                            score={v.ai_score}
                          />
                        </TableCell>
                        <TableCell>
                          {v.rental_id ? (
                            <Link
                              href={`/rentals/${v.rental_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-indigo-600 hover:underline text-sm font-medium"
                            >
                              {v.rentals?.rental_number ||
                                v.rental_id.slice(0, 8)}
                            </Link>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-muted-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                openAttach(v.id);
                              }}
                            >
                              <Link2 className="h-3.5 w-3.5 mr-1.5" />
                              Attach
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(v.created_at), "MMM dd, yyyy")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {v.file_url && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                asChild
                                onClick={(e) => e.stopPropagation()}
                              >
                                <a
                                  href={v.file_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-red-600 hover:text-red-700"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(v.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <VerificationUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
      />
      <VerificationDetailSheet
        verification={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onAttachClick={openAttach}
      />
      <AttachVerificationDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        verificationId={selectedId}
        currentRentalId={selected?.rental_id ?? null}
      />
    </div>
  );
}
