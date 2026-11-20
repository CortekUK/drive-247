export const FLEET_SIZE_OPTIONS = [
  "1–4 vehicles",
  "5–10 vehicles",
  "11–25 vehicles",
  "25+ vehicles",
] as const;

export const PLATFORM_OPTIONS = [
  "Turo",
  "Website",
  "Instagram / Facebook",
  "Google",
  "Manual / WhatsApp",
  "Other",
] as const;

export const BOOKING_SOURCE_OPTIONS = [
  "Turo",
  "Instagram / Facebook",
  "Website",
  "Referrals",
  "Google",
  "Other",
] as const;

export const BUDGET_OPTIONS = [
  "Under $500",
  "$500–$1,500",
  "$1,500–$3,000",
  "$3,000+",
  "Not sure yet",
] as const;

export const READINESS_OPTIONS = [
  "Ready to launch this week",
  "Ready if the system is a good fit",
  "Comparing options",
  "Just researching",
] as const;

/** "Rental company name" and "City and state" on Book a demo. */
export const COMPANY_NAME_MAX = 100;
export const CITY_STATE_MAX = 80;

export type StrategyCallSubmission = {
  name: string;
  email: string;
  /**
   * Null only for a post from a page loaded before the form asked (an old tab
   * still open across a deploy): the form itself requires both.
   */
  companyName: string | null;
  cityState: string | null;
  phone: string | null;
  fleetSize: (typeof FLEET_SIZE_OPTIONS)[number];
  currentPlatform: (typeof PLATFORM_OPTIONS)[number];
  mainBookingSource: (typeof BOOKING_SOURCE_OPTIONS)[number] | null;
  budget: (typeof BUDGET_OPTIONS)[number];
  readiness: (typeof READINESS_OPTIONS)[number];
};

export type ValidationResult =
  | { ok: true; value: StrategyCallSubmission }
  | { ok: false; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+().\-\s]{7,30}$/;

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function inOptions<T extends readonly string[]>(
  value: string,
  options: T
): value is T[number] {
  return options.includes(value);
}

export function validateStrategyCallSubmission(
  formData: FormData
): ValidationResult {
  for (const value of formData.values()) {
    if (typeof value !== "string" || value.length > 512) {
      return { ok: false, message: "Please check your answers and try again." };
    }
  }
  if (readString(formData, "website")) {
    // Honeypot: real users never see or fill this field.
    return { ok: false, message: "Please check your answers and try again." };
  }

  const name = readString(formData, "name").replace(/\s+/g, " ");
  const email = readString(formData, "email").toLowerCase();
  const oneLine = (key: string) => readString(formData, key).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const companyName = oneLine("company_name");
  const cityState = oneLine("city_state");
  // A post that carries the fields must fill them. One that does not carry
  // them at all is a page from before they were asked, and is kept rather
  // than refused: a lead without a city beats no lead.
  const asksBusiness = formData.has("company_name") || formData.has("city_state");
  const phone = readString(formData, "phone");
  const fleetSize = readString(formData, "fleet_size");
  const currentPlatform = readString(formData, "current_platform");
  // `challenge` is accepted only as a temporary compatibility alias while the
  // qualifier UI moves to the correctly named field. It is never stored in the
  // challenge column.
  const mainBookingSource =
    readString(formData, "main_booking_source") ||
    readString(formData, "challenge");
  const budget = readString(formData, "budget");
  const readiness = readString(formData, "readiness");

  if (name.length < 2 || name.length > 120) {
    return { ok: false, message: "Please enter your name." };
  }
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { ok: false, message: "Please enter a valid email address." };
  }
  if (asksBusiness && (companyName.length < 2 || companyName.length > COMPANY_NAME_MAX)) {
    return { ok: false, message: "Please enter your rental company name." };
  }
  if (asksBusiness && (cityState.length < 2 || cityState.length > CITY_STATE_MAX)) {
    return { ok: false, message: "Please enter your city and state." };
  }
  if (phone && !PHONE_PATTERN.test(phone)) {
    return { ok: false, message: "Please enter a valid phone number." };
  }
  if (!inOptions(fleetSize, FLEET_SIZE_OPTIONS)) {
    return { ok: false, message: "Please select your fleet size." };
  }
  if (!inOptions(currentPlatform, PLATFORM_OPTIONS)) {
    return { ok: false, message: "Please select your current platform." };
  }
  if (
    mainBookingSource &&
    !inOptions(mainBookingSource, BOOKING_SOURCE_OPTIONS)
  ) {
    return { ok: false, message: "Please select a valid booking source." };
  }
  if (!inOptions(budget, BUDGET_OPTIONS)) {
    return { ok: false, message: "Please select your launch budget." };
  }
  if (!inOptions(readiness, READINESS_OPTIONS)) {
    return { ok: false, message: "Please select your launch readiness." };
  }
  const validatedBookingSource:
    | (typeof BOOKING_SOURCE_OPTIONS)[number]
    | null = mainBookingSource
    ? (mainBookingSource as (typeof BOOKING_SOURCE_OPTIONS)[number])
    : null;

  return {
    ok: true,
    value: {
      name,
      email,
      companyName: companyName || null,
      cityState: cityState || null,
      phone: phone || null,
      fleetSize,
      currentPlatform,
      mainBookingSource: validatedBookingSource,
      budget,
      readiness,
    },
  };
}
