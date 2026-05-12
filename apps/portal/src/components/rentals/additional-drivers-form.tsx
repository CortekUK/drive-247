"use client";

import { useState } from "react";
import { Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface AdditionalDriverInput {
  /** Local-only UUID so React keys are stable across re-renders. */
  uiId: string;
  name: string;
  email: string;
  phone: string;
}

interface AdditionalDriversFormProps {
  drivers: AdditionalDriverInput[];
  onChange: (drivers: AdditionalDriverInput[]) => void;
  primaryCustomerEmail?: string | null;
  /**
   * Disable input while the parent is submitting the rental — additional
   * driver creation happens in the same flow.
   */
  disabled?: boolean;
}

const newRow = (): AdditionalDriverInput => ({
  uiId: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  name: "",
  email: "",
  phone: "",
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Editor for additional drivers attached to a rental.
 *
 * Validation kept inline so the parent submit handler can short-circuit if
 * any row is incomplete — no DB rows or emails get sent in that case.
 *
 * The "primary customer email" prop is used to flag a same-email collision
 * up-front (the edge function rejects it too, but warning here saves a roundtrip).
 */
export function AdditionalDriversForm({
  drivers,
  onChange,
  primaryCustomerEmail,
  disabled,
}: AdditionalDriversFormProps) {
  const primaryLower = primaryCustomerEmail?.toLowerCase() ?? null;

  const update = (uiId: string, patch: Partial<AdditionalDriverInput>) => {
    onChange(drivers.map((d) => (d.uiId === uiId ? { ...d, ...patch } : d)));
  };

  const remove = (uiId: string) => {
    onChange(drivers.filter((d) => d.uiId !== uiId));
  };

  const add = () => onChange([...drivers, newRow()]);

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-1.5 px-6 py-3.5 border-b bg-primary/15 rounded-t-xl">
        <div className="flex items-center justify-center h-7 w-7 rounded-md bg-primary/20 text-primary">
          <UserPlus className="h-4 w-4" />
        </div>
        <h2 className="font-extrabold text-xl text-foreground uppercase tracking-wider">
          Additional Drivers
        </h2>
        <span className="ml-2 text-xs text-muted-foreground font-normal normal-case tracking-normal">
          Optional
        </span>
      </div>
      <div className="p-5 space-y-3">
        {drivers.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Add a spouse, family member, or any other person who is authorised to drive the vehicle.
            Each driver receives a licence-verification link and a separate copy of the rental
            agreement to sign.
          </p>
        )}

        {drivers.map((d, idx) => {
          const sameAsPrimary = !!(primaryLower && d.email.trim().toLowerCase() === primaryLower);
          const emailInvalid = d.email.trim() !== "" && !EMAIL_REGEX.test(d.email.trim());
          const missingContact = d.name.trim() !== "" && d.email.trim() === "" && d.phone.trim() === "";
          return (
            <div
              key={d.uiId}
              className="rounded-lg border border-input bg-background p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Driver {idx + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(d.uiId)}
                  disabled={disabled}
                  className="h-7 px-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor={`add-driver-name-${d.uiId}`} className="text-xs">
                    Full Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id={`add-driver-name-${d.uiId}`}
                    value={d.name}
                    onChange={(e) => update(d.uiId, { name: e.target.value })}
                    placeholder="e.g. Jane Doe"
                    disabled={disabled}
                  />
                </div>
                <div>
                  <Label htmlFor={`add-driver-email-${d.uiId}`} className="text-xs">
                    Email
                  </Label>
                  <Input
                    id={`add-driver-email-${d.uiId}`}
                    type="email"
                    value={d.email}
                    onChange={(e) => update(d.uiId, { email: e.target.value })}
                    placeholder="jane@example.com"
                    disabled={disabled}
                  />
                </div>
                <div>
                  <Label htmlFor={`add-driver-phone-${d.uiId}`} className="text-xs">
                    Phone
                  </Label>
                  <Input
                    id={`add-driver-phone-${d.uiId}`}
                    type="tel"
                    value={d.phone}
                    onChange={(e) => update(d.uiId, { phone: e.target.value })}
                    placeholder="+1 555 0123"
                    disabled={disabled}
                  />
                </div>
              </div>
              {sameAsPrimary && (
                <p className="text-xs text-red-600">
                  This email matches the primary customer. Use a different email.
                </p>
              )}
              {emailInvalid && (
                <p className="text-xs text-red-600">Please enter a valid email address.</p>
              )}
              {missingContact && (
                <p className="text-xs text-amber-600">
                  Add at least an email or phone so we can send the verification link.
                </p>
              )}
            </div>
          );
        })}

        <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          {drivers.length === 0 ? "Add Driver" : "Add Another Driver"}
        </Button>

        {drivers.length > 0 && (
          <p className="text-xs text-muted-foreground pt-1">
            When you create the rental, each driver receives an ID-verification link
            and the rental agreement for signing. You can resend either email from the
            rental detail page if needed.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Surface-level validation matching the edge function's checks. Returns an
 * error message string when invalid, or null when the list is safe to send.
 */
export function validateAdditionalDrivers(
  drivers: AdditionalDriverInput[],
  primaryCustomerEmail: string | null | undefined,
): string | null {
  const seenEmails = new Set<string>();
  const primaryLower = primaryCustomerEmail?.toLowerCase() ?? null;
  for (const d of drivers) {
    const name = d.name.trim();
    const email = d.email.trim();
    const phone = d.phone.trim();
    if (!name) return "Each additional driver must have a name.";
    if (!email && !phone) {
      return `Driver "${name}" needs an email or phone number.`;
    }
    if (email && !EMAIL_REGEX.test(email)) {
      return `"${email}" is not a valid email.`;
    }
    if (email) {
      const lower = email.toLowerCase();
      if (primaryLower && lower === primaryLower) {
        return "Additional driver email cannot match the primary customer.";
      }
      if (seenEmails.has(lower)) {
        return `Email "${email}" is used twice in the additional driver list.`;
      }
      seenEmails.add(lower);
    }
  }
  return null;
}
