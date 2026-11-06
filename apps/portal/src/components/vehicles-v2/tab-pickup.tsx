"use client";

/**
 * OPERATIONS — Pickup & handover.
 *
 * Where the customer collects this car, and how they get the keys.
 *
 * The sandbox had a three-way handover chooser (in person / lockbox /
 * delivery). The database has no such column on `vehicles` — handover is
 * decided per RENTAL (`rentals.delivery_method`), and what the CAR carries is
 * only whether a lockbox has been set up for it. So the chooser is gone and
 * the lockbox is a switch, which is the same information without pretending
 * there is a setting behind it that there isn't.
 */

import { useState } from "react";
import Link from "next/link";
import { KeyRound, RefreshCw } from "lucide-react";
import {
  useFmt,
  ActionButton,
  Aside,
  EmptyHint,
  Field,
  List,
  OptionCard,
  Panel,
  Pill,
  Section,
  SwitchRow,
  TextInput,
  textareaCls,
} from "./kit";
import type { PickupLocation } from "@/hooks/use-pickup-locations";
import type { VehicleRecord } from "./use-vehicle-record";

/** Settings → Lockbox accepts 1–20 digits; blank means "any length". */
const CODE_LENGTH_MIN = 1;
const CODE_LENGTH_MAX = 20;
const CODE_LENGTH_DEFAULT = 4;

/**
 * How many digits Generate makes: the length set in Settings → Lockbox.
 *
 * This used to clamp to 3–8, so a fleet set to 10 digits got 8-digit codes
 * from the button next to a page that promised otherwise. Blank, zero or
 * nonsense in Settings means "any length", which takes the default.
 */
export function lockboxCodeDigits(settingLength: number | null | undefined): number {
  const n = Number(settingLength);
  if (!Number.isInteger(n) || n < CODE_LENGTH_MIN) return CODE_LENGTH_DEFAULT;
  return Math.min(n, CODE_LENGTH_MAX);
}

const settingsLink = "font-medium underline underline-offset-2 hover:text-foreground";

