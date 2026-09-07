"use client";

/**
 * THE CAR — one tab. Photos on top, then what it is.
 *
 * A car record reads picture-first: it is how anyone recognises which one this
 * is, faster than a plate and much faster than a name. So the gallery is the
 * first thing on the tab, and the fields sit under it.
 *
 * Where it came from and what it cost are not here. That is the start of the
 * car's money story, and it lives in Money next to what it has earned.
 */

import Image from "next/image";
import { Plus, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { ActionButton, EmptyHint, Field, Panel, textareaCls } from "@/app/playground/_shared";
import { CATEGORIES, FUEL_TYPES, type Identity, type Photo } from "./_data";
import { AffixInput, IconButton, Section, Select } from "./_ui";

/** The pool a new photo is drawn from — the six files in `public/images/playground/`. */
const POOL = [1, 2, 3, 4, 5, 6].map((n) => `/images/playground/car${n}.jpeg`);

export function VehicleTab({
  identity,
  onIdentity,
  photos,
  onPhotos,
  makeId,
}: {
  identity: Identity;
  onIdentity: (fn: (i: Identity) => Identity) => void;
  photos: Photo[];
  onPhotos: (fn: (p: Photo[]) => Photo[]) => void;
  makeId: () => string;
}) {
  const set = (k: keyof Identity) => (v: string) => onIdentity((i) => ({ ...i, [k]: v }));

  /** The cover simply IS the first photo, so "set cover" and "reorder" are one gesture. */
  const setCover = (id: string) =>
    onPhotos((list) => {
      const picked = list.find((p) => p.id === id);
      return picked ? [picked, ...list.filter((p) => p.id !== id)] : list;
    });

  const remove = (id: string) => onPhotos((list) => list.filter((p) => p.id !== id));

  const add = () =>
    onPhotos((list) => {
      const used = new Set(list.map((p) => p.src));
      const src = POOL.find((s) => !used.has(s)) ?? POOL[list.length % POOL.length];
      return [...list, { id: makeId(), label: `Angle ${list.length + 1}`, src }];
    });

  return (
    <Panel title="Vehicle" description="What this car is and what it looks like. Everything applies as you type.">
      <Section
        title="Photos"
        hint="The first one is the cover."
        action={
          <ActionButton onClick={add} variant="outline">
            <Plus className="size-4" />
            Add photo
          </ActionButton>
        }
      >
        {photos.length === 0 ? (
          <EmptyHint>No photos yet.</EmptyHint>
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
                    <Image
                      src={p.src}
                      alt={p.label}
                      fill
                      sizes="24rem"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                    {isCover && (
                      <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-card/90 px-2.5 py-1 text-[11px] font-medium text-primary backdrop-blur-sm">
                        <Star className="size-3" strokeWidth={2.5} />
                        Cover
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{p.label}</span>
                    {!isCover && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => setCover(p.id)}
                        className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <Star className="size-3" />
                        Cover
                      </Button>
                    )}
                    <IconButton title="Remove photo" onClick={() => remove(p.id)}>
                      <X className="size-3.5" />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="The car">
        <div className="grid grid-cols-2 gap-5">
          <Field label="Make">
            <AffixInput value={identity.make} onChange={set("make")} placeholder="Honda" />
          </Field>
          <Field label="Model">
            <AffixInput value={identity.model} onChange={set("model")} placeholder="Accord Sport" />
          </Field>
          <Field label="Year">
            <AffixInput value={identity.year} onChange={set("year")} placeholder="2023" />
          </Field>
          <Field label="Colour">
            <AffixInput value={identity.colour} onChange={set("colour")} placeholder="Black" />
          </Field>
          <Field label="Fuel">
            <Select value={identity.fuelType} onChange={set("fuelType")} options={FUEL_TYPES} placeholder="Not set" />
          </Field>
          <Field label="Class">
            <Select value={identity.category} onChange={set("category")} options={CATEGORIES} placeholder="Not set" />
          </Field>
          <Field label="Registration plate">
            <AffixInput value={identity.registration} onChange={set("registration")} placeholder="6HNA118" />
          </Field>
          <Field label="VIN" hint="Never shown publicly.">
            <AffixInput value={identity.vin} onChange={set("vin")} placeholder="1HGCV1F34PA004471" />
          </Field>
        </div>
      </Section>

      <Section title="Description" hint="Shown on the public listing under the photos.">
        <textarea
          value={identity.description}
          onChange={(e) => set("description")(e.target.value)}
          rows={3}
          placeholder="Hybrid saloon, one owner from new. Apple CarPlay, adaptive cruise, heated front seats."
          className={textareaCls}
        />
      </Section>
    </Panel>
  );
}
