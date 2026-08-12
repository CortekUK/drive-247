import {
  calculateRentalPriceBreakdown,
  type Holiday,
  type TenantWeekendConfig,
  type VehicleDailyPrice,
  type VehicleOverride,
} from "@/lib/calculate-rental-price";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { formatCurrency } from "@/lib/format-utils";

export const QUOTE_HOLDING_STATUSES = new Set([
  "pending",
  "active",
  "upcoming",
  "confirmed",
  "started",
]);

const PHYSICALLY_OUT_STATUSES = new Set(["active", "started"]);
const RETURNED_RENTAL_STATUSES = new Set(["completed", "closed"]);
const RENTABLE_VEHICLE_STATUSES = new Set(["available", "rented"]);

export interface FleetQuoteVehicle {
  id: string;
  reg: string;
  make: string | null;
  model: string | null;
  year?: number | null;
  category?: string | null;
  status?: string | null;
  is_disposed?: boolean | null;
  available_daily?: boolean | null;
  available_weekly?: boolean | null;
  available_monthly?: boolean | null;
  daily_rent?: number | string | null;
  weekly_rent?: number | string | null;
  monthly_rent?: number | string | null;
  security_deposit?: number | string | null;
  photo_url?: string | null;
  vehicle_photos?: Array<{ photo_url?: string | null; display_order?: number | null }> | null;
}

export interface FleetQuoteRental {
  id?: string;
  vehicle_id: string | null;
  start_date: string;
  end_date: string | null;
  pickup_time?: string | null;
  return_time?: string | null;
  status?: string | null;
  is_pay_as_you_go?: boolean | null;
  payg_closed_at?: string | null;
}

export interface FleetQuoteBlock {
  vehicle_id: string | null;
  start_date: string;
  end_date: string;
  reason?: string | null;
}

export interface FleetQuoteConfig {
  startDate: string;
  endDate: string;
  pickupTime: string;
  returnTime: string;
  bufferMinutes: number;
  monthlyTierDays: number;
  weekendConfig: TenantWeekendConfig | null;
  holidays: Holiday[];
  overrides: VehicleOverride[];
  dailyPrices: Array<VehicleDailyPrice & { vehicle_id: string }>;
  today?: string;
  timezone?: string | null;
  nowMs?: number;
  securityDepositEnabled?: boolean | null;
  depositMode?: string | null;
  globalSecurityDeposit?: number | string | null;
}

export interface FleetQuoteLine {
  vehicleId: string;
  registration: string;
  name: string;
  category: string | null;
  photoUrl: string | null;
  total: number;
  rentalDays: number;
  pricingTier: "daily" | "weekly" | "monthly";
  effectiveDailyRate: number;
  securityDeposit: number | null;
  hasDynamicPricing: boolean;
  priceFingerprint: string;
}

export interface FleetQuoteExclusion {
  vehicleId: string;
  registration: string;
  name: string;
  reason:
    | "Not rentable"
    | "Duration not enabled"
    | "Booked"
    | "Blocked"
    | "Missing price";
  detail: string;
}

export interface FleetQuoteResult {
  available: FleetQuoteLine[];
  excluded: FleetQuoteExclusion[];
  rentalDays: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidLocalDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

export function shiftLocalDate(value: string, calendarDays: number): string {
  if (!isValidLocalDate(value) || !Number.isFinite(calendarDays)) return value;
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + Math.trunc(calendarDays)));
  return shifted.toISOString().slice(0, 10);
}

export function validateQuoteRange(
  startDate: string,
  endDate: string,
  pickupTime: string,
  returnTime: string,
  timezone?: string | null,
): string | null {
  if (!isValidLocalDate(startDate) || !isValidLocalDate(endDate)) {
    return "Choose valid pickup and return dates.";
  }
  if (!TIME_RE.test(pickupTime) || !TIME_RE.test(returnTime)) {
    return "Choose valid pickup and return times.";
  }
  if (timezone) {
    try {
      const pickupInstant = fromZonedTime(`${startDate}T${pickupTime}:00`, timezone);
      const returnInstant = fromZonedTime(`${endDate}T${returnTime}:00`, timezone);
      if (
        formatInTimeZone(pickupInstant, timezone, "yyyy-MM-dd HH:mm") !== `${startDate} ${pickupTime}` ||
        formatInTimeZone(returnInstant, timezone, "yyyy-MM-dd HH:mm") !== `${endDate} ${returnTime}`
      ) {
        return "Choose valid local times for your timezone.";
      }
    } catch {
      // A legacy invalid tenant timezone falls back to local date validation.
    }
  }
  const start = localDateTimeMs(startDate, pickupTime, timezone);
  const end = localDateTimeMs(endDate, returnTime, timezone);
  if (end <= start) return "Return must be after pickup.";
  return null;
}

