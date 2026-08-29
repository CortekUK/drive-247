"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload, XCircle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useCustomerImport, type ImportFailure } from "@/hooks/use-customer-import";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import {
  MAX_BYTES,
  MAX_ROWS,
  collectWarnings,
  parseCustomersCsv,
  type CustomerCsvResult,
  type ImportWarning,
} from "@/lib/customers-csv";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Stage = "choose" | "review" | "done";

export function CustomerCsvImportDialog({ open, onOpenChange }: Props) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const importer = useCustomerImport();
  const fileRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("choose");
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<CustomerCsvResult | null>(null);
  const [warnings, setWarnings] = useState<ImportWarning[]>([]);
  const [outcome, setOutcome] = useState<{ inserted: number; failed: ImportFailure[] } | null>(null);
  const [precheckFailed, setPrecheckFailed] = useState(false);

  const reset = () => {
    setStage("choose");
    setFileName("");
    setResult(null);
    setWarnings([]);
    setOutcome(null);
    setPrecheckFailed(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = (next: boolean) => {
    // Closing mid-insert would orphan the run with no feedback.
    if (!next && importer.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFile = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast({
        title: "File too large",
        description: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_BYTES / 1024 / 1024}MB.`,
        variant: "destructive",
      });
      return;
    }

    setParsing(true);
    setFileName(file.name);
    try {
      const text = await file.text();

      // First pass discovers which emails and licences the file actually uses, so
      // we ask the database only about those instead of pulling the whole book —
      // which PostgREST silently caps, quietly missing duplicates.
      const firstPass = parseCustomersCsv(text);
      const emails = firstPass.rows.map((r) => r.email).filter(Boolean) as string[];
      const licences = firstPass.rows.map((r) => r.licenseNumber).filter(Boolean) as string[];

      // A single .in() list becomes a GET URL and the gateway rejects it well
      // before MAX_ROWS — measured around 1,200 real licence numbers. Chunk it.
      const CHUNK = 300;
      const lookup = async (column: string, values: string[]): Promise<string[] | null> => {
        const found: string[] = [];
        for (let i = 0; i < values.length; i += CHUNK) {
          const { data, error } = await supabase
            .from("customers")
            .select(column)
            .in(column, values.slice(i, i + CHUNK));
          // A failed pre-check must NOT look like "no conflicts found".
          if (error) return null;
          for (const r of data ?? []) {
            const v = (r as Record<string, unknown>)[column];
            if (v) found.push(String(v));
          }
        }
        return found;
      };

      const existingEmails = new Set<string>();
      let precheckOk = true;

      if (emails.length > 0 && tenant?.id) {
        // Email uniqueness is per tenant, so scope it.
        const found: string[] = [];
        for (let i = 0; i < emails.length; i += CHUNK) {
          const { data, error } = await supabase
            .from("customers")
            .select("email")
            .eq("tenant_id", tenant.id)
            .in("email", emails.slice(i, i + CHUNK));
          if (error) { precheckOk = false; break; }
          for (const r of data ?? []) if (r.email) found.push(String(r.email));
        }
        for (const e of found) existingEmails.add(e.toLowerCase());
      }

      // Licence uniqueness is GLOBAL — this index carries no tenant predicate.
      const existingLicenses = new Set<string>();
      if (precheckOk && licences.length > 0) {
        const found = await lookup("license_number", licences);
        if (found === null) precheckOk = false;
        else for (const l of found) existingLicenses.add(l);
      }

      setPrecheckFailed(!precheckOk);
      const parsed = parseCustomersCsv(text, { existingEmails, existingLicenses });

      setResult(parsed);
      setWarnings(collectWarnings(parsed.rows));
      setStage("review");
    } catch (err: any) {
      toast({
        title: "Could not read that file",
        description: err?.message ?? "Make sure it is a .csv file saved as UTF-8.",
        variant: "destructive",
      });
      reset();
    } finally {
      setParsing(false);
    }
  };

  const runImport = async () => {
    if (!result) return;
    try {
      const res = await importer.mutateAsync(result.rows);
      setOutcome(res);
      setStage("done");
      toast({
        title: res.failed.length === 0 ? "Customers imported" : "Imported with some failures",
        description: `${res.inserted} added${res.failed.length ? `, ${res.failed.length} could not be added` : ""}.`,
        variant: res.failed.length === 0 ? undefined : "destructive",
      });
    } catch (err: any) {
      toast({
        title: "Import failed",
        description: err?.message ?? "Nothing was imported.",
        variant: "destructive",
      });
    }
  };

  const rows = result?.rows ?? [];
  const rejected = result?.rejected ?? [];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import customers from CSV
          </DialogTitle>
          <DialogDescription>
            Bring your customers across from another system. Nothing is saved until you confirm.
          </DialogDescription>
        </DialogHeader>

        {stage === "choose" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
              <div className="text-sm text-muted-foreground">
                Choose a .csv file exported from your previous system
              </div>
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
              <Button onClick={() => fileRef.current?.click()} disabled={parsing}>
                {parsing ? "Reading..." : "Choose file"}
              </Button>
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                <strong>Name</strong> is required — either a single Name column, or First Name and Last
                Name. Everything else is optional.
              </p>
              <p>
                We also recognise Email, Phone, Address, City, State, ZIP, Driver&apos;s License, Date of
                Birth, Status and Date Created. Blank cells stay blank.
              </p>
              <p>Up to {MAX_ROWS.toLocaleString()} rows per file.</p>
            </div>
          </div>
        )}

        {stage === "review" && result && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-semibold text-emerald-600">{rows.length}</div>
                <div className="text-xs text-muted-foreground">Ready to import</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-semibold text-rose-600">{rejected.length}</div>
                <div className="text-xs text-muted-foreground">Cannot import</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-semibold text-amber-600">{warnings.length}</div>
                <div className="text-xs text-muted-foreground">Worth checking</div>
              </div>
            </div>

            {precheckFailed && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800">
                We could not check this file against your existing customers, so duplicates may not be
                listed below. Any that slip through will be reported after the import.
              </div>
            )}

            {result.totalDataRows !== rows.length + rejected.length && (
              <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/20 p-3 text-xs text-rose-800">
                The file contains {result.totalDataRows} rows but only{" "}
                {rows.length + rejected.length} were accounted for. Do not import — please send us the
                file so we can look at it.
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {result.totalDataRows} row{result.totalDataRows === 1 ? "" : "s"} read from{" "}
              <span className="font-medium">{fileName}</span>
              {result.ignoredColumns.length > 0 && (
                <> · ignored columns: {result.ignoredColumns.join(", ")}</>
              )}
            </p>

            {rejected.length > 0 && (
              <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/20 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-rose-700 mb-2">
                  <XCircle className="h-4 w-4" />
                  These rows will be skipped
                </div>
                <div className="max-h-40 overflow-y-auto text-xs space-y-1">
                  {rejected.map((r, i) => (
                    <div key={i} className="text-rose-700/90">
                      Line {r.line}
                      {r.label ? ` · ${r.label}` : ""} — {r.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-700 mb-2">
                  <AlertTriangle className="h-4 w-4" />
                  Imported, but worth a look
                </div>
                <div className="max-h-40 overflow-y-auto text-xs space-y-1">
                  {warnings.map((w, i) => (
                    <div key={i} className="text-amber-700/90">
                      Line {w.line} · {w.label} — {w.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rows.length > 0 && (
              <div className="rounded-md border">
                <div className="px-3 py-2 text-xs font-medium border-b bg-muted/40">
                  First {Math.min(5, rows.length)} of {rows.length}
                </div>
                <div className="divide-y">
                  {rows.slice(0, 5).map((r) => (
                    <div key={r.line} className="px-3 py-2 text-xs flex justify-between gap-3">
                      <span className="font-medium truncate">{r.name}</span>
                      <span className="text-muted-foreground truncate">{r.email ?? "no email"}</span>
                      <span className="text-muted-foreground truncate">{r.phone ?? "no phone"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {stage === "done" && outcome && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              {outcome.inserted} customer{outcome.inserted === 1 ? "" : "s"} imported
            </div>
            {outcome.failed.length > 0 && (
              <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/20 p-3">
                <div className="text-sm font-medium text-rose-700 mb-2">
                  {outcome.failed.length} could not be added
                </div>
                <div className="max-h-40 overflow-y-auto text-xs space-y-1">
                  {outcome.failed.map((f, i) => (
                    <div key={i} className="text-rose-700/90">
                      Line {f.line} · {f.name} — {f.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {stage === "review" && (
            <>
              <Button variant="outline" onClick={reset} disabled={importer.isPending}>
                Choose another file
              </Button>
              <Button
                onClick={runImport}
                disabled={
                  rows.length === 0 ||
                  importer.isPending ||
                  result?.totalDataRows !== rows.length + rejected.length
                }
              >
                {importer.isPending ? "Importing..." : `Import ${rows.length} customer${rows.length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
          {stage === "done" && <Button onClick={() => close(false)}>Done</Button>}
          {stage === "choose" && (
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
