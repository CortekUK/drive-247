/**
 * Autofill — a developer convenience for the Northwind canary.
 *
 * Switched on from the super-admin Developer page (apps/admin, Previews card →
 * "Autofill buttons"). The switch is saved on `dev_signup_rehearsal.portal_previews`
 * and copied into this browser by `components/dev/dev-bridge.tsx`. While it is
 * on, the v2 add-customer and add-vehicle dialogs show a small wand in their
 * top-right corner that fills every field with random, valid sample data, so a
 * flow can be walked end to end without typing the whole form each time.
 *
 * TWO GATES, both at the consumer (`useDevAutofill`):
 *   - the tenant SLUG must be northwind (never an id — V2_PLAN §2);
 *   - the switch must be on in this browser.
 * Unlike `dev-overrides.ts` this is NOT limited to `next dev`: it only fills
 * fields the user could have typed, so it is safe on the live canary too, and
 * the flow is often tested there. Every other tenant never sees the wand —
 * DevBridge does not even poll for them.
 *
 * The generated records are ordinary rows once saved; nothing marks them as
 * sample data. Use names like these only on Northwind.
 */

import { addDays, format, subDays } from "date-fns";
import { useEffect, useState } from "react";

import { useTenant } from "@/contexts/TenantContext";
import { NORTHWIND } from "@/lib/v2";

