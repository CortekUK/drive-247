"use client";

import { useState, type RefObject } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { format } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format-utils";
import { csvEscape } from "@/lib/expense-utils";
import type { Expense } from "@/hooks/use-expenses";

interface Props {
  rows: Expense[];
  currencyCode: string;
  scopeLabel: string;
  /** Charts container to snapshot into the PDF. */
  captureRef?: RefObject<HTMLElement | null>;
  summary?: string;
}

export function ExpenseExportButtons({ rows, currencyCode, scopeLabel, captureRef, summary }: Props) {
  const [busy, setBusy] = useState(false);

  const fileStamp = format(new Date(), "yyyy-MM-dd");
  const slug = scopeLabel.toLowerCase().replace(/[^a-z]+/g, "-");

  const exportCsv = () => {
    const headers = ["Date & time", "Type", "Category", "Vehicle", "Amount"];
    const lines = rows.map((e) =>
      [
        format(new Date(e.expense_at), "yyyy-MM-dd HH:mm"),
        e.vehicle_id ? "Vehicle" : "Business",
        e.category,
        e.vehicle?.reg ?? "",
        Number(e.amount).toFixed(2),
      ]
        .map(csvEscape)
        .join(",")
    );
    const csv = [headers.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${slug}-${fileStamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    setBusy(true);
    try {
      const [{ default: jsPDF }, html2canvas] = await Promise.all([
        import("jspdf"),
        import("html2canvas").then((m) => m.default),
      ]);
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 40;
      let y = margin;

      doc.setFontSize(18);
      doc.setTextColor(20, 20, 30);
      doc.text(`Expenses — ${scopeLabel}`, margin, y);
      y += 18;
      doc.setFontSize(10);
      doc.setTextColor(120, 120, 130);
      doc.text(`Generated ${format(new Date(), "dd MMM yyyy, HH:mm")}`, margin, y);
      y += 14;

      const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0);
      doc.setTextColor(20, 20, 30);
      doc.text(
        `${rows.length} expense(s) · Total ${formatCurrency(total, currencyCode)}`,
        margin,
        y
      );
      y += 16;

      if (summary) {
        doc.setFontSize(10);
        doc.setTextColor(80, 80, 90);
        const wrapped = doc.splitTextToSize(summary, pageW - margin * 2);
        doc.text(wrapped, margin, y);
        y += wrapped.length * 12 + 8;
      }

      // Chart snapshot.
      if (captureRef?.current) {
        const canvas = await html2canvas(captureRef.current, {
          scale: 2,
          backgroundColor: null,
          logging: false,
        });
        const img = canvas.toDataURL("image/png");
        const imgW = pageW - margin * 2;
        const imgH = (canvas.height / canvas.width) * imgW;
        if (y + imgH > pageH - margin) {
          doc.addPage();
          y = margin;
        }
        doc.addImage(img, "PNG", margin, y, imgW, imgH);
        y += imgH + 16;
      }

      // Transactions table (simple columnar layout with pagination).
      const cols = [
        { label: "Date", x: margin, w: 110 },
        { label: "Type", x: margin + 110, w: 60 },
        { label: "Category", x: margin + 170, w: 130 },
        { label: "Vehicle", x: margin + 300, w: 100 },
        { label: "Amount", x: pageW - margin - 80, w: 80 },
      ];
      const drawHeader = () => {
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 130);
        cols.forEach((c) =>
          doc.text(c.label, c.label === "Amount" ? c.x + c.w : c.x, y, {
            align: c.label === "Amount" ? "right" : "left",
          })
        );
        y += 6;
        doc.setDrawColor(225, 225, 230);
        doc.line(margin, y, pageW - margin, y);
        y += 12;
      };
      if (y + 40 > pageH - margin) {
        doc.addPage();
        y = margin;
      }
      drawHeader();

      doc.setFontSize(9);
      for (const e of rows) {
        if (y > pageH - margin) {
          doc.addPage();
          y = margin;
          drawHeader();
        }
        doc.setTextColor(40, 40, 50);
        doc.text(format(new Date(e.expense_at), "dd MMM yy HH:mm"), cols[0].x, y);
        doc.text(e.vehicle_id ? "Vehicle" : "Business", cols[1].x, y);
        doc.text(doc.splitTextToSize(e.category, cols[2].w - 6)[0] || "", cols[2].x, y);
        doc.text(
          doc.splitTextToSize(e.vehicle?.reg ?? "—", cols[3].w - 6)[0] || "—",
          cols[3].x,
          y
        );
        doc.text(formatCurrency(Number(e.amount), currencyCode), cols[4].x + cols[4].w, y, {
          align: "right",
        });
        y += 16;
      }

      doc.save(`expenses-${slug}-${fileStamp}.pdf`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy || rows.length === 0}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={exportCsv}>
          <FileText className="mr-2 h-4 w-4" />
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportPdf}>
          <FileText className="mr-2 h-4 w-4" />
          Export PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
