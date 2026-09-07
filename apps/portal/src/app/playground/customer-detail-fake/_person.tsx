"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Playground · customer control centre — THE PERSON
 *
 * The first band of the rail: the three panels an operator TYPES INTO. Nothing
 * here is produced from anything else, which is why nothing here can be out of
 * date — but everything here is read by something in the second band, so an
 * edit made on one of these panels is what puts a verdict downstream in amber.
 * ────────────────────────────────────────────────────────────────────────── */

import {
  AlertTriangle,
  Building2,
  Check,
  FileText,
  Plus,
  ScanLine,
  ShieldCheck,
  Trash2,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import {
  ActionButton,
  EmptyHint,
  Field,
  OptionCard,
  Panel,
  Pill,
  fmtDate,
  inputCls,
} from "@/app/playground/_shared";
import { TODAY, DOC_TYPES, US_TIMEZONES } from "./_data";
import type { Doc, DocType, PanelProps } from "./_data";
import { Section, Stat, Thumb, Toggle, expiryOf, listCls } from "./_bits";

/* ══════════════════════════════════════════════════════════════════════════
   Identity
   ══════════════════════════════════════════════════════════════════════════ */

export function IdentityPanel({ c, patch, onJump }: PanelProps) {
  const set = <K extends keyof typeof c.identity>(k: K, v: (typeof c.identity)[K]) =>
    patch((p) => ({ ...p, identity: { ...p.identity, [k]: v } }));

  const setNok = <K extends keyof typeof c.identity.nok>(k: K, v: (typeof c.identity.nok)[K]) =>
    patch((p) => ({ ...p, identity: { ...p.identity, nok: { ...p.identity.nok, [k]: v } } }));

  const isCompany = c.identity.customerType === "Company";

  return (
    <Panel
      title="Identity"
      description="Who this person is. Typing here changes the record — there is nothing to save."
    >
      <Section title="Contact">
        <div className="mb-6 flex items-center gap-4">
          <Thumb className="size-16 shrink-0 rounded-4xl" filled />
          <div className="min-w-0">
            <p className="font-heading text-sm font-semibold">Profile photo</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Shown to staff on the handover screen so the right person gets the keys.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button variant="outline" size="sm">
                Replace
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                Remove
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Full name">
              <input
                className={inputCls}
                value={c.identity.name}
                placeholder="e.g. Marcus Adeyemi"
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Email"
            hint="Optional — 110 of the 521 live customers have none, so nothing may depend on it."
          >
            <input
              className={inputCls}
              value={c.identity.email}
              placeholder="name@example.com"
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputCls}
              value={c.identity.phone}
              placeholder="+1 (000) 000-0000"
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
          <Field label="Date of birth" hint="Used for the minimum-age check at handover.">
            <input
              type="date"
              className={inputCls}
              value={c.identity.dob}
              onChange={(e) => set("dob", e.target.value)}
            />
          </Field>
          <Field label="Timezone" hint="When their reminders and lockbox codes are sent.">
            <select
              className={inputCls}
              value={c.identity.timezone}
              onChange={(e) => set("timezone", e.target.value)}
            >
              {US_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace("America/", "").replace("_", " ")}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Address" description="The verification provider reads this back off the licence.">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Street">
              <input
                className={inputCls}
                value={c.identity.street}
                placeholder="418 Riverside Ave, Apt 6B"
                onChange={(e) => set("street", e.target.value)}
              />
            </Field>
          </div>
          <Field label="City">
            <input
              className={inputCls}
              value={c.identity.city}
              placeholder="Jacksonville"
              onChange={(e) => set("city", e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State">
              <input
                className={inputCls}
                value={c.identity.state}
                placeholder="FL"
                maxLength={2}
                onChange={(e) => set("state", e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="ZIP">
              <input
                className={inputCls}
                value={c.identity.zip}
                placeholder="32204"
                onChange={(e) => set("zip", e.target.value)}
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section
        title="Account holder"
        description="A company account bills and signs under the business, not the driver."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <OptionCard
            selected={!isCompany}
            onClick={() => set("customerType", "Individual")}
            title="Individual"
            subtitle="Renting in their own name"
            right={<User className="size-4 shrink-0 text-muted-foreground" />}
          />
          <OptionCard
            selected={isCompany}
            onClick={() => set("customerType", "Company")}
            title="Company"
            subtitle="Renting on behalf of a business"
            right={<Building2 className="size-4 shrink-0 text-muted-foreground" />}
          />
        </div>

        {isCompany && (
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field label="Company name">
              <input
                className={inputCls}
                value={c.identity.companyName}
                placeholder="e.g. Riverside Logistics LLC"
                onChange={(e) => set("companyName", e.target.value)}
              />
            </Field>
            <Field label="Registration number">
              <input
                className={inputCls}
                value={c.identity.companyRegistration}
                placeholder="e.g. L26000148821"
                onChange={(e) => set("companyRegistration", e.target.value)}
              />
            </Field>
          </div>
        )}
      </Section>

      <Section
        title="Next of kin"
        description="Who we call if something happens to the driver while the car is out."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name">
            <input
              className={inputCls}
              value={c.identity.nok.name}
              placeholder="e.g. Adaeze Adeyemi"
              onChange={(e) => setNok("name", e.target.value)}
            />
          </Field>
          <Field label="Relationship">
            <input
              className={inputCls}
              value={c.identity.nok.relationship}
              placeholder="e.g. Sister"
              onChange={(e) => setNok("relationship", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputCls}
              value={c.identity.nok.phone}
              placeholder="+1 (000) 000-0000"
              onChange={(e) => setNok("phone", e.target.value)}
            />
          </Field>
          <Field label="Email">
            <input
              className={inputCls}
              value={c.identity.nok.email}
              placeholder="name@example.com"
              onChange={(e) => setNok("email", e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <input
                className={inputCls}
                value={c.identity.nok.address}
                placeholder="Street, city, state, ZIP"
                onChange={(e) => setNok("address", e.target.value)}
              />
            </Field>
          </div>
        </div>
      </Section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        The name, date of birth and address on this panel are three of the six values the identity
        verdict was issued against — so editing any of them will put{" "}
        <button
          type="button"
          onClick={() => onJump("verification")}
          className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
        >
          Verification
        </button>{" "}
        out of date. That is not a warning; it is the screen doing its job.
      </p>
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Licence & driving
   ══════════════════════════════════════════════════════════════════════════ */

export function LicencePanel({ c, patch, onJump }: PanelProps) {
  const set = <K extends keyof typeof c.licence>(k: K, v: (typeof c.licence)[K]) =>
    patch((p) => ({ ...p, licence: { ...p.licence, [k]: v } }));

  const exp = expiryOf(c.licence.expiry);

  return (
    <Panel
      title="Licence & driving"
      description="The document the identity verdict is issued against, and the reason insurance is priced the way it is."
    >
      <Section title="Driving licence">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Licence number">
            <input
              className={inputCls}
              value={c.licence.number}
              placeholder="A000-0000-XX"
              onChange={(e) => set("number", e.target.value)}
            />
          </Field>
          <Field label="Issuing state">
            <input
              className={inputCls}
              value={c.licence.state}
              placeholder="FL"
              maxLength={2}
              onChange={(e) => set("state", e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Issued">
            <input
              type="date"
              className={inputCls}
              value={c.licence.issued}
              onChange={(e) => set("issued", e.target.value)}
            />
          </Field>
          <Field label="Expires">
            <input
              type="date"
              className={inputCls}
              value={c.licence.expiry}
              onChange={(e) => set("expiry", e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Other ID on file"
              hint="A second number staff can match against — passport, national ID, or the last four of an SSN."
            >
              <input
                className={inputCls}
                value={c.licence.idNumber}
                placeholder="e.g. SSN ••••-0000"
                onChange={(e) => set("idNumber", e.target.value)}
              />
            </Field>
          </div>
        </div>

        {c.licence.expiry && (
          <div
            className={cn(
              "mt-5 flex items-center gap-3 rounded-3xl px-5 py-4 ring-1",
              exp.state === "expired"
                ? "bg-destructive/[0.06] ring-destructive/20"
                : exp.state === "soon"
                  ? "bg-warning-light/60 ring-warning/25"
                  : "bg-muted/40 ring-foreground/5"
            )}
          >
            {exp.state === "valid" ? (
              <Check className="size-4 shrink-0 text-success" />
            ) : (
              <AlertTriangle
                className={cn(
                  "size-4 shrink-0",
                  exp.state === "expired" ? "text-destructive" : "text-warning"
                )}
              />
            )}
            <p className="min-w-0 flex-1 text-xs leading-relaxed">
              {exp.state === "expired" ? (
                <>
                  <span className="font-medium text-destructive">
                    This licence expired on {fmtDate(c.licence.expiry)}.
                  </span>{" "}
                  A car cannot legally go out against it.
                </>
              ) : exp.state === "soon" ? (
                <>
                  <span className="font-medium text-warning">{exp.label}</span> — worth asking for the
                  replacement before the next booking runs past it.
                </>
              ) : (
                <>
                  Valid until {fmtDate(c.licence.expiry)}
                  <span className="text-muted-foreground"> · {exp.days} days from today</span>
                </>
              )}
            </p>
          </div>
        )}
      </Section>

      <Section
        title="Gig driver"
        description="Rideshare and delivery drivers are underwritten differently, so we hold proof of the platform rather than taking their word for it."
      >
        <Toggle
          checked={c.licence.isGigDriver}
          onChange={(v) => set("isGigDriver", v)}
          label="This customer drives for a gig platform"
          hint="Uber, Lyft, DoorDash and similar."
        />

        {c.licence.isGigDriver && (
          <div className="mt-5">
            {c.licence.gigProofs.length === 0 ? (
              <EmptyHint>
                No proof uploaded yet. A screenshot of their driver dashboard is enough.
              </EmptyHint>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {c.licence.gigProofs.map((g) => (
                  <div key={g.id} className="group relative">
                    <Thumb className="aspect-[4/3] w-full" filled caption={g.label} />
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Remove ${g.label}`}
                      onClick={() =>
                        set(
                          "gigProofs",
                          c.licence.gigProofs.filter((x) => x.id !== g.id)
                        )
                      }
                      className="absolute right-2 top-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5">
              <ActionButton
                variant="outline"
                onClick={() =>
                  set("gigProofs", [
                    ...c.licence.gigProofs,
                    { id: `g${Date.now()}`, label: `Screenshot ${c.licence.gigProofs.length + 1}` },
                  ])
                }
              >
                <Plus className="size-4" />
                Add proof
              </ActionButton>
            </div>
          </div>
        )}
      </Section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        The licence number and expiry above are what{" "}
        <button
          type="button"
          onClick={() => onJump("verification")}
          className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
        >
          Verification
        </button>{" "}
        checked. Change either and it will say so itself.
      </p>
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Documents
   ══════════════════════════════════════════════════════════════════════════ */

const SCAN_TONE = {
  none: "neutral",
  scanning: "primary",
  passed: "success",
  flagged: "warning",
} as const;

const SCAN_WORD = {
  none: "Not scanned",
  scanning: "Scanning",
  passed: "Scan passed",
  flagged: "Needs a look",
} as const;

export function DocumentsPanel({ c, patch, onJump }: PanelProps) {
  const setDocs = (fn: (d: Doc[]) => Doc[]) => patch((p) => ({ ...p, docs: fn(p.docs) }));

  const expiring = c.docs.filter((d) => expiryOf(d.until).state === "soon").length;
  const expired = c.docs.filter((d) => expiryOf(d.until).state === "expired").length;
  const flagged = c.docs.filter((d) => d.scan.status === "flagged").length;

  const addDoc = (type: DocType) =>
    setDocs((docs) => [
      ...docs,
      {
        id: `d${Date.now()}`,
        type,
        name: `${type} — new upload.pdf`,
        vehicle: null,
        from: TODAY,
        until: null,
        verified: false,
        uploadedAt: TODAY,
        scan: { status: "scanning", confidence: null, reasons: [] },
      },
    ]);

  return (
    <Panel
      title="Documents"
      description="Files this operator holds about the customer — uploaded here, scanned, and given a validity window."
    >
      {/*
       * The distinction that the first pass of this screen got wrong, stated
       * where it matters. Verification photos belong to the PROVIDER: they are
       * evidence of one verdict at one moment, they cannot be edited, and they
       * live on a different table. Mixing the two makes both unreadable —
       * an operator replacing a "licence front" here would reasonably expect
       * the verdict to update, and it would not.
       */}
      <div className="flex items-start gap-3 rounded-4xl bg-muted/40 px-6 py-5 ring-1 ring-foreground/5">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
          These are the operator's own files. The licence photos and selfie the verification provider
          captured are its evidence, not yours — they cannot be replaced from here and they live on{" "}
          <button
            type="button"
            onClick={() => onJump("verification")}
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
          >
            Verification
          </button>
          .
        </p>
      </div>

      {c.docs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="On file" value={String(c.docs.length)} hint={`${c.docs.filter((d) => d.verified).length} marked verified`} />
          <Stat
            label="Expiring"
            value={String(expiring + expired)}
            hint={expired ? `${expired} already expired` : "Within 30 days"}
            tone={expired ? "destructive" : expiring ? "warning" : undefined}
          />
          <Stat
            label="Flagged by the scanner"
            value={String(flagged)}
            hint={flagged ? "Needs a human" : "Nothing outstanding"}
            tone={flagged ? "warning" : undefined}
          />
        </div>
      )}

      <Section
        title="Files"
        right={
          <ActionButton variant="outline" onClick={() => addDoc("Other")}>
            <Plus className="size-4" />
            Add document
          </ActionButton>
        }
      >
        {c.docs.length === 0 ? (
          <EmptyHint>
            Nothing on file. A licence and a proof of address are what most operators ask for before
            the first handover.
          </EmptyHint>
        ) : (
          <div className="space-y-3">
            {c.docs.map((d) => {
              const exp = expiryOf(d.until);
              return (
                <div key={d.id} className={cn(listCls, "divide-y-0")}>
                  <div className="flex items-start gap-4 px-5 py-4">
                    <Thumb className="h-12 w-16 shrink-0" filled />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{d.name}</p>
                        {d.verified && (
                          <Pill tone="success">
                            <Check className="size-3" />
                            Verified
                          </Pill>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {d.type}
                        {d.vehicle && ` · ${d.vehicle}`} · added {fmtDate(d.uploadedAt)}
                      </p>

                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <Pill tone={SCAN_TONE[d.scan.status]}>
                          <ScanLine className="size-3" />
                          {SCAN_WORD[d.scan.status]}
                          {d.scan.confidence !== null && ` · ${d.scan.confidence}%`}
                        </Pill>
                        {exp.state !== "none" && (
                          <Pill
                            tone={
                              exp.state === "expired" ? "warning" : exp.state === "soon" ? "warning" : "neutral"
                            }
                          >
                            {exp.label}
                          </Pill>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button variant="outline" size="sm">
                        Download
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${d.name}`}
                        onClick={() => setDocs((docs) => docs.filter((x) => x.id !== d.id))}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* The scanner's objection, in its own words, where the file is
                      — not behind a dialog that has to be gone looking for. */}
                  {d.scan.status === "flagged" && d.scan.reasons.length > 0 && (
                    <div className="mx-5 mb-4 rounded-2xl bg-warning-light/60 px-4 py-3 ring-1 ring-warning/25">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                        <AlertTriangle className="size-3.5" />
                        The scanner could not clear this one
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {d.scan.reasons.map((r) => (
                          <li key={r} className="text-xs leading-relaxed text-muted-foreground">
                            · {r}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            setDocs((docs) =>
                              docs.map((x) =>
                                x.id === d.id
                                  ? { ...x, verified: true, scan: { ...x.scan, status: "passed", reasons: [] } }
                                  : x
                              )
                            )
                          }
                        >
                          <ShieldCheck className="size-4" />
                          Accept anyway
                        </Button>
                        <Button variant="outline" size="sm">
                          Ask for a replacement
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {DOC_TYPES.filter((t) => t !== "Other").map((t) => (
            <Button key={t} variant="outline" size="xs" onClick={() => addDoc(t)}>
              <Plus className="size-3" />
              {t}
            </Button>
          ))}
        </div>
      </Section>
    </Panel>
  );
}