export const AUTOFILL_KEY = "d247.dev.autofillForms";
export const AUTOFILL_EVENT = "d247:dev-autofill";

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readAutofill(): boolean {
  try {
    return store()?.getItem(AUTOFILL_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutofill(on: boolean): void {
  const s = store();
  if (!s) return;
  try {
    if (on) s.setItem(AUTOFILL_KEY, "1");
    else s.removeItem(AUTOFILL_KEY);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(AUTOFILL_EVENT));
}

/** True only on Northwind with the Developer-page switch on. */
export function useDevAutofill(): boolean {
  const { tenant } = useTenant();
  const isCanary = tenant?.slug === NORTHWIND;
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!isCanary) return;
    const sync = () => setOn(readAutofill());
    sync();
    window.addEventListener(AUTOFILL_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(AUTOFILL_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [isCanary]);

  return isCanary && on;
}

/* ───────────────────────────────── random ───────────────────────────────── */

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const int = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const chance = (p: number) => Math.random() < p;
const chars = (alphabet: string, n: number) => Array.from({ length: n }, () => pick(alphabet.split(""))).join("");

const DIGITS = "0123456789";
const LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";
/** VINs never use I, O or Q. */
const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";

const FIRST = ["Jordan", "Avery", "Maya", "Liam", "Sofia", "Noah", "Elena", "Marcus", "Priya", "Daniel", "Chloe", "Omar", "Grace", "Lucas", "Nina", "Ethan"];
const LAST = ["Ellis", "Carter", "Nguyen", "Brooks", "Patel", "Rivera", "Hughes", "Foster", "Kim", "Morgan", "Reyes", "Bennett", "Hayes", "Ortiz", "Walsh"];
const RELATIONS = ["Spouse", "Parent", "Sibling", "Partner", "Friend"];
const STREETS = ["Maple Ave", "Oak Street", "Pine Road", "Cedar Lane", "Lakeview Drive", "Main Street", "Elm Court"];
const CITIES = [
  ["Denver", "CO", "802"],
  ["Austin", "TX", "787"],
  ["Tampa", "FL", "336"],
  ["Chicago", "IL", "606"],
  ["Newark", "NJ", "071"],
] as const;

const phone = () => `+1 555 ${chars(DIGITS, 3)} ${chars(DIGITS, 4)}`;
const address = () => {
  const [city, state, zip] = pick(CITIES);
  return `${int(10, 9800)} ${pick(STREETS)}, ${city}, ${state} ${zip}${chars(DIGITS, 2)}`;
};

/** Values for `customerFormModalSchema`. Unique enough to pass the duplicate checks. */
export function randomCustomer() {
  const first = pick(FIRST);
  const last = pick(LAST);
  const tag = chars(DIGITS, 4);
  const nokFirst = pick(FIRST);
  return {
    customer_type: "Individual" as const,
    company_name: "",
    company_registration: "",
    name: `${first} ${last}`,
    email: `${first}.${last}.${tag}@example.com`.toLowerCase(),
    phone: phone(),
    date_of_birth: format(subDays(new Date(), int(21 * 365, 60 * 365)), "yyyy-MM-dd"),
    license_number: `${pick(LETTERS.split(""))}${chars(DIGITS, 7)}`,
    id_number: `${chars(LETTERS, 2)}${chars(DIGITS, 7)}`,
    is_gig_driver: false,
    status: "Active" as const,
    notes: "",
    nok_full_name: `${nokFirst} ${last}`,
    nok_relationship: pick(RELATIONS),
    nok_phone: phone(),
    nok_email: `${nokFirst}.${last}.${tag}@example.com`.toLowerCase(),
    nok_address: address(),
  };
}

const CARS = [
  ["Toyota", "Corolla", 45, "Hybrid"],
  ["Toyota", "Camry", 55, "Hybrid"],
  ["Honda", "Civic", 45, "Petrol"],
  ["Honda", "CR-V", 65, "Petrol"],
  ["Tesla", "Model 3", 85, "Electric"],
  ["Tesla", "Model Y", 95, "Electric"],
  ["Ford", "Mustang", 90, "Petrol"],
  ["Chevrolet", "Malibu", 50, "Petrol"],
  ["Hyundai", "Elantra", 42, "Petrol"],
  ["Kia", "Sportage", 60, "Diesel"],
  ["Nissan", "Altima", 48, "Petrol"],
  ["BMW", "330i", 110, "Petrol"],
] as const;
const COLOURS = [
  ["Pearl White", "#e8e6df"],
  ["Midnight Black", "#1f2125"],
  ["Silver", "#a7abb1"],
  ["Deep Blue", "#284b8c"],
  ["Race Red", "#b3262c"],
  ["Graphite", "#4b4f56"],
] as const;
const DESCRIPTIONS = [
  "Clean, comfortable and easy on fuel. Bluetooth, backup camera and plenty of room for luggage.",
  "A smooth daily driver with Apple CarPlay, keyless entry and a spotless interior.",
  "Great for city trips and weekends away. Non-smoking, recently detailed.",
];

/**
 * Values for `addVehicleDialogSchema`, plus the colour as hex for the sample
 * photo. Dates obey the schema: bought in the past, inspection and
 * registration due in the future, model year at most one ahead of the
 * purchase year, warranty end after start.
 */
export function randomVehicle(pickupLocationIds: string[] = []) {
  const [make, model, base, fuel] = pick(CARS);
  const [colour, hex] = pick(COLOURS);
  const acquired = subDays(new Date(), int(20, 900));
  const year = int(Math.max(2018, acquired.getFullYear() - 5), acquired.getFullYear() + (chance(0.3) ? 1 : 0));
  const daily = base + int(-5, 15);
  const financed = chance(0.3);
  const spare = chance(0.6);
  return {
    hex,
    values: {
      make,
      model,
      year,
      colour,
      reg: `NW${chars(LETTERS, 1)} ${chars(DIGITS, 3)}${chars(LETTERS, 1)}`,
      vin: chars(VIN_CHARS, 17),
      fuel_type: fuel,
      acquisition_type: financed ? ("Finance" as const) : ("Purchase" as const),
      acquisition_date: acquired,
      purchase_price: financed ? undefined : int(14, 48) * 1000,
      contract_total: financed ? int(18, 55) * 1000 : undefined,
      daily_rent: daily,
      weekly_rent: Math.round(daily * 6),
      monthly_rent: Math.round(daily * 22),
      security_deposit: pick([200, 250, 300, 500]),
      daily_mileage: pick([150, 200, 250]),
      weekly_mileage: pick([1000, 1200, 1500]),
      monthly_mileage: pick([3000, 3500, 4000]),
      excess_mileage_rate: pick([0.25, 0.35, 0.5]),
      available_daily: true,
      available_weekly: chance(0.85),
      available_monthly: chance(0.7),
      pickup_location_id: pickupLocationIds.length && chance(0.7) ? pick(pickupLocationIds) : "",
      mot_due_date: addDays(new Date(), int(30, 330)),
      tax_due_date: addDays(new Date(), int(30, 330)),
      warranty_start_date: acquired,
      warranty_end_date: addDays(acquired, 3 * 365),
      has_logbook: chance(0.7),
      has_service_plan: chance(0.5),
      has_tracker: chance(0.6),
      has_remote_immobiliser: chance(0.4),
      has_spare_key: spare,
      spare_key_holder: spare ? pick(["Company", "Customer"] as const) : undefined,
      spare_key_notes: spare ? pick(["In the office key safe", "Drawer 2, front desk", "With the fleet manager"]) : "",
      security_notes: pick(["", "Tracker hidden under the rear seat", "Steering lock in the trunk"]),
      description: pick(DESCRIPTIONS),
    },
  };
}

/**
 * Northwind's AI-generated demo car photos, already in the public
 * `vehicle-photos` bucket (CORS open). The wand fetches a random 3–5 of them
 * and attaches them as if they had been picked from disk, so the upload path
 * is exercised for real. There is no car3 — it was never uploaded.
 */
const DEMO_PHOTO_BASE =
  `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://hviqoaokxvlancmftwuo.supabase.co"}/storage/v1/object/public/vehicle-photos/`;
const DEMO_PHOTOS = ["northwind-demo-car1.jpeg", "northwind-demo-car2.jpeg", "northwind-demo-car4.jpeg", "northwind-demo-car5.jpeg", "northwind-demo-car6.jpeg"];

/** A random 3–5 of the demo photos as Files. Any that fail to load are skipped. */
export async function sampleCarPhotos(): Promise<File[]> {
  const chosen = [...DEMO_PHOTOS].sort(() => Math.random() - 0.5).slice(0, int(3, 5));
  const files = await Promise.all(
    chosen.map(async (name, i) => {
      try {
        const res = await fetch(DEMO_PHOTO_BASE + name);
        if (!res.ok) return null;
        const blob = await res.blob();
        return new File([blob], `sample-${Date.now()}-${i}.jpeg`, { type: blob.type || "image/jpeg" });
      } catch {
        return null;
      }
    }),
  );
  return files.filter((f): f is File => f !== null);
}

/**
 * The fallback when the demo photos cannot be fetched (offline, bucket moved):
 * a plain sample photo, the car's colour, its name across it. Drawn on a
 * canvas so there is no file to keep in the repo and nothing to download.
 */
export function samplePhoto(label: string, hex: string): Promise<File | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 800;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      const g = ctx.createLinearGradient(0, 0, 1200, 800);
      g.addColorStop(0, hex);
      g.addColorStop(1, "#0f172a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1200, 800);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "600 72px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, 600, 410);
      ctx.font = "400 32px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText("Sample photo", 600, 470);
      canvas.toBlob((blob) => {
        resolve(blob ? new File([blob], `sample-${Date.now()}.png`, { type: "image/png" }) : null);
      }, "image/png");
    } catch {
      resolve(null);
    }
  });
}
