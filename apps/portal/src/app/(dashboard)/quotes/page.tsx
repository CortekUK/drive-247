"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  AlertTriangle,
  CalendarRange,
  Check,
  Clipboard,
  Download,
  Loader2,
  Mail,
  RefreshCw,
  Send,
} from "lucide-react";
import { notFound } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { isAreaHidden } from "@/lib/lean-areas";
import { useFleetQuote, type FleetQuoteSearch } from "@/hooks/use-fleet-quote";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useToast } from "@/hooks/use-toast";
import {
  formatQuoteHtml,
  formatQuotePlainText,
  isValidLocalDate,
  isValidQuoteEmail,
  isValidQuoteReference,
  quoteLinesChanged,
  safeQuoteFilename,
  shiftLocalDate,
  validateQuoteRange,
  type FleetQuoteLine,
  type FleetQuoteResult,
} from "@/lib/fleet-quote";
import { formatCurrency } from "@/lib/format-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function makeQuoteReference(): string {
  const timestamp = format(new Date(), "yyyyMMdd-HHmm");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `QT-${timestamp}-${suffix}`;
}

function safeTimezone(value: unknown): string {
  if (typeof value !== "string" || !value) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

export default function FleetQuotesPage() {
  const { tenant, tenantSlug } = useTenant();
  // Load-bearing, and NOT redundant with the two sidebar gates. Hiding a nav
  // entry hides the link, not the page: typing /quotes, following a bookmark
  // or a pasted link would still render the full generator for a lean tenant.
  // The sidebars decide what is offered; this decides what exists.
  if (isAreaHidden("quotes", tenantSlug)) notFound();
  const timezone = safeTimezone(tenant?.timezone);
  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const tomorrow = shiftLocalDate(today, 1);
  const { canEdit } = useManagerPermissions();
  const { logAction } = useAuditLog();
  const { toast } = useToast();
  const { generate, isGenerating } = useFleetQuote();

  const [search, setSearch] = useState<FleetQuoteSearch>({
    startDate: today,
    endDate: tomorrow,
    pickupTime: "09:00",
    returnTime: "09:00",
  });
  const [result, setResult] = useState<FleetQuoteResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [quoteReference, setQuoteReference] = useState(makeQuoteReference);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [validUntil, setValidUntil] = useState(() => shiftLocalDate(today, 7));
  const [note, setNote] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const currency = tenant?.currency_code || "USD";
  const companyName = tenant?.company_name || "Vehicle Rental Quote";
  const selectedLines = useMemo(
    () => (result?.available ?? []).filter((line) => selectedIds.has(line.vehicleId)),
    [result, selectedIds],
  );
  const allSelected = !!result?.available.length && selectedIds.size === result.available.length;

  const updateSearch = (key: keyof FleetQuoteSearch, value: string) => {
    setSearch((current) => ({ ...current, [key]: value }));
    // Results are a snapshot. Clear them as soon as their inputs change so a
    // stale range can never accidentally be copied or sent.
    setResult(null);
    setSelectedIds(new Set());
    setGeneratedAt(null);
  };

  const generateSnapshot = async (): Promise<FleetQuoteResult | null> => {
    const validationError = validateQuoteRange(
      search.startDate,
      search.endDate,
      search.pickupTime,
      search.returnTime,
      timezone,
    );
    if (validationError) {
      toast({ title: "Check the rental period", description: validationError, variant: "destructive" });
      return null;
    }
    if (search.startDate < today) {
      toast({ title: "Pickup date is in the past", description: "Choose today or a future date.", variant: "destructive" });
      return null;
    }
    try {
      const next = await generate(search);
      setResult(next);
      setSelectedIds(new Set(next.available.map((line) => line.vehicleId)));
      setGeneratedAt(new Date());
      setQuoteReference(makeQuoteReference());
      if (next.available.length === 0) {
        toast({
          title: "No quotable vehicles",
          description: "Every fleet vehicle is booked, blocked, disabled, or missing a price for this period.",
        });
      }
      return next;
    } catch (error) {
      toast({
        title: "Could not generate quote",
        description: error instanceof Error ? error.message : "Availability could not be verified.",
        variant: "destructive",
      });
      return null;
    }
  };

  const quotePayload = (lines: FleetQuoteLine[]) => ({
    companyName,
    customerName: customerName.trim() || undefined,
    quoteReference: quoteReference.trim(),
    ...search,
    currency,
    lines,
    validUntil: validUntil || undefined,
    note: note.trim() || undefined,
    hideVehicleRegistration: tenant?.hide_vehicle_registration === true,
  });

  const toggleLine = (vehicleId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(vehicleId);
      else next.delete(vehicleId);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds(
      checked ? new Set((result?.available ?? []).map((line) => line.vehicleId)) : new Set(),
    );
  };

  const requireSelected = (): boolean => {
    if (selectedLines.length > 0) return true;
    toast({ title: "Select at least one vehicle", variant: "destructive" });
    return false;
  };

  const requireValidQuoteDetails = (): boolean => {
    if (!isValidQuoteReference(quoteReference)) {
      toast({ title: "Enter a valid quote reference", description: "Use 1–60 characters without line breaks or control characters.", variant: "destructive" });
      return false;
    }
    if (validUntil && (!isValidLocalDate(validUntil) || validUntil < today)) {
      toast({ title: "Choose a valid quote expiry", description: "The expiry must be today or later.", variant: "destructive" });
      return false;
    }
    return true;
  };

  const copyQuote = async () => {
    if (!requireSelected() || !requireValidQuoteDetails()) return;
    try {
      await navigator.clipboard.writeText(formatQuotePlainText(quotePayload(selectedLines)));
      toast({ title: "Quote copied", description: "Paste it into SMS, WhatsApp, or any message." });
      void logAction({
        action: "fleet_quote_copied",
        entityType: "quote",
        entityId: quoteReference,
        details: { vehicle_count: selectedLines.length, start_date: search.startDate, end_date: search.endDate },
      });
    } catch {
      toast({
        title: "Clipboard permission denied",
        description: "Your browser blocked clipboard access. Try Download PDF instead.",
        variant: "destructive",
      });
    }
  };

  const downloadPdf = async () => {
    if (!requireSelected() || !requireValidQuoteDetails()) return;
    setIsDownloading(true);
    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const margin = 48;
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      let y = margin;
      const money = (value: number) => formatCurrency(value, currency);

      const ensureSpace = (height: number) => {
        if (y + height <= pageHeight - margin) return;
        pdf.addPage();
        y = margin;
      };
      const write = (text: string, size = 10, bold = false, gap = 16) => {
        pdf.setFont("helvetica", bold ? "bold" : "normal");
        pdf.setFontSize(size);
        const lines = pdf.splitTextToSize(text, pageWidth - margin * 2);
        ensureSpace(lines.length * gap);
        pdf.text(lines, margin, y);
        y += lines.length * gap;
      };

      write(companyName, 20, true, 23);
      write(`Vehicle quote ${quoteReference}`, 12, false, 19);
      if (customerName.trim()) write(`Prepared for: ${customerName.trim()}`);
      write(`Rental period: ${search.startDate} ${search.pickupTime} to ${search.endDate} ${search.returnTime}`);
      if (validUntil) write(`Valid until: ${validUntil}`);
      y += 10;

      selectedLines.forEach((line, index) => {
        ensureSpace(58);
        write(
          `${index + 1}. ${line.name}${tenant?.hide_vehicle_registration ? "" : ` (${line.registration})`}`,
          11,
          true,
          16,
        );
        write(
          `${money(line.total)} total · ${money(line.effectiveDailyRate)}/day effective · ${line.pricingTier} pricing`,
          10,
          false,
          15,
        );
        if (line.securityDeposit) write(`Security deposit: ${money(line.securityDeposit)}`, 9, false, 14);
        y += 8;
      });

      if (note.trim()) {
        ensureSpace(45);
        write(`Note: ${note.trim()}`, 10, false, 15);
      }
      y += 8;
      write(
        "Prices are rental estimates for the dates shown and are subject to availability at confirmation. Deposits, optional extras, insurance, delivery, taxes, and payment fees may apply unless explicitly included.",
        8,
        false,
        12,
      );
      pdf.save(`${safeQuoteFilename(quoteReference)}.pdf`);
      toast({ title: "PDF downloaded" });
      void logAction({
        action: "fleet_quote_downloaded",
        entityType: "quote",
        entityId: quoteReference,
        details: { vehicle_count: selectedLines.length, start_date: search.startDate, end_date: search.endDate },
      });
    } catch (error) {
      toast({
        title: "Could not create PDF",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const sendEmail = async () => {
    if (!canEdit("rentals")) {
      toast({ title: "Editor access required", description: "You can preview quotes but cannot send them.", variant: "destructive" });
      return;
    }
    if (!requireSelected() || !requireValidQuoteDetails()) return;
    const recipient = customerEmail.trim();
    if (!isValidQuoteEmail(recipient)) {
      toast({ title: "Enter a valid customer email", variant: "destructive" });
      return;
    }
    if (search.startDate < today) {
      toast({ title: "Rental period is now in the past", description: "Generate a new quote with today or a future date.", variant: "destructive" });
      return;
    }

    setIsSending(true);
    try {
      // Re-query immediately before the external send. If either availability
      // or any per-day price changed, stop and force the operator to review the
      // refreshed snapshot instead of silently sending stale figures.
      const fresh = await generate(search);
      const freshSelected = fresh.available.filter((line) => selectedIds.has(line.vehicleId));
      if (quoteLinesChanged(selectedLines, freshSelected)) {
        setResult(fresh);
        setSelectedIds(new Set(freshSelected.map((line) => line.vehicleId)));
        setGeneratedAt(new Date());
        toast({
          title: "Availability or pricing changed",
          description: "The results were refreshed. Review them, then click Send again.",
          variant: "destructive",
        });
        return;
      }

      const payload = quotePayload(freshSelected);
      const { data, error } = await supabase.functions.invoke<{
        success?: boolean;
        error?: string;
        simulated?: boolean;
      }>("aws-ses-email", {
        body: {
          to: recipient,
          subject: `${companyName} vehicle quote ${quoteReference.trim()}`,
          html: formatQuoteHtml(payload),
          text: formatQuotePlainText(payload),
          replyTo: tenant?.contact_email && isValidQuoteEmail(tenant.contact_email)
            ? tenant.contact_email.trim()
            : undefined,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "The email provider did not accept the message.");
      if (data.simulated) throw new Error("Email delivery is not configured; the provider only simulated this send.");

      toast({ title: "Quote sent", description: `Sent to ${recipient}.` });
      void logAction({
        action: "fleet_quote_sent",
        entityType: "quote",
        entityId: quoteReference,
        details: {
          recipient,
          vehicle_count: freshSelected.length,
          start_date: search.startDate,
          end_date: search.endDate,
          totals: freshSelected.map((line) => ({ vehicle_id: line.vehicleId, total: line.total })),
        },
      });
    } catch (error) {
      toast({
        title: "Quote was not sent",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="container mx-auto space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
          <CalendarRange className="h-7 w-7 text-primary" /> Fleet Quotes
        </h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Select a rental period to price every available vehicle, then send a customer-ready quote.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Rental period</CardTitle>
          <CardDescription>Times are included so turnaround buffers and same-day handovers are checked correctly.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="quote-pickup-date">Pickup date</Label>
              <Input id="quote-pickup-date" type="date" min={today} value={search.startDate} onChange={(event) => updateSearch("startDate", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-pickup-time">Pickup time</Label>
              <Input id="quote-pickup-time" type="time" value={search.pickupTime} onChange={(event) => updateSearch("pickupTime", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-return-date">Return date</Label>
              <Input id="quote-return-date" type="date" min={search.startDate || today} value={search.endDate} onChange={(event) => updateSearch("endDate", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-return-time">Return time</Label>
              <Input id="quote-return-time" type="time" value={search.returnTime} onChange={(event) => updateSearch("returnTime", event.target.value)} />
            </div>
          </div>
          <Button onClick={() => void generateSnapshot()} disabled={isGenerating}>
            {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Generate fleet prices
          </Button>
        </CardContent>
      </Card>

      {result && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Available and priced</p><p className="text-3xl font-bold text-emerald-600">{result.available.length}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Not quotable</p><p className="text-3xl font-bold text-amber-600">{result.excluded.length}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Billable rental days</p><p className="text-3xl font-bold">{result.rentalDays}</p></CardContent></Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>2. Available vehicles</CardTitle>
                  <CardDescription>
                    {generatedAt ? `Verified ${generatedAt.toLocaleString()}. ` : ""}
                    Prices are sorted lowest first and selected by default.
                  </CardDescription>
                </div>
                {result.available.length > 0 && <Badge variant="outline">{selectedLines.length} selected</Badge>}
              </div>
            </CardHeader>
            <CardContent>
              {result.available.length === 0 ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>No vehicles can be quoted</AlertTitle>
                  <AlertDescription>Review the excluded fleet below or choose another rental period.</AlertDescription>
                </Alert>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12"><Checkbox aria-label="Select all vehicles" checked={allSelected} onCheckedChange={(checked) => toggleAll(checked === true)} /></TableHead>
                        <TableHead>Vehicle</TableHead>
                        <TableHead>Pricing</TableHead>
                        <TableHead className="text-right">Effective/day</TableHead>
                        <TableHead className="text-right">Rental total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.available.map((line) => (
                        <TableRow key={line.vehicleId}>
                          <TableCell><Checkbox aria-label={`Select ${line.name}`} checked={selectedIds.has(line.vehicleId)} onCheckedChange={(checked) => toggleLine(line.vehicleId, checked === true)} /></TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              {line.photoUrl ? <img src={line.photoUrl} alt="" className="h-11 w-16 rounded object-cover" /> : <div className="flex h-11 w-16 items-center justify-center rounded bg-muted text-xs text-muted-foreground">No photo</div>}
                              <div><p className="font-medium">{line.name}</p><p className="text-xs text-muted-foreground">{line.registration}{line.category ? ` · ${line.category}` : ""}</p></div>
                            </div>
                          </TableCell>
                          <TableCell><div className="flex flex-wrap gap-1"><Badge variant="secondary" className="capitalize">{line.pricingTier}</Badge>{line.hasDynamicPricing && <Badge variant="outline">Dynamic days</Badge>}</div></TableCell>
                          <TableCell className="text-right">{formatCurrency(line.effectiveDailyRate, currency)}</TableCell>
                          <TableCell className="text-right text-base font-semibold">{formatCurrency(line.total, currency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {result.excluded.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Vehicles not included</CardTitle><CardDescription>Every excluded fleet vehicle is listed so missing rates or incorrect statuses are visible.</CardDescription></CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Vehicle</TableHead><TableHead>Reason</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
                    <TableBody>{result.excluded.map((item) => <TableRow key={item.vehicleId}><TableCell><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.registration}</p></TableCell><TableCell><Badge variant="outline">{item.reason}</Badge></TableCell><TableCell className="text-sm text-muted-foreground">{item.detail}</TableCell></TableRow>)}</TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {result.available.length > 0 && (
            <Card>
              <CardHeader><CardTitle>3. Prepare and send</CardTitle><CardDescription>Email sends are revalidated immediately before delivery. PDF and copied text use the visible snapshot.</CardDescription></CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="quote-customer-name">Customer name (optional)</Label><Input id="quote-customer-name" value={customerName} maxLength={120} onChange={(event) => setCustomerName(event.target.value)} placeholder="Jane Customer" /></div>
                  <div className="space-y-2"><Label htmlFor="quote-customer-email">Customer email</Label><Input id="quote-customer-email" type="email" value={customerEmail} maxLength={254} onChange={(event) => setCustomerEmail(event.target.value)} placeholder="customer@example.com" /></div>
                  <div className="space-y-2"><Label htmlFor="quote-reference">Quote reference</Label><Input id="quote-reference" value={quoteReference} maxLength={60} onChange={(event) => setQuoteReference(event.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="quote-valid-until">Valid until</Label><Input id="quote-valid-until" type="date" min={today} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></div>
                </div>
                <div className="space-y-2"><Label htmlFor="quote-note">Customer note (optional)</Label><Textarea id="quote-note" value={note} maxLength={2_000} rows={4} onChange={(event) => setNote(event.target.value)} placeholder="Add collection details or anything the customer should know." /></div>

                <Alert>
                  <Check className="h-4 w-4" />
                  <AlertTitle>Clear quote scope</AlertTitle>
                  <AlertDescription>Rental totals include configured vehicle rates, manual daily prices, and weekend/holiday pricing. Deposits, extras, insurance, delivery, taxes, and payment fees are disclosed as potentially additional rather than silently included.</AlertDescription>
                </Alert>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void copyQuote()} disabled={selectedLines.length === 0}><Clipboard className="mr-2 h-4 w-4" />Copy quote</Button>
                  <Button variant="outline" onClick={() => void downloadPdf()} disabled={isDownloading || selectedLines.length === 0}>{isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Download PDF</Button>
                  <Button onClick={() => void sendEmail()} disabled={isSending || selectedLines.length === 0 || !canEdit("rentals")}>{isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send email</Button>
                </div>
                {!canEdit("rentals") && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3.5 w-3.5" />Rental editor access is required to send email. You can still preview, copy, or download.</p>}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
