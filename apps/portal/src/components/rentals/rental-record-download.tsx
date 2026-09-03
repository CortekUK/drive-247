"use client";

/**
 * "Rental Record" — a downloadable PDF stating when the vehicle actually
 * changed hands, for handing to an insurer.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE RENTAL AGREEMENT
 * After an accident, the renter's insurer asks for a document showing the time
 * the vehicle was collected and the time it was returned. The rental agreement
 * cannot be that document, for a reason no amount of template work fixes: the
 * agreement is signed BEFORE the rental starts, so at signing time the return
 * has not happened and its timestamp does not exist. Retro-fitting it would
 * also mean re-issuing a signed contract, which is not a thing you do to
 * satisfy a claims request.
 *
 * So the agreement now states the times it legitimately can (see
 * agreement-datetime.ts), and this record states the full factual history after
 * the fact. It reads live data, so it works for rentals that closed months ago —
 * which template changes, by definition, never can.
 *
 * WHY IT IS GENERATED IN THE BROWSER
 * jsPDF is already used this way on the Agreements and Insurances pages, and the
 * queries run through the authenticated Supabase client, so a user only ever
 * renders a rental their own session can already read. A server route would have
 * to take a service-role key and re-implement that check.
 */

import { useState } from "react";
import { jsPDF } from "jspdf";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import {
  buildRentalTimeFacts,
  formatDateOnly,
  formatZonedDateTime,
  type HandoverRow,
} from "@/lib/agreement-datetime";

interface RentalRecordDownloadProps {
  rentalId: string;
  /** Rendered inline in a card header, so it defaults to a compact ghost button. */
  className?: string;
}

interface ExtensionRow {
  sequence_number: number;
  previous_end_date: string | null;
  new_end_date: string | null;
  status: string;
}

