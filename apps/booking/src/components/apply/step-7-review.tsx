"use client";

import { useFormContext } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ApplyFormValues } from "@/client-schemas/apply";

function Row({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground break-words">{value || "—"}</span>
    </div>
  );
}

export function Step7Review() {
  const { watch, setValue } = useFormContext<ApplyFormValues>();
  const v = watch();

  return (
    <div className="space-y-5">
      <div className="rounded-md border bg-muted/30 p-4">
        <h3 className="mb-2 text-sm font-semibold">About you</h3>
        <Row label="Name" value={v.fullName} />
        <Row label="Email" value={v.email} />
        <Row label="Phone" value={v.phone} />
        <Row label="Date of birth" value={v.dateOfBirth} />
      </div>

      <div className="rounded-md border bg-muted/30 p-4">
        <h3 className="mb-2 text-sm font-semibold">Driver</h3>
        <Row label="Licence" value={`${v.licenceNumber} (${v.licenceState})`} />
        <Row label="Expires" value={v.licenceExpiry} />
        <Row label="Years driving" value={v.yearsDriving} />
        <Row label="Violations" value={v.hasViolations ? "Yes" : "No"} />
      </div>

      <div className="rounded-md border bg-muted/30 p-4">
        <h3 className="mb-2 text-sm font-semibold">Rental</h3>
        <Row label="Purpose" value={v.purpose} />
        <Row label="Dates" value={`${v.startDate} → ${v.endDate}`} />
        <Row label="Length" value={v.rentalLengthTarget} />
        <Row label="Vehicle interest" value={v.vehicleInterestType} />
      </div>

      <div className="rounded-md border bg-muted/30 p-4">
        <h3 className="mb-2 text-sm font-semibold">Financial</h3>
        <Row label="Can pay deposit" value={v.canPayDeposit ? "Yes" : "No"} />
        <Row label="Deposit comfort" value={v.depositComfortAmount ? `$${v.depositComfortAmount}` : "—"} />
        <Row label="Weekly budget" value={v.weeklyBudget ? `$${v.weeklyBudget}` : "—"} />
      </div>

      <div className="rounded-md border bg-muted/30 p-4">
        <h3 className="mb-2 text-sm font-semibold">Documents</h3>
        <Row label="Licence" value={v.licencePhotoUrl ? "Uploaded" : "Not uploaded"} />
        <Row label="Selfie" value={v.selfieUrl ? "Uploaded" : "Not uploaded"} />
        <Row label="Rideshare proof" value={v.rideshareProofUrl ? "Uploaded" : "Not uploaded"} />
      </div>

      <div className="space-y-3 rounded-md border bg-card p-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id="termsAccepted"
            checked={v.termsAccepted === true}
            onCheckedChange={(checked) =>
              setValue("termsAccepted", (checked === true) as unknown as true, { shouldValidate: true })
            }
          />
          <Label htmlFor="termsAccepted" className="cursor-pointer text-sm">
            I agree to the rental terms and privacy policy.
          </Label>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="marketingConsent"
            checked={!!v.marketingConsent}
            onCheckedChange={(checked) =>
              setValue("marketingConsent", checked === true, { shouldValidate: true })
            }
          />
          <Label htmlFor="marketingConsent" className="cursor-pointer text-sm">
            Email me occasional updates from this rental operator.
          </Label>
        </div>
      </div>
    </div>
  );
}