function localDateTimeMs(date: string, time: string, timezone?: string | null): number {
  if (timezone) {
    try {
      const zoned = fromZonedTime(`${date}T${time.slice(0, 5)}:00`, timezone).getTime();
      if (Number.isFinite(zoned)) return zoned;
    } catch {
      // Fall back to the browser zone if a legacy tenant has an invalid zone.
    }
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

export function quoteStartsBeforeNow(
  startDate: string,
  pickupTime: string,
  timezone?: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!isValidLocalDate(startDate) || !TIME_RE.test(pickupTime)) return true;
  return localDateTimeMs(startDate, pickupTime, timezone) < nowMs;
}

function startOfLocalDayMs(date: string): number {
  return localDateTimeMs(date, "00:00");
}

function endOfLocalDayMs(date: string): number {
  return localDateTimeMs(date, "23:59") + 59_999;
}

export function rentalBlocksQuoteWindow(
  rental: FleetQuoteRental,
  config: Pick<FleetQuoteConfig, "startDate" | "endDate" | "pickupTime" | "returnTime" | "bufferMinutes" | "today" | "timezone">,
): boolean {
  if (!rental.vehicle_id) return false;
  const status = (rental.status ?? "").trim().toLowerCase();
  const paygClosedAt = rental.payg_closed_at ? Date.parse(rental.payg_closed_at) : Number.NaN;
  const hasValidPaygClosure = Number.isFinite(paygClosedAt);
  const isReturned = RETURNED_RENTAL_STATUSES.has(status) || hasValidPaygClosure;
  if (!QUOTE_HOLDING_STATUSES.has(status) && !isReturned) return false;

  const requestStart = localDateTimeMs(config.startDate, config.pickupTime, config.timezone);
  const requestEnd = localDateTimeMs(config.endDate, config.returnTime, config.timezone);
  const bufferMs = Math.max(0, Number(config.bufferMinutes) || 0) * 60_000;
  const rentalStart = localDateTimeMs(
    rental.start_date,
    rental.pickup_time?.slice(0, 5) || "00:00",
    config.timezone,
  ) - bufferMs;
  const today = config.today ?? new Date().toISOString().slice(0, 10);

  // Returned rentals no longer occupy the vehicle, but their post-return
  // cleaning/turnaround window still does. Exact buffer boundaries are free.
  if (isReturned) {
    const returnedAt = hasValidPaygClosure
      ? paygClosedAt
      : rental.end_date
        ? localDateTimeMs(
            rental.end_date,
            rental.return_time?.slice(0, 5) || "23:59",
            config.timezone,
          )
        : Number.NaN;
    if (!Number.isFinite(returnedAt)) return false;
    return rentalStart < requestEnd && returnedAt + bufferMs > requestStart;
  }

  // An open-ended rental, or a physically-out rental with a stale end date,
  // holds the car until staff explicitly closes it.
  const isOpenEnded = rental.end_date == null;
  const isOverdueAndOut =
    PHYSICALLY_OUT_STATUSES.has(status) &&
    rental.end_date != null &&
    rental.end_date < today;
  const rentalEnd = isOpenEnded || isOverdueAndOut
    ? Number.POSITIVE_INFINITY
    : localDateTimeMs(
        rental.end_date!,
        rental.return_time?.slice(0, 5) || "23:59",
        config.timezone,
      ) + bufferMs;

  // Adjacent handovers are allowed when the configured buffer is fully met.
  return rentalStart < requestEnd && rentalEnd > requestStart;
}

export function blockBlocksQuoteWindow(
  block: FleetQuoteBlock,
  startDate: string,
  endDate: string,
): boolean {
  return startOfLocalDayMs(block.start_date) <= endOfLocalDayMs(endDate) &&
    endOfLocalDayMs(block.end_date) >= startOfLocalDayMs(startDate);
}

function vehicleName(vehicle: FleetQuoteVehicle): string {
  const label = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();
  return label || vehicle.reg || "Vehicle";
}

function photoUrl(vehicle: FleetQuoteVehicle): string | null {
  if (vehicle.photo_url) return vehicle.photo_url;
  const sorted = [...(vehicle.vehicle_photos ?? [])].sort(
    (a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0),
  );
  return sorted.find((photo) => photo.photo_url)?.photo_url ?? null;
}

function positiveNumber(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function rentalDaysBetween(startDate: string, endDate: string): number {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  const diff = Date.UTC(endYear, endMonth - 1, endDay) -
    Date.UTC(startYear, startMonth - 1, startDay);
  return Math.max(1, Math.ceil(diff / 86_400_000));
}

function securityDepositForVehicle(
  vehicle: FleetQuoteVehicle,
  config: FleetQuoteConfig,
): number | null {
  if (config.securityDepositEnabled === false) return null;
  if (config.depositMode === "global") {
    return positiveNumber(config.globalSecurityDeposit) || null;
  }
  return positiveNumber(vehicle.security_deposit) || null;
}

function durationAvailabilityReason(
  vehicle: FleetQuoteVehicle,
  rentalDays: number,
  monthlyTierDays: number,
): string | null {
  if (rentalDays >= monthlyTierDays && vehicle.available_monthly === false) {
    return "Monthly rentals are disabled for this vehicle.";
  }
  if (rentalDays >= 7 && rentalDays < monthlyTierDays && vehicle.available_weekly === false) {
    return "Weekly rentals are disabled for this vehicle.";
  }
  if (rentalDays < 7 && vehicle.available_daily === false) {
    return "Daily rentals are disabled for this vehicle.";
  }
  return null;
}

export function buildFleetQuote(
  vehicles: FleetQuoteVehicle[],
  rentals: FleetQuoteRental[],
  blocks: FleetQuoteBlock[],
  config: FleetQuoteConfig,
): FleetQuoteResult {
  const rangeError = validateQuoteRange(
    config.startDate,
    config.endDate,
    config.pickupTime,
    config.returnTime,
    config.timezone,
  );
  if (rangeError) throw new Error(rangeError);
  if (
    typeof config.nowMs === "number" &&
    Number.isFinite(config.nowMs) &&
    quoteStartsBeforeNow(config.startDate, config.pickupTime, config.timezone, config.nowMs)
  ) {
    throw new Error("Pickup must be in the future.");
  }

  const rentalDays = rentalDaysBetween(config.startDate, config.endDate);
  const monthlyTierDays = Math.max(7, Number(config.monthlyTierDays) || 30);
  const available: FleetQuoteLine[] = [];
  const excluded: FleetQuoteExclusion[] = [];
  const seen = new Set<string>();

  for (const vehicle of vehicles) {
    if (!vehicle.id || seen.has(vehicle.id)) continue;
    seen.add(vehicle.id);
    const identity = {
      vehicleId: vehicle.id,
      registration: vehicle.reg || "No registration",
      name: vehicleName(vehicle),
    };
    const status = (vehicle.status ?? "").trim().toLowerCase();

    if (vehicle.is_disposed === true || !RENTABLE_VEHICLE_STATUSES.has(status)) {
      excluded.push({
        ...identity,
        reason: "Not rentable",
        detail: vehicle.is_disposed ? "Vehicle is disposed." : `Vehicle status is ${vehicle.status || "not set"}.`,
      });
      continue;
    }

    const durationReason = durationAvailabilityReason(vehicle, rentalDays, monthlyTierDays);
    if (durationReason) {
      excluded.push({ ...identity, reason: "Duration not enabled", detail: durationReason });
      continue;
    }

    const conflictingRental = rentals.find(
      (rental) => rental.vehicle_id === vehicle.id && rentalBlocksQuoteWindow(rental, config),
    );
    if (conflictingRental) {
      excluded.push({
        ...identity,
        reason: "Booked",
        detail: conflictingRental.end_date
          ? `Unavailable ${conflictingRental.start_date} to ${conflictingRental.end_date}.`
          : `Unavailable from ${conflictingRental.start_date} (ongoing rental).`,
      });
      continue;
    }

    const conflictingBlock = blocks.find(
      (block) =>
        (block.vehicle_id == null || block.vehicle_id === vehicle.id) &&
        blockBlocksQuoteWindow(block, config.startDate, config.endDate),
    );
    if (conflictingBlock) {
      excluded.push({
        ...identity,
        reason: "Blocked",
        detail: conflictingBlock.reason?.trim() || "Dates were blocked by the operator.",
      });
      continue;
    }

    const rates = {
      daily_rent: positiveNumber(vehicle.daily_rent),
      weekly_rent: positiveNumber(vehicle.weekly_rent),
      monthly_rent: positiveNumber(vehicle.monthly_rent),
    };
    if (!rates.daily_rent && !rates.weekly_rent && !rates.monthly_rent) {
      excluded.push({
        ...identity,
        reason: "Missing price",
        detail: "Add a daily, weekly, or monthly rental rate before quoting this vehicle.",
      });
      continue;
    }

    const vehicleOverrides = config.overrides.filter((override) => override.vehicle_id === vehicle.id);
    const vehicleDailyPrices = config.dailyPrices
      .filter((price) => price.vehicle_id === vehicle.id)
      .map(({ date, price }) => ({ date, price: Number(price) }));
    const breakdown = calculateRentalPriceBreakdown(
      config.startDate,
      config.endDate,
      rates,
      config.weekendConfig,
      config.holidays,
      vehicleOverrides,
      vehicle.id,
      monthlyTierDays,
      false,
      Boolean(config.weekendConfig?.stack_surcharges),
      vehicleDailyPrices,
    );

    if (!Number.isFinite(breakdown.rentalPrice) || breakdown.rentalPrice <= 0) {
      excluded.push({
        ...identity,
        reason: "Missing price",
        detail: "The configured rates could not produce a positive quote.",
      });
      continue;
    }

    const dynamicDays = breakdown.dayBreakdown.filter(
      (day) => day.type !== "regular" || day.surchargePercent !== 0,
    );
    const fingerprint = breakdown.dayBreakdown
      .map((day) => `${day.date}:${day.effectiveRate.toFixed(2)}`)
      .join("|");

    available.push({
      ...identity,
      category: vehicle.category ?? null,
      photoUrl: photoUrl(vehicle),
      total: breakdown.rentalPrice,
      rentalDays: breakdown.rentalDays,
      pricingTier: breakdown.pricingTier,
      effectiveDailyRate: Math.round((breakdown.rentalPrice / breakdown.rentalDays) * 100) / 100,
      securityDeposit: securityDepositForVehicle(vehicle, config),
      hasDynamicPricing: dynamicDays.length > 0,
      priceFingerprint: fingerprint,
    });
  }

  available.sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
  excluded.sort((a, b) => a.name.localeCompare(b.name));
  return { available, excluded, rentalDays };
}

export function quoteLinesChanged(previous: FleetQuoteLine[], current: FleetQuoteLine[]): boolean {
  if (previous.length !== current.length) return true;
  const currentById = new Map(current.map((line) => [line.vehicleId, line]));
  return previous.some((line) => {
    const next = currentById.get(line.vehicleId);
    return !next ||
      next.total !== line.total ||
      next.priceFingerprint !== line.priceFingerprint ||
      next.securityDeposit !== line.securityDeposit ||
      next.name !== line.name ||
      next.registration !== line.registration ||
      next.category !== line.category ||
      next.pricingTier !== line.pricingTier ||
      next.effectiveDailyRate !== line.effectiveDailyRate ||
      next.rentalDays !== line.rentalDays;
  });
}

export function isValidQuoteEmail(value: string): boolean {
  const email = value.trim();
  if (email.length > 254 || /[\r\n\s]/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return false;
  }
  if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  const labels = domain.split(".");
  if (labels.length < 2 || domain.length > 253) return false;
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/i.test(label),
  );
}

export function isValidQuoteReference(value: string): boolean {
  const reference = value.trim();
  return reference.length > 0 && reference.length <= 60 && !/[\u0000-\u001f\u007f]/.test(reference);
}

export function safeQuoteFilename(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "fleet-quote";
}

export function escapeQuoteHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]!);
}

