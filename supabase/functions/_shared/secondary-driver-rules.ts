// Pure rules for secondary drivers. No Deno or Supabase imports, so the repo's
// Vitest suite can test the same file the edge functions run.

export const MAX_NAME_LENGTH = 120;
export const MAX_PHONE_LENGTH = 30;
/** Seconds a renter must wait between verification emails for one driver. */
export const RESEND_COOLDOWN_SECONDS = 60;
/** Verification emails one rental may send in 24 hours, across every driver. */
export const MAX_INVITES_PER_RENTAL_PER_DAY = 6;

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nameTokens(value: string | null | undefined): string[] {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "" && !NAME_SUFFIXES.has(token));
}

/**
 * Does the name the renter typed belong to the document that was scanned?
 *
 * The face check only proves the selfie matches the photo on the ID, so without
 * this anyone's valid ID would verify under any name. First and last name must
 * both appear on the document. Middle names may differ, because renters often
 * leave them out. A document with no readable name fails: it proves nothing.
 */
export function driverNameMatchesDocument(
  typedName: string | null | undefined,
  documentFirstName: string | null | undefined,
  documentLastName: string | null | undefined,
): boolean {
  const typed = nameTokens(typedName);
  const onDocument = new Set(nameTokens(`${documentFirstName ?? ""} ${documentLastName ?? ""}`));
  if (typed.length < 2 || onDocument.size === 0) return false;
  return onDocument.has(typed[0]) && onDocument.has(typed[typed.length - 1]);
}

/** OCR gives YYYY-MM-DD or null. An unreadable date is not treated as expired. */
export function isDocumentExpired(expiry: string | null | undefined, today: string): boolean {
  if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return false;
  return expiry < today;
}

export interface SecondaryDriverInput {
  name: string;
  email: string;
  phone: string | null;
}

/** Returns the cleaned driver, or the message to show the renter. */
export function parseSecondaryDriverInput(
  raw: { name?: unknown; email?: unknown; phone?: unknown },
  primaryEmail: string | null | undefined,
): { ok: true; driver: SecondaryDriverInput } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim().replace(/\s+/g, " ") : "";
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const phone = typeof raw.phone === "string" ? raw.phone.trim() : "";

  if (nameTokens(name).length < 2 || name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "Enter the driver's first and last name, as shown on their ID." };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Enter a valid email address. The verification link is sent there." };
  }
  if (primaryEmail && email === primaryEmail.trim().toLowerCase()) {
    return { ok: false, error: "The secondary driver needs their own email address." };
  }
  if (phone.length > MAX_PHONE_LENGTH) {
    return { ok: false, error: "That phone number is too long." };
  }
  return { ok: true, driver: { name, email, phone: phone || null } };
}

/** Renters may only change the driver before the car goes out. */
export function canManageSecondaryDriver(rental: {
  status: string | null;
  cancellation_requested?: boolean | null;
  keysHandedOver: boolean;
}): boolean {
  return (
    (rental.status ?? "").trim().toLowerCase() === "pending" &&
    !rental.cancellation_requested &&
    !rental.keysHandedOver
  );
}
