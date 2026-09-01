/**
 * Field rules for the three auth forms, as pure functions.
 *
 * Pure so the pages stay declarative and the rules can be reasoned about on
 * their own. Every one returns `undefined` for "fine" and a sentence for
 * "not fine" — the same contract `components/booking/validation.ts` uses, so a
 * reader moving between the two forms is not learning a second convention.
 *
 * Messages say what to do, not what went wrong: "Enter your email address", not
 * "Email is invalid".
 */

/**
 * Deliberately permissive — the same pattern the booking form uses.
 *
 * A stricter regex rejects real addresses (apostrophes, plus-addressing, new
 * TLDs) and the only thing that ever proves an address is sending to it.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Matches the `customer-signup` and `reset-password-with-otp` edge functions,
 * which both reject anything shorter. Asking for more here than the server
 * enforces would be theatre; asking for less would let the server reject a
 * password the form said was fine.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** `send-verification-otp` generates a fixed six-digit code. */
export const VERIFICATION_CODE_LENGTH = 6;

export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (email === "") return "Enter your email address.";
  if (!EMAIL_PATTERN.test(email)) {
    return "That does not look like an email address.";
  }
  return undefined;
}

export function validateName(value: string): string | undefined {
  const name = value.trim();
  if (name === "") return "Enter your full name.";
  if (name.length < 2) return "Enter your full name.";
  return undefined;
}

/** Optional at sign-up, so an empty value passes. */
export function validatePhone(value: string): string | undefined {
  const phone = value.trim();
  if (phone === "") return undefined;
  // Digits only, ignoring +, spaces, dashes and brackets: enough to be a phone
  // number under any national plan without encoding one country's format.
  if (phone.replace(/\D/g, "").length < 7) {
    return "Enter a phone number we can reach you on, or leave this blank.";
  }
  return undefined;
}

/** For a NEW password. Sign-in never validates the shape of what was typed. */
export function validateNewPassword(value: string): string | undefined {
  if (value === "") return "Choose a password.";
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return undefined;
}

/**
 * For SIGN-IN. Only checks that something was typed.
 *
 * Applying the length rule here would tell a visitor their password is "too
 * short" when the real answer is that it is wrong — and would lock out anyone
 * whose account predates the eight-character minimum.
 */
export function validateExistingPassword(value: string): string | undefined {
  if (value === "") return "Enter your password.";
  return undefined;
}

export function validatePasswordConfirmation(
  password: string,
  confirmation: string,
): string | undefined {
  if (confirmation === "") return "Type your password again.";
  if (confirmation !== password) return "Those passwords do not match.";
  return undefined;
}

export function validateVerificationCode(value: string): string | undefined {
  const code = value.trim();
  if (code === "") return "Enter the code from your email.";
  if (!new RegExp(`^\\d{${VERIFICATION_CODE_LENGTH}}$`).test(code)) {
    return `The code is ${VERIFICATION_CODE_LENGTH} digits.`;
  }
  return undefined;
}

/**
 * True when no field in the record carries a message.
 *
 * Generic over the caller's own error object rather than typed as
 * `Record<string, string | undefined>` — an interface with optional properties
 * has no index signature, so the plain record type rejects exactly the shape
 * every form here passes in.
 */
export function isClean<T extends object>(errors: T): boolean {
  return Object.values(errors).every((message) => message === undefined);
}