export function formatQuotePlainText(input: {
  companyName: string;
  customerName?: string;
  quoteReference: string;
  startDate: string;
  endDate: string;
  pickupTime: string;
  returnTime: string;
  currency: string;
  lines: FleetQuoteLine[];
  validUntil?: string;
  note?: string;
  hideVehicleRegistration?: boolean;
}): string {
  const money = (value: number) => formatCurrency(value, input.currency);
  return [
    `${input.companyName} — Vehicle Quote ${input.quoteReference}`,
    input.customerName ? `Prepared for: ${input.customerName}` : "",
    `Rental period: ${input.startDate} ${input.pickupTime} to ${input.endDate} ${input.returnTime}`,
    input.validUntil ? `Quote valid until: ${input.validUntil}` : "",
    "",
    ...input.lines.map(
      (line, index) => {
        const identity = input.hideVehicleRegistration
          ? line.name
          : `${line.name} (${line.registration})`;
        return `${index + 1}. ${identity} — ${money(line.total)} total ` +
        `(${money(line.effectiveDailyRate)}/day effective, ${line.pricingTier} pricing)` +
        (line.securityDeposit ? `; security deposit: ${money(line.securityDeposit)}` : "");
      },
    ),
    input.note?.trim() ? `\nNote: ${input.note.trim()}` : "",
    "",
    "Prices are rental estimates for the dates shown and are subject to availability at confirmation. Deposits, optional extras, insurance, delivery, taxes, and payment fees may apply unless explicitly included.",
  ].filter((line) => line !== "").join("\n");
}