export function PickupTab({
  vehicle,
  patch,
  patchNow,
  locations,
  lockboxEnabled,
  lockboxCodeLength,
  readOnly,
}: {
  vehicle: VehicleRecord;
  patch: (fields: Partial<VehicleRecord>) => void;
  patchNow: (fields: Partial<VehicleRecord>) => void;
  locations: PickupLocation[];
  /** Tenant-level. With it off, no lockbox message is ever sent. */
  lockboxEnabled: boolean;
  lockboxCodeLength: number;
  readOnly: boolean;
}) {
  const fmt = useFmt();
  /*
   * On = the fields exist (are not NULL), even while still empty.
   *
   * Switching on writes an empty code and empty instructions, and "on" used to
   * be read back as "has a non-empty code or instructions" — so the switch
   * flipped straight off again and the fields never appeared. Off writes NULL,
   * so NULL vs "" is exactly the switch, and it survives a refresh. Everything
   * that SENDS a code reads `lockbox_code || null`, so an empty one is still
   * "no code" there. `switchedOn` only bridges the moment before the write lands.
   */
  const [switchedOn, setSwitchedOn] = useState(false);
  const lockboxOn =
    switchedOn || vehicle.lockbox_code != null || vehicle.lockbox_instructions != null;

  const generateCode = () => {
    const length = lockboxCodeDigits(lockboxCodeLength);
    const code = Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");
    patchNow({ lockbox_code: code });
  };

  return (
    <Panel
      title="Pickup & handover"
      description="Where the customer collects this car, and how they get the keys."
    >
      <Section
        title="Pickup location"
        hint="Locations are set up in Settings → Locations. This picks the one this car lives at."
      >
        {locations.length === 0 ? (
          <EmptyHint>
            No pickup locations yet. Add them in{" "}
            <Link href="/settings?tab=locations" className={settingsLink}>
              Settings → Locations
            </Link>{" "}
            and they will appear here.
          </EmptyHint>
        ) : (
          <div className="space-y-2.5">
            <OptionCard
              selected={!vehicle.pickup_location_id}
              onClick={() => !readOnly && patchNow({ pickup_location_id: null })}
              title="No fixed location"
              subtitle="The customer is asked where they want it, as the tenant's default allows"
            />
            {locations.map((loc) => {
              const selected = vehicle.pickup_location_id === loc.id;
              /* An inactive location is never offered on the booking site, so a
                 car newly pinned to one could not be collected anywhere. It can
                 still be shown — and left — if the car was already there. */
              const blocked = !loc.is_active && !selected;
              return (
                <OptionCard
                  key={loc.id}
                  selected={selected}
                  onClick={() => !readOnly && !blocked && patchNow({ pickup_location_id: loc.id })}
                  title={loc.name}
                  subtitle={
                    !loc.is_active
                      ? "Inactive — not offered to customers, so a car cannot be placed here"
                      : [loc.address, loc.description].filter(Boolean).join(" · ")
                  }
                  right={
                    !loc.is_active ? (
                      <Pill tone="neutral">Inactive</Pill>
                    ) : Number(loc.delivery_fee) > 0 ? (
                      <Pill tone="neutral">{`${fmt.moneyExact(Number(loc.delivery_fee))} fee`}</Pill>
                    ) : (
                      <Pill tone="success">Free</Pill>
                    )
                  }
                />
              );
            })}
          </div>
        )}

        <div className="mt-5 max-w-xs">
          <Field label="Garaged in" hint="The state it is kept and insured in.">
            <TextInput
              value={vehicle.garaging_state}
              onChange={(v) => patch({ garaging_state: v })}
              placeholder="Colorado"
              disabled={readOnly}
            />
          </Field>
        </div>
      </Section>

      <Section
        tourId="vehicle-lockbox"
        title="Lockbox"
        hint="Lets a customer collect unattended — they are sent the code and where to find the box."
        action={lockboxOn ? <Pill tone="primary">Set up</Pill> : <Pill tone="neutral">Off</Pill>}
      >
        {!lockboxEnabled && (
          <div className="mb-4">
            <Aside tone="warning">
              Lockbox handover is switched off for the whole fleet, so no code is sent to customers.
              Turn it on in{" "}
              <Link href="/settings?tab=lockbox" className={settingsLink}>
                Settings → Lockbox
              </Link>{" "}
              first.
            </Aside>
          </div>
        )}

        <List>
          <SwitchRow
            checked={lockboxOn}
            disabled={readOnly}
            onChange={(v) => {
              setSwitchedOn(v);
              patchNow(
                v
                  ? { lockbox_code: "", lockbox_instructions: "" }
                  : { lockbox_code: null, lockbox_instructions: null },
              );
            }}
            label="This car has a lockbox"
            hint={lockboxOn ? undefined : "Keys are handed over in person"}
          />
        </List>

        {lockboxOn && (
          <div className="mt-4 space-y-5 rounded-3xl bg-primary-light/50 p-5 ring-1 ring-primary/20">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-[10rem_1fr]">
              <Field label="Code">
                <div className="flex gap-2">
                  <TextInput
                    value={vehicle.lockbox_code}
                    onChange={(v) => patch({ lockbox_code: v })}
                    placeholder="4471"
                    disabled={readOnly}
                  />
                  {!readOnly && (
                    <ActionButton variant="outline" onClick={generateCode}>
                      <RefreshCw className="size-4" />
                    </ActionButton>
                  )}
                </div>
              </Field>
              <Field label="Where to find it" hint="Sent to the customer alongside the code.">
                <textarea
                  value={vehicle.lockbox_instructions ?? ""}
                  onChange={(e) => patch({ lockbox_instructions: e.target.value })}
                  rows={2}
                  disabled={readOnly}
                  placeholder="Rear left wheel arch — magnetic box behind the mudflap."
                  className={textareaCls}
                />
              </Field>
            </div>

            {!vehicle.lockbox_code && (
              <Aside tone="warning">
                <span className="inline-flex items-center gap-1.5">
                  <KeyRound className="size-3.5" />
                  No code set — the customer would get the instructions and nothing to open the box
                  with.
                </span>
              </Aside>
            )}
          </div>
        )}
      </Section>
    </Panel>
  );
}
