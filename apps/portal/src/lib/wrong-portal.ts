/**
 * A login used on ANOTHER company's portal address (QA R1.12).
 *
 * One login belongs to one company (`app_users.auth_user_id` is unique), and
 * the portal picks the company from the subdomain. Without this check a
 * password login on someone else's address opened that company's portal and
 * loaded its rentals, customers and money: RLS is still off on several of
 * those tables, so the database does not stop it. Super admins (tenant_id
 * null) may open any portal.
 *
 * Checked by both sign-in screens (login page v1, LoginV2) and again by the
 * dashboard layout for a session that got in anyway. The sign-out is "local"
 * (this browser only), so the person stays signed in to their own portal.
 * The message reaches the sign-in screen through a per-tab flag, because the
 * sign-out re-renders it and the session guard redirects without the URL.
 */
export const WRONG_PORTAL_MESSAGE =
  "This login belongs to a different company's portal. Check the web address and try again.";

const FLAG = "d247.wrongPortal";

export function isWrongPortal(
  appUser: { tenant_id?: string | null; is_super_admin?: boolean | null } | null | undefined,
  tenantId: string | null | undefined,
): boolean {
  return !!(tenantId && appUser?.tenant_id && !appUser.is_super_admin && appUser.tenant_id !== tenantId);
}

export function flagWrongPortal(): void {
  try {
    sessionStorage.setItem(FLAG, "1");
  } catch {
    /* storage blocked */
  }
}

export function peekWrongPortal(): boolean {
  try {
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

/** Read and clear the flag (the sign-in screen shows the message once). */
export function takeWrongPortal(): boolean {
  const flagged = peekWrongPortal();
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    /* storage blocked */
  }
  return flagged;
}
