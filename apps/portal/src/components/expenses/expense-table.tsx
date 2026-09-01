"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Receipt,
  Eye,
  Download,
  MoreVertical,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  FileText,
  ExternalLink,
  Car,
  Building2,
} from "lucide-react";
import { formatCurrency } from "@/lib/format-utils";
import type { Expense } from "@/hooks/use-expenses";

const PAGE_SIZE = 12;

interface Props {
  rows: Expense[];
  currencyCode: string;
  showVehicle: boolean;
  editable: boolean;
  onEdit: (e: Expense) => void;
  onDelete: (e: Expense) => void;
  getReceiptUrl: (path: string, opts?: { download?: boolean }) => Promise<string | null>;
}

export function ExpenseTable({
  rows,
  currencyCode,
  showVehicle,
  editable,
  onEdit,
  onDelete,
  getReceiptUrl,
}: Props) {
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState<{ url: string; isPdf: boolean } | null>(null);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [pageCount, page]);

  const pageRows = useMemo(
    () => rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [rows, page]
  );

  const viewReceipt = async (path: string) => {
    const url = await getReceiptUrl(path);
    if (url) setPreview({ url, isPdf: path.toLowerCase().endsWith(".pdf") });
  };
  const downloadReceipt = async (path: string) => {
    const url = await getReceiptUrl(path, { download: true });
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.click();
    }
  };

  const colCount = 4 + (showVehicle ? 1 : 0) + (editable ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border/60">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary/5 hover:bg-primary/5">
              <TableHead>Date &amp; time</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              {showVehicle && <TableHead>Vehicle</TableHead>}
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-24 text-center">Receipt</TableHead>
              {editable && <TableHead className="w-12 text-right" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-12">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <Receipt className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground">No expenses yet</p>
                    <p className="text-sm text-muted-foreground">
                      Add an expense to start tracking.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {format(new Date(e.expense_at), "dd MMM yyyy")}
                    <span className="ml-1 text-muted-foreground">
                      {format(new Date(e.expense_at), "HH:mm")}
                    </span>
                  </TableCell>
                  <TableCell>
                    {e.vehicle_id ? (
                      <Badge variant="secondary" className="gap-1 font-normal">
                        <Car className="h-3 w-3" />
                        Vehicle
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 font-normal">
                        <Building2 className="h-3 w-3" />
                        Business
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{e.category}</TableCell>
                  {showVehicle && (
                    <TableCell className="text-sm">
                      {e.vehicle?.reg ? (
                        <span>
                          {e.vehicle.reg}
                          <span className="text-muted-foreground">
                            {" "}
                            · {e.vehicle.make} {e.vehicle.model}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(Number(e.amount), currencyCode)}
                  </TableCell>
                  <TableCell>
                    {e.receipt_url ? (
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-primary"
                          title="Preview"
                          onClick={() => viewReceipt(e.receipt_url!)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          title="Download"
                          onClick={() => downloadReceipt(e.receipt_url!)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="text-center text-muted-foreground">—</div>
                    )}
                  </TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(e)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => onDelete(e)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {rows.length > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {page * PAGE_SIZE + 1}–{Math.min(rows.length, page * PAGE_SIZE + PAGE_SIZE)} of{" "}
            {rows.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">
              {page + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Receipt preview */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 pr-6">
              <span className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Receipt
              </span>
              {preview && (
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-normal text-primary hover:underline"
                >
                  Open in new tab
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </DialogTitle>
          </DialogHeader>
          {preview &&
            (preview.isPdf ? (
              <iframe src={preview.url} title="Receipt" className="h-[70vh] w-full rounded-md border" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.url}
                alt="Receipt"
                className="max-h-[70vh] w-full rounded-md border object-contain"
              />
            ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}
