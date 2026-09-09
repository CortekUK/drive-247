"use client";

/**
 * THE CAR — one tab. Photos on top, then what it is.
 *
 * A car record reads picture-first: it is how anyone recognises which one this
 * is, faster than a plate and much faster than a name. So the gallery is the
 * first thing on the tab and the fields sit under it.
 *
 * Where it came from and what it cost are not here. That is the start of the
 * car's money story, and it lives in Money next to what it has earned.
 */

import { useRef } from "react";
import { Loader2, Plus, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import {
  ActionButton,
  EmptyHint,
  Field,
  IconButton,
  NumberInput,
  Panel,
  Section,
  Select,
  TextInput,
  textareaCls,
} from "./kit";
import type { VehiclePhoto, VehicleRecord } from "./use-vehicle-record";

/**
 * Both lists are CHECK constraints on `vehicles`, not conventions:
 *   vehicles_fuel_type_check  Petrol | Diesel | Hybrid | Electric
 *   vehicles_category_check   economy | sedan | suv | luxury | van | electric
 *
 * The category values are stored lowercase, so they are shown through a label
 * rather than raw — an operator should not have to read "suv" in a form.
 * Offering a value outside either list makes the write fail on the constraint,
 * which with a debounced save surfaces as a toast some seconds after the click.
 */
const FUEL_TYPES = ["Petrol", "Diesel", "Hybrid", "Electric"];

const CATEGORIES = [
  { value: "economy", label: "Economy" },
  { value: "sedan", label: "Sedan" },
  { value: "suv", label: "SUV" },
  { value: "luxury", label: "Luxury" },
  { value: "van", label: "Van" },
  { value: "electric", label: "Electric" },
];

export function VehicleTab({
  vehicle,
  patch,
  photos,
  onUpload,
  onRemovePhoto,
  onMakeCover,
  isUploading,
  readOnly,
}: {
  vehicle: VehicleRecord;
  patch: (fields: Partial<VehicleRecord>) => void;
  photos: VehiclePhoto[];
  onUpload: (files: File[]) => void;
  onRemovePhoto: (id: string) => void;
  onMakeCover: (id: string) => void;
  isUploading: boolean;
  readOnly: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Panel
      title="Vehicle"
      description="What this car is and what it looks like. Everything applies as you type."
    >
      <Section
        tourId="vehicle-photos"
        title="Photos"
        hint="The first one is the cover — on the booking site and everywhere in the portal."
        action={
          !readOnly && (
            <ActionButton onClick={() => fileRef.current?.click()} variant="outline" disabled={isUploading}>
              {isUploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {isUploading ? "Uploading" : "Add photo"}
            </ActionButton>
          )
        }
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onUpload(files);
            // Clear it, or picking the same file twice in a row does nothing.
            e.target.value = "";
          }}
        />

        {photos.length === 0 ? (
          <EmptyHint>
            No photos yet. A listing without photographs takes a fraction of the bookings.
          </EmptyHint>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {photos.map((p, i) => {
              const isCover = i === 0;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "group relative overflow-hidden rounded-4xl bg-card shadow-md transition-all",
                    isCover ? "ring-2 ring-primary/40" : "ring-1 ring-foreground/5",
                  )}
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                    {/* A plain <img>: these URLs come from whatever bucket or
                        host the row happens to carry, and next/image throws at
                        runtime on a host that is not in remotePatterns. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.photo_url}
                      alt=""
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                    {isCover && (
                      <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-card/90 px-2.5 py-1 text-[11px] font-medium text-primary backdrop-blur-sm">
                        <Star className="size-3" strokeWidth={2.5} />
                        Cover
                      </span>
                    )}
                  </div>
                  {!readOnly && (
                    <div className="flex items-center gap-2 px-4 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        Photo {i + 1}
                      </span>
                      {!isCover && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => onMakeCover(p.id)}
                          className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Star className="size-3" />
                          Cover
                        </Button>
                      )}
                      <IconButton title="Remove photo" onClick={() => onRemovePhoto(p.id)}>
                        <X className="size-3.5" />
                      </IconButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="The car">
        <div className="grid grid-cols-2 gap-5">
          <Field label="Make">
            <TextInput
              value={vehicle.make}
              onChange={(v) => patch({ make: v })}
              placeholder="Honda"
              disabled={readOnly}
            />
          </Field>
          <Field label="Model">
            <TextInput
              value={vehicle.model}
              onChange={(v) => patch({ model: v })}
              placeholder="Accord Sport"
              disabled={readOnly}
            />
          </Field>
          <Field label="Year">
            <NumberInput
              value={vehicle.year}
              onChange={(n) => patch({ year: n || null })}
              placeholder="2023"
              disabled={readOnly}
            />
          </Field>
          <Field label="Colour">
            <TextInput
              value={vehicle.colour}
              onChange={(v) => patch({ colour: v })}
              placeholder="Black"
              disabled={readOnly}
            />
          </Field>
          <Field label="Fuel">
            <Select
              value={vehicle.fuel_type}
              onChange={(v) => patch({ fuel_type: v || null })}
              options={FUEL_TYPES}
              placeholder="Not set"
              disabled={readOnly}
            />
          </Field>
          <Field label="Class">
            <Select
              value={vehicle.category}
              onChange={(v) => patch({ category: v || null })}
              options={CATEGORIES}
              placeholder="Not set"
              disabled={readOnly}
            />
          </Field>
          <Field label="Registration plate">
            <TextInput
              value={vehicle.reg}
              onChange={(v) => patch({ reg: v })}
              placeholder="6HNA118"
              disabled={readOnly}
            />
          </Field>
          <Field label="VIN" hint="Never shown to a customer.">
            <TextInput
              value={vehicle.vin}
              onChange={(v) => patch({ vin: v })}
              placeholder="1HGCV1F34PA004471"
              disabled={readOnly}
            />
          </Field>
        </div>
      </Section>

      <Section title="Description" hint="Shown on the public listing under the photos.">
        <textarea
          value={vehicle.description ?? ""}
          onChange={(e) => patch({ description: e.target.value })}
          rows={3}
          disabled={readOnly}
          placeholder="Hybrid saloon, one owner from new. Apple CarPlay, adaptive cruise, heated front seats."
          className={textareaCls}
        />
      </Section>
    </Panel>
  );
}
