"use client";

import { useMemo, useRef, useState } from "react";
import { Upload, FileWarning, CheckCircle2, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useTenant } from "@/contexts/TenantContext";
import { useFleetHealthCsvImport, useMatchableVehicles } from "@/hooks/use-fleet-health-import";
import {
  parseFleetHealthCsv,
  CSV_TEMPLATE,
  type CsvParseResult,
} from "@/lib/fleet-health-csv";
import { getDistanceUnitLong, type DistanceUnit } from "@/lib/format-utils";

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Bulk setup for a fleet that keeps its numbers in a spreadsheet (spec F1 §6).
 *
 * The screen is a preview, not a submit button: the file is parsed in the
 * browser and the operator sees exactly what will be written and exactly which
 * rows will not be, with line numbers, BEFORE anything is inserted. The largest
 * real fleets are at zero odometer coverage, so this is often the difference
 * between a working Fleet Health and twenty-two rows of "Unknown".
 */
export function CsvImportDialog({ open, onOpenChange }: CsvImportDialogProps) {
  const { tenant } = useTenant();
  const { data: vehicles = [] } = useMatchableVehicles();
  const importer = useFleetHealthCsvImport();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<CsvParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const unit = (tenant?.distance_unit || "miles") as DistanceUnit;

  const matchable = useMemo(
    () => vehicles.map((v) => ({ id: v.id, reg: v.reg ?? null })),
    [vehicles],
  );

  const reset = () => {
    setFileName(null);
    setResult(null);
    setParseError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    setParseError(null);
    // Guard the read itself: a mis-picked 40MB export should say so rather than
    // freeze the tab parsing it.
    if (file.size > 5 * 1024 * 1024) {
      setParseError("That file is over 5MB. Fleet Health setup expects one row per vehicle.");
      return;
    }
    try {
      const text = await file.text();
      setFileName(file.name);
      setResult(parseFleetHealthCsv(text, matchable));
    } catch {
      setParseError("Could not read that file.");
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fleet-health-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const runImport = async () => {
    if (!result?.rows.length) return;
    await importer.mutateAsync(result.rows);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from a spreadsheet</DialogTitle>
          <DialogDescription>
            One row per vehicle. A <code>reg</code> column is required;{" "}
            <code>odometer</code>, <code>last_service_date</code> and{" "}
            <code>last_service_mileage</code> are each optional. Distances are read in{" "}
            {getDistanceUnitLong(unit)}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              Choose CSV
            </Button>
            <Button variant="ghost" onClick={downloadTemplate}>
              <Download className="mr-2 h-4 w-4" />
              Download template
            </Button>
            {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
          </div>

          {parseError && (
            <p className="text-sm text-red-600 dark:text-red-400">{parseError}</p>
          )}

          {result && (
            <>
              <Separator />
              <div className="flex items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  {result.rows.length} row{result.rows.length === 1 ? "" : "s"} ready
                </span>
                {result.rejected.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                    <FileWarning className="h-4 w-4" />
                    {result.rejected.length} skipped
                  </span>
                )}
              </div>

              {result.ignoredColumns.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Columns ignored: {result.ignoredColumns.join(", ")}
                </p>
              )}

              {result.rejected.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-md border border-[#f1f5f9] dark:border-gray-800">
                  <table className="w-full text-sm">
                    <thead className="bg-[#eef2ff] dark:bg-gray-800/60">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Line</th>
                        <th className="px-3 py-2 text-left font-medium">Registration</th>
                        <th className="px-3 py-2 text-left font-medium">Why it was skipped</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rejected.map((r, i) => (
                        <tr key={i} className="border-t border-[#f1f5f9] dark:border-gray-800">
                          <td className="px-3 py-1.5 tabular-nums">{r.line}</td>
                          <td className="px-3 py-1.5">{r.reg || "—"}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={runImport}
            disabled={!result?.rows.length || importer.isPending}
          >
            {importer.isPending
              ? "Importing…"
              : `Import ${result?.rows.length ?? 0} vehicle${result?.rows.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
