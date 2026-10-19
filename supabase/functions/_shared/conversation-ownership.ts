/**
 * Tenant ownership checks for staff-initiated sends (send-sms-message,
 * send-email-message).
 *
 * WHY: both functions run with the service-role key, which bypasses RLS, and
 * used to load the customer, the conversation and the unknown-number thread by
 * id ALONE. A staff user of tenant A could pass tenant B's customerId/channelId
 * and text or email B's customer — from A's Twilio number — and write the
 * message into B's conversation. Every lookup here is pinned to the caller's
 * tenant, and a miss is reported as "not found" so ids belonging to another
 * tenant are indistinguishable from ids that do not exist.
 *
 * Kept free of Deno/esm imports so the Node test suite can exercise it with a
 * fake client (tests/integrations/multi-chat/cross-tenant-ownership.test.ts).
 */

// deno-lint-ignore no-explicit-any
type Db = any;

export type Denied = { ok: false; status: number; message: string };

export interface StaffSender {
  id: string;
  tenant_id: string | null;
  role: string;
  is_super_admin: boolean;
}

/**
 * The tenant a staff caller acts for. Only a super admin (tenant_id NULL) may
 * name one in the request body; everyone else is pinned to their own.
 */
export async function resolveStaffSender(
  db: Db,
  authUserId: string,
  bodyTenantId: unknown,
): Promise<{ ok: true; appUser: StaffSender; tenantId: string } | Denied> {
  const { data: appUser, error } = await db
    .from('app_users')
    .select('id, tenant_id, role, is_super_admin, is_active')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, message: 'Could not verify access' };
  // A renter's session has no app_users row: not staff.
  if (!appUser) return { ok: false, status: 403, message: 'Forbidden' };
  if (appUser.is_active === false) return { ok: false, status: 403, message: 'Account is deactivated' };

  const tenantId = appUser.tenant_id
    || (appUser.is_super_admin && typeof bodyTenantId === 'string' && bodyTenantId ? bodyTenantId : null);
  if (!tenantId) return { ok: false, status: 403, message: 'No tenant context' };
  return { ok: true, appUser, tenantId };
}

/**
 * The customer and their conversation, both inside `tenantId`, and the
 * conversation really belonging to that customer.
 */
export async function loadOwnedConversation<C = Record<string, unknown>>(
  db: Db,
  tenantId: string,
  customerId: unknown,
  channelId: unknown,
  customerColumns: string,
): Promise<{ ok: true; customer: C } | Denied> {
  if (typeof customerId !== 'string' || typeof channelId !== 'string' || !customerId || !channelId) {
    return { ok: false, status: 400, message: 'channelId and customerId are required' };
  }
  const { data: customer, error: customerError } = await db
    .from('customers')
    .select(customerColumns)
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (customerError) return { ok: false, status: 500, message: 'Could not load customer' };
  if (!customer) return { ok: false, status: 404, message: 'Customer not found' };

  const { data: channel, error: channelError } = await db
    .from('chat_channels')
    .select('id')
    .eq('id', channelId)
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .maybeSingle();
  if (channelError) return { ok: false, status: 500, message: 'Could not load conversation' };
  if (!channel) return { ok: false, status: 404, message: 'Conversation not found' };

  return { ok: true, customer: customer as C };
}

/** An unknown-number SMS thread inside `tenantId`. */
export async function loadOwnedUnknownThread(
  db: Db,
  tenantId: string,
  threadId: unknown,
): Promise<{ ok: true; thread: { id: string; phone_number: string } } | Denied> {
  if (typeof threadId !== 'string' || !threadId) return { ok: false, status: 400, message: 'threadId is required' };
  const { data: thread, error } = await db
    .from('sms_unknown_threads')
    .select('id, phone_number')
    .eq('id', threadId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, message: 'Could not load thread' };
  if (!thread) return { ok: false, status: 404, message: 'Unknown thread not found' };
  return { ok: true, thread };
}