export function formatQuoteHtml(input: Parameters<typeof formatQuotePlainText>[0]): string {
  const money = (value: number) => formatCurrency(value, input.currency);
  const rows = input.lines.map((line) => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb">
        <strong>${escapeQuoteHtml(line.name)}</strong><br>
        ${!input.hideVehicleRegistration || line.category ? `<span style="color:#6b7280;font-size:12px">${input.hideVehicleRegistration ? "" : escapeQuoteHtml(line.registration)}${line.category ? `${input.hideVehicleRegistration ? "" : " · "}${escapeQuoteHtml(line.category)}` : ""}</span>` : ""}
      </td>
      <td style="padding:12px;border-bottom:1px solid #e5e7eb;text-align:right">
        <strong>${escapeQuoteHtml(money(line.total))}</strong><br>
        <span style="color:#6b7280;font-size:12px">${escapeQuoteHtml(money(line.effectiveDailyRate))}/day effective</span>
        ${line.securityDeposit ? `<br><span style="color:#6b7280;font-size:12px">Security deposit: ${escapeQuoteHtml(money(line.securityDeposit))}</span>` : ""}
      </td>
    </tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b">
    <div style="max-width:680px;margin:24px auto;background:white;border-radius:12px;overflow:hidden">
      <div style="padding:24px;background:#18181b;color:white">
        <h1 style="margin:0;font-size:22px">${escapeQuoteHtml(input.companyName)}</h1>
        <p style="margin:8px 0 0;color:#d4d4d8">Vehicle quote ${escapeQuoteHtml(input.quoteReference)}</p>
      </div>
      <div style="padding:24px">
        ${input.customerName ? `<p>Hello ${escapeQuoteHtml(input.customerName)},</p>` : ""}
        <p>Here are the vehicles available for <strong>${escapeQuoteHtml(input.startDate)} ${escapeQuoteHtml(input.pickupTime)}</strong> to <strong>${escapeQuoteHtml(input.endDate)} ${escapeQuoteHtml(input.returnTime)}</strong>.</p>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e5e7eb">${rows}</table>
        ${input.note?.trim() ? `<p><strong>Note:</strong> ${escapeQuoteHtml(input.note.trim()).replace(/\n/g, "<br>")}</p>` : ""}
        ${input.validUntil ? `<p style="font-size:13px"><strong>Valid until:</strong> ${escapeQuoteHtml(input.validUntil)}</p>` : ""}
        <p style="font-size:12px;line-height:1.5;color:#6b7280">Prices are rental estimates for the dates shown and are subject to availability at confirmation. Deposits, optional extras, insurance, delivery, taxes, and payment fees may apply unless explicitly included.</p>
      </div>
    </div></body></html>`;
}
