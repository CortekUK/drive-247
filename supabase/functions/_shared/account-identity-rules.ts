// feat-001 spec 07 · Connecting and disconnecting Google — the decisions, with
// no I/O, so they can be tested on their own (_tests/account-identity_test.ts).
// `account-identity-check` reads the state and carries the decision out.

/** app_metadata marker: a password was chosen in the profile (07.2). */
export const PASSWORD_SET = "d247_password_set";

export type IdentityAction = "status" | "check_google" | "unlink_google" | "email_changed" | "password_set";

export interface IdentityState {
  /** The account's own email (auth.users.email). */
  accountEmail: string;
  /** A password the person chose (not the signup stand-in still waiting to be replaced). */
  hasPassword: boolean;
  /** The account's Google identities. Normally zero or one. */
  googles: { id: string; email: string | null }[];
  /** Another account already holds a Google identity with the email asked about (07.5). */
  googleEmailOwnedByOther: boolean;
}

export type IdentityErrorCode =
  | "GOOGLE_EMAIL_MISMATCH"
  | "IDENTITY_IN_USE"
  | "NO_PASSWORD"
  | "NOT_LINKED"
  | "BAD_ACTION";

export type IdentityDecision =
  | { ok: true; removeIdentityIds: string[]; body: Record<string, unknown> }
  | { ok: false; removeIdentityIds: string[]; status: number; code: IdentityErrorCode; error: string };

export const MESSAGES: Record<IdentityErrorCode, string> = {
  GOOGLE_EMAIL_MISMATCH: "This Google account uses a different email from your Drive247 account.",
  IDENTITY_IN_USE: "This Google account is already connected to another Drive247 account.",
  NO_PASSWORD: "Set a password first.",
  NOT_LINKED: "Google is not connected to this account.",
  BAD_ACTION: "Unknown action.",
};

/** Emails compare lowercase and trimmed (07.3). */
export const sameEmail = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

const refuse = (status: number, code: IdentityErrorCode, removeIdentityIds: string[] = []): IdentityDecision => ({
  ok: false,
  status,
  code,
  error: MESSAGES[code],
  removeIdentityIds,
});

export function decide(action: string, s: IdentityState): IdentityDecision {
  const linked = s.googles.length > 0;
  switch (action) {
    case "status":
      return {
        ok: true,
        removeIdentityIds: [],
        body: { password: s.hasPassword, google: linked ? (s.googles[0].email ?? "") : null },
      };

    case "check_google": {
      // 07.5 first: Supabase itself refuses such a link, but if the email is
      // asked about, say plainly whose it is not.
      if (s.googleEmailOwnedByOther) return refuse(409, "IDENTITY_IN_USE");
      // 07.4, on the server: a Google account with another email is removed
      // at once, so it never signs anyone in to this account.
      const wrong = s.googles.filter((g) => !sameEmail(g.email, s.accountEmail)).map((g) => g.id);
      if (wrong.length) return refuse(409, "GOOGLE_EMAIL_MISMATCH", wrong);
      return { ok: true, removeIdentityIds: [], body: { google: linked ? (s.googles[0].email ?? "") : null } };
    }

    case "unlink_google":
      if (!linked) return refuse(409, "NOT_LINKED");
      // 07.6 / 07.8: never leave an account with no way in.
      if (!s.hasPassword) return refuse(409, "NO_PASSWORD");
      return { ok: true, removeIdentityIds: s.googles.map((g) => g.id), body: { google: null } };

    case "email_changed":
      // 07.9: a new email ends the Google link, as Google still carries the old one.
      if (!linked) return { ok: true, removeIdentityIds: [], body: { googleRemoved: false } };
      if (!s.hasPassword) return refuse(409, "NO_PASSWORD");
      return { ok: true, removeIdentityIds: s.googles.map((g) => g.id), body: { googleRemoved: true } };

    default:
      return refuse(400, "BAD_ACTION");
  }
}
