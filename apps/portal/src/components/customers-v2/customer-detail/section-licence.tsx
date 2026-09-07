"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Licence & driving — the licence, the ID, and gig-driver proof.
 *
 * Issue and expiry are READ-ONLY here on purpose: `customers` has no column for
 * either. The only place either date exists is what the verification provider
 * read off the document itself, which is a better source than a typed copy that
 * could quietly disagree with it.
 * ────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { AlertTriangle, Check, FileText, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui-v2/button";
import { useDeleteGigDriverImage, useGigDriverImages } from "@/hooks/use-gig-driver-images";
import GigDriverUploadDialog from "@/components/customers/gig-driver-upload-dialog";
import { EmptyHint, Field, Panel, Section, Thumb, Toggle, expiryOf, fmtDate, inputCls, listCls } from "./kit";
import { readSomething } from "./derive";
import type { SectionProps } from "./sections";

export function SectionLicence({ c, set, onJump, canEdit }: SectionProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const { data: gigImages } = useGigDriverImages(c.id);
  const deleteGig = useDeleteGigDriverImage();
  const exp = expiryOf(c.licence.expiry);

  const publicUrl = (path: string | null) =>
    path ? supabase.storage.from("gig-driver-images").getPublicUrl(path).data.publicUrl : null;

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
              disabled={!canEdit}
              value={c.licence.number}
              placeholder="A000-0000-XX"
              onChange={(e) => set({ license_number: e.target.value })}
            />
          </Field>
          <Field label="Issuing state">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.licence.state}
              placeholder="FL"
              maxLength={2}
              onChange={(e) => set({ license_state: e.target.value.toUpperCase() })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Other ID on file"
              hint="A second number staff can match against — passport, national ID, or the last four of an SSN."
            >
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.licence.idNumber}
                placeholder="e.g. SSN ••••-0000"
                onChange={(e) => set({ id_number: e.target.value })}
              />
            </Field>
          </div>
        </div>

        {/*
         * Issue and expiry are not typed in, and that is deliberate rather than
         * an omission. `customers` has no column for either — the only place
         * the dates exist is the verification row, read off the document
         * itself. That is a better source than a field an operator could get
         * wrong, so the screen shows it and says where it came from.
         */}
        <div className="mt-5">
          <p className="mb-2.5 text-xs font-medium">Read off the document</p>
          <div className={listCls}>
            <div className="flex items-baseline justify-between gap-4 px-5 py-3">
              <span className="text-xs text-muted-foreground">Issued</span>
              <span className="text-[13px] font-medium">{fmtDate(c.licence.issued)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4 px-5 py-3">
              <span className="text-xs text-muted-foreground">Expires</span>
              <span
                className={cn(
                  "text-[13px] font-medium",
                  exp.state === "expired" && "text-destructive",
                  exp.state === "soon" && "text-warning"
                )}
              >
                {fmtDate(c.licence.expiry)}
              </span>
            </div>
          </div>
        </div>

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
          ) : exp.state === "none" ? (
            <FileText className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <AlertTriangle
              className={cn("size-4 shrink-0", exp.state === "expired" ? "text-destructive" : "text-warning")}
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
            ) : exp.state === "none" ? (
              <>
                No expiry date on record. It is captured when the licence is put through{" "}
                <button
                  type="button"
                  onClick={() => onJump("verification")}
                  className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
                >
                  Verification
                </button>
                , which is the only place this platform reads it from.
              </>
            ) : (
              <>
                Valid until {fmtDate(c.licence.expiry)}
                <span className="text-muted-foreground"> · {exp.days} days from today</span>
              </>
            )}
          </p>
        </div>
      </Section>

      <Section
        title="Gig driver"
        description="Rideshare and delivery drivers are underwritten differently, so we hold proof of the platform rather than taking their word for it."
      >
        <Toggle
          checked={c.licence.isGigDriver}
          disabled={!canEdit}
          onChange={(v) => set({ is_gig_driver: v })}
          label="This customer drives for a gig platform"
          hint="Uber, Lyft, DoorDash and similar."
        />

        {c.licence.isGigDriver && (
          <div className="mt-5">
            {(gigImages || []).length === 0 ? (
              <EmptyHint>No proof uploaded yet. A screenshot of their driver dashboard is enough.</EmptyHint>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {(gigImages || []).map((g) => {
                  const url = publicUrl(g.image_url);
                  return (
                    <div key={g.id} className="group relative">
                      <Thumb
                        className="aspect-[4/3] w-full"
                        src={url}
                        caption={g.file_name}
                        onClick={() => url && window.open(url, "_blank")}
                      />
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={`Remove ${g.file_name}`}
                          onClick={() => deleteGig.mutate(g)}
                          className="absolute right-2 top-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {canEdit && (
              <div className="mt-5">
                <Button variant="outline" onClick={() => setUploadOpen(true)}>
                  <Plus className="size-4" />
                  Add proof
                </Button>
              </div>
            )}
          </div>
        )}
      </Section>

      {readSomething(c) && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The licence number above is what{" "}
          <button
            type="button"
            onClick={() => onJump("verification")}
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
          >
            Verification
          </button>{" "}
          checked. Change it and it will say so itself.
        </p>
      )}

      <GigDriverUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} customerId={c.id} />
    </Panel>
  );
}