export function RentalRecordDownload({
  rentalId,
  className,
}: RentalRecordDownloadProps) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);

  const handleDownload = async () => {
    setGenerating(true);
    try {
      // Every query is checked. supabase-js returns { error } rather than
      // throwing, so an unchecked call yields `null` data and would silently
      // produce a record with blank fields — the exact failure this document
      // exists to prevent.
      const { data: rental, error: rentalError } = await supabase
        .from("rentals")
        .select(
          "id, rental_number, start_date, end_date, original_end_date, previous_end_date, pickup_time, return_time, customer_timezone, status, rental_period_type, pickup_location, return_location, is_pay_as_you_go, customers:customer_id(name, email, phone), vehicles:vehicle_id(reg, make, model, year)",
        )
        .eq("id", rentalId)
        .single();

      if (rentalError || !rental) {
        throw new Error(
          rentalError?.message || "Could not load this rental.",
        );
      }

      const { data: handoverData, error: handoverError } = await supabase
        .from("rental_key_handovers")
        .select("handover_type, handed_at, mileage, notes")
        .eq("rental_id", rentalId);
      if (handoverError) throw new Error(handoverError.message);

      const { data: extensionData, error: extensionError } = await supabase
        .from("rental_extensions")
        .select("sequence_number, previous_end_date, new_end_date, status")
        .eq("rental_id", rentalId)
        .order("sequence_number", { ascending: true });
      if (extensionError) throw new Error(extensionError.message);

      const handovers = (handoverData || []) as HandoverRow[];
      const extensions = (extensionData || []) as ExtensionRow[];
      const facts = buildRentalTimeFacts(rental as never, tenant as never, handovers);

      const customer = (rental as any).customers;
      const vehicle = (rental as any).vehicles;
      const companyName =
        tenant?.company_name || (tenant as any)?.slug || "Drive247";

      // ---- Layout ----------------------------------------------------------
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      const labelW = 55;
      let y = 25;

      // Break before the footer band rather than letting a row overlap it.
      const ensureSpace = (needed: number) => {
        if (y + needed > pageHeight - 22) {
          pdf.addPage();
          y = 25;
        }
      };

      const heading = (text: string) => {
        ensureSpace(16);
        y += 4;
        pdf.setDrawColor(210);
        pdf.setLineWidth(0.4);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 8;
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(40);
        pdf.text(text, margin, y);
        y += 8;
      };

      /**
       * A label/value line. `emphasis` is used for the two timestamps the
       * insurer is actually asking for, so they are findable at a glance.
       *
       * A row whose value is empty is skipped entirely — printing
       * "Vehicle Returned:" with nothing after it on a document sent to an
       * insurer reads as a recorded blank rather than an unrecorded event.
       */
      const row = (label: string, value: string, emphasis = false) => {
        if (!value) return;
        ensureSpace(8);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(110);
        pdf.text(label, margin, y);
        pdf.setFontSize(emphasis ? 11 : 10);
        pdf.setFont("helvetica", emphasis ? "bold" : "normal");
        pdf.setTextColor(emphasis ? 20 : 45);
        // Wrap rather than overflow the page: a chopped timestamp on a claims
        // document looks like a complete one.
        const lines = pdf.splitTextToSize(
          value,
          pageWidth - margin * 2 - labelW,
        ) as string[];
        pdf.text(lines, margin + labelW, y);
        y += Math.max(7, lines.length * 5.5);
      };

      const note = (text: string) => {
        ensureSpace(10);
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "italic");
        pdf.setTextColor(120);
        const lines = pdf.splitTextToSize(
          text,
          pageWidth - margin * 2,
        ) as string[];
        pdf.text(lines, margin, y);
        y += lines.length * 4 + 2;
      };

      // ---- Header ----------------------------------------------------------
      pdf.setFontSize(18);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(20);
      pdf.text(companyName, margin, y);
      y += 7;
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(90);
      pdf.text("Rental Record — Collection & Return Times", margin, y);
      y += 6;

      const reference =
        (rental as any).rental_number ||
        String((rental as any).id).substring(0, 8).toUpperCase();

      heading("Rental");
      row("Reference", reference);
      row("Customer", customer?.name || "");
      row(
        "Vehicle",
        [vehicle?.reg, [vehicle?.make, vehicle?.model].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(" — "),
      );
      row("Status", (rental as any).status || "");
      row("Period Type", (rental as any).rental_period_type || "");

      // ---- The part the insurer asked for ---------------------------------
      heading("Vehicle Collection & Return");
      row("Scheduled Collection", facts.scheduledPickup);
      row("Scheduled Return", facts.scheduledReturn);
      row("Vehicle Collected", facts.collectedAt, true);
      row("Vehicle Returned", facts.returnedAt, true);
      row("Odometer at Collection", facts.collectionMileage);
      row("Odometer at Return", facts.returnMileage);
      row("Collection Location", (rental as any).pickup_location || "");
      row("Return Location", (rental as any).return_location || "");
      row("Times Recorded In", facts.timeZone);

      // State the absence explicitly rather than leaving a gap the reader has to
      // interpret. "Not recorded" is a true and useful statement; a missing line
      // is not.
      if (!facts.collectedAt) {
        note(
          "No confirmed collection time is recorded for this rental. The scheduled collection is shown above.",
        );
      }
      if (!facts.returnedAt) {
        note(
          (rental as any).is_pay_as_you_go
            ? "This is an open-ended (Pay As You Go) rental and no confirmed return time is recorded."
            : "No confirmed return time is recorded for this rental. The scheduled return is shown above.",
        );
      }

      // ---- Contracted period, and how it moved -----------------------------
      heading("Contracted Rental Period");
      row("Start Date", formatDateOnly((rental as any).start_date));
      row(
        "End Date",
        (rental as any).is_pay_as_you_go
          ? "Open-ended (Pay As You Go)"
          : formatDateOnly((rental as any).end_date),
      );
      const originalEnd =
        (rental as any).original_end_date || (rental as any).previous_end_date;
      if (originalEnd && extensions.length > 0) {
        row("Originally Ended", formatDateOnly(originalEnd));
      }

      if (extensions.length > 0) {
        heading("Extension History");
        for (const ext of extensions) {
          const from = formatDateOnly(ext.previous_end_date);
          const to = formatDateOnly(ext.new_end_date);
          row(
            `Extension #${ext.sequence_number}`,
            [from && to ? `${from} to ${to}` : "", ext.status]
              .filter(Boolean)
              .join("  ·  "),
          );
        }
        note(
          "Extensions change the contracted end date only. The vehicle is not handed back and re-collected between extensions, so a single collection and a single return time apply to the whole rental.",
        );
      }

      // Handover notes are operator-entered free text and can be long; they are
      // included because a claims handler often needs the condition remarks.
      const givingNotes = handovers.find(
        (h) => h.handover_type === "giving",
      ) as { notes?: string | null } | undefined;
      const receivingNotes = handovers.find(
        (h) => h.handover_type === "receiving",
      ) as { notes?: string | null } | undefined;
      if (givingNotes?.notes || receivingNotes?.notes) {
        heading("Handover Notes");
        row("At Collection", givingNotes?.notes || "");
        row("At Return", receivingNotes?.notes || "");
      }

      // ---- Provenance ------------------------------------------------------
      heading("About This Record");
      note(
        `Generated from ${companyName}'s rental management system on ${formatZonedDateTime(new Date(), facts.timeZone)}. ` +
          `Collection and return times are the timestamps recorded by the operator at the point the keys changed hands. ` +
          `All dates and times in this document are stated in ${facts.timeZone}.`,
      );

      // Footer band on every page, so a detached page is still attributable.
      const pageCount = pdf.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(150);
        pdf.text(
          `${companyName} · Rental ${reference}`,
          margin,
          pageHeight - 12,
        );
        pdf.text(
          `Page ${i} of ${pageCount}`,
          pageWidth - margin,
          pageHeight - 12,
          { align: "right" },
        );
      }

      const safeRef = String(reference).replace(/[^a-zA-Z0-9-_]/g, "_");
      pdf.save(`Rental_Record_${safeRef}.pdf`);
      toast({ title: "Rental record downloaded" });
    } catch (err) {
      console.error("Failed to generate rental record:", err);
      toast({
        title: "Could not generate the rental record",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      onClick={handleDownload}
      disabled={generating}
      title="Download a PDF stating when the vehicle was collected and returned — for insurance claims"
    >
      {generating ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      <span className="ml-1.5">Rental Record</span>
    </Button>
  );
}
