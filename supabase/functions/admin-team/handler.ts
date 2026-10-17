// =============================================================================
// admin-team — the platform team on Manage Admins: list members (with the
// password a super admin set for each) and add a member in one of four roles.
//
// Roles: super_admin | manager | sales | support. Everyone gets the super admin
// dashboard (is_super_admin = true). Only a super_admin may call this at all —
// that is the one restriction today: no one else can see passwords or add people.
// "super_admin" is carried by app_users.is_primary_super_admin, the flag the page
// and the other admin-create-* functions already check.
//
// Shared by the edge function (index.ts) and the admin app's dev-only route
// (apps/admin/app/api/admin-team/route.ts), so localhost runs the same code.
// =============================================================================

export const TEAM_ROLES = ['super_admin', 'manager', 'sales', 'support'] as const;
export type TeamRole = typeof TEAM_ROLES[number];

/** The service-role Supabase client (only the calls used here). */
// deno-lint-ignore no-explicit-any
export type TeamDb = any;

type TeamBody = { action?: unknown; id?: unknown; name?: unknown; email?: unknown; password?: unknown; role?: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Blocks sign-in (and token refresh) for a deactivated or removed member. */
const BANNED = '876000h';

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error: string, status: number) => json({ error }, status);

export async function handleAdminTeam(req: Request, db: TeamDb): Promise<Response> {
  if (req.method !== 'POST') return fail('Method not allowed', 405);
  try {
    const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return fail('Sign in again.', 401);
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth?.user) return fail('Sign in again.', 401);

    const { data: caller } = await db.from('app_users')
      .select('id, is_active, is_super_admin, is_primary_super_admin')
      .eq('auth_user_id', auth.user.id).maybeSingle();
    if (!caller?.is_active || !caller.is_super_admin || !caller.is_primary_super_admin) {
      return fail('Only a super admin can manage the team.', 403);
    }

    let body: TeamBody;
    try { body = await req.json(); } catch { return fail('Invalid request.', 400); }

    if (body.action === 'list') {
      const { data, error } = await db.rpc('platform_team_list');
      if (error) return fail('The team could not be loaded.', 500);
      return json({ members: Array.isArray(data) ? data : [] });
    }

    if (['update', 'deactivate', 'reactivate', 'delete'].includes(String(body.action))) {
      return await manageMember(db, caller.id, body);
    }

    if (body.action !== 'create') return fail('Unsupported action.', 400);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const role = TEAM_ROLES.find((r) => r === body.role);
    if (!name || name.length > 120) return fail('Enter a name.', 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email.', 400);
    if (password.length < 8 || password.length > 72) return fail('The password needs 8 to 72 characters.', 400);
    if (!role) return fail('Choose a role.', 400);

    // One account per email, case-insensitively (ilike narrows, JS confirms, so an
    // underscore in the address cannot wildcard-match someone else).
    const { data: matches } = await db.from('app_users').select('email').ilike('email', email);
    if ((matches ?? []).some((u: { email: string | null }) => (u.email ?? '').toLowerCase() === email)) {
      return fail('An account already exists for this email.', 409);
    }

    const { data: created, error: createError } = await db.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name, platform_role: role },
    });
    if (createError || !created?.user) return fail(createError?.message ?? 'The login could not be created.', 400);
    const authUserId = created.user.id as string;

    const { data: appUser, error: appUserError } = await db.from('app_users').insert({
      auth_user_id: authUserId, email, name, role: 'head_admin',
      is_super_admin: true, is_primary_super_admin: role === 'super_admin',
      is_bonzah_partner: false, is_sales_agent: false, tenant_id: null, is_active: true,
    }).select('id').single();
    if (appUserError || !appUser) {
      await db.auth.admin.deleteUser(authUserId).catch(() => {});
      return fail('The account could not be created.', 500);
    }

    const { error: memberError } = await db.from('platform_team_members')
      .insert({ app_user_id: appUser.id, platform_role: role, created_by: caller.id });
    const { error: secretError } = memberError ? { error: memberError }
      : await db.rpc('platform_team_set_password', { p_app_user: appUser.id, p_password: password });
    if (memberError || secretError) {
      // Never leave a half-made member: no role or no password means undo it all.
      await db.from('app_users').delete().eq('id', appUser.id);
      await db.auth.admin.deleteUser(authUserId).catch(() => {});
      return fail('The account could not be created.', 500);
    }
    return json({ success: true, id: appUser.id });
  } catch {
    return fail('Something went wrong. Try again.', 500);
  }
}

/**
 * Edit, deactivate, reactivate or delete one team member. Guards: you cannot
 * deactivate, delete or demote yourself, and the team always keeps at least one
 * active super admin — otherwise nobody could add people again.
 */
async function manageMember(db: TeamDb, callerId: string, body: TeamBody): Promise<Response> {
  const id = typeof body.id === 'string' && UUID.test(body.id) ? body.id : null;
  if (!id) return fail('Choose a team member.', 400);
  const { data: member } = await db.from('app_users')
    .select('id, auth_user_id, email, name, is_active, is_super_admin, is_primary_super_admin, tenant_id')
    .eq('id', id).maybeSingle();
  if (!member || !member.is_super_admin || member.tenant_id) return fail('That person is not on the team.', 404);
  const self = member.id === callerId;

  /** Would this change leave no active super admin? */
  const lastSuperAdmin = async () => {
    if (!member.is_primary_super_admin || !member.is_active) return false;
    const { count } = await db.from('app_users').select('id', { count: 'exact', head: true })
      .eq('is_super_admin', true).eq('is_primary_super_admin', true).eq('is_active', true).is('tenant_id', null);
    return (count ?? 0) <= 1;
  };

  if (body.action === 'deactivate' || body.action === 'reactivate') {
    const on = body.action === 'reactivate';
    if (!on && self) return fail('You cannot deactivate your own account.', 400);
    if (!on && await lastSuperAdmin()) return fail('The team needs at least one active super admin.', 400);
    const { error } = await db.from('app_users').update({ is_active: on }).eq('id', id);
    if (error) return fail('The change could not be saved.', 500);
    if (member.auth_user_id) await db.auth.admin.updateUserById(member.auth_user_id, { ban_duration: on ? 'none' : BANNED });
    return json({ success: true });
  }

  if (body.action === 'delete') {
    if (self) return fail('You cannot delete your own account.', 400);
    if (await lastSuperAdmin()) return fail('The team needs at least one active super admin.', 400);
    await db.from('platform_team_members').delete().eq('app_user_id', id);
    const { error } = await db.from('app_users').delete().eq('id', id);
    if (!error) {
      if (member.auth_user_id) {
        const gone = await db.auth.admin.deleteUser(member.auth_user_id);
        if (gone.error) await db.auth.admin.updateUserById(member.auth_user_id, { ban_duration: BANNED });
      }
      return json({ success: true });
    }
    // Their name is on records elsewhere (audit log, rentals they touched…), so the
    // row stays for that history: switched off, signed out for good, off the team,
    // and its email freed so the address can be added again.
    const alias = `removed+${id.slice(0, 8)}@drive-247.invalid`;
    const { error: softError } = await db.from('app_users').update({ is_active: false, email: alias }).eq('id', id);
    if (softError) return fail('That person could not be removed.', 500);
    if (member.auth_user_id) await db.auth.admin.updateUserById(member.auth_user_id, { email: alias, email_confirm: true, ban_duration: BANNED });
    return json({ success: true });
  }

  // update: name, email, role, and optionally a new password.
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = TEAM_ROLES.find((r) => r === body.role);
  if (!name || name.length > 120) return fail('Enter a name.', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email.', 400);
  if (password && (password.length < 8 || password.length > 72)) return fail('The password needs 8 to 72 characters.', 400);
  if (!role) return fail('Choose a role.', 400);
  const demoting = member.is_primary_super_admin && role !== 'super_admin';
  if (demoting && self) return fail('You cannot change your own role.', 400);
  if (demoting && await lastSuperAdmin()) return fail('The team needs at least one active super admin.', 400);

  const emailChanged = email !== (member.email ?? '').toLowerCase();
  if (emailChanged) {
    const { data: matches } = await db.from('app_users').select('id, email').ilike('email', email);
    if ((matches ?? []).some((u: { id: string; email: string | null }) => u.id !== id && (u.email ?? '').toLowerCase() === email)) {
      return fail('An account already exists for this email.', 409);
    }
  }
  if (member.auth_user_id && (emailChanged || password)) {
    const { error } = await db.auth.admin.updateUserById(member.auth_user_id, {
      ...(emailChanged ? { email, email_confirm: true } : {}), ...(password ? { password } : {}),
    });
    if (error) return fail(error.message ?? 'The login could not be updated.', 400);
  }
  const { error: userError } = await db.from('app_users')
    .update({ name, email, is_primary_super_admin: role === 'super_admin' }).eq('id', id);
  if (userError) return fail('The change could not be saved.', 500);
  const { error: roleError } = await db.from('platform_team_members')
    .upsert({ app_user_id: id, platform_role: role, updated_at: new Date().toISOString() }, { onConflict: 'app_user_id' });
  if (roleError) return fail('The role could not be saved.', 500);
  if (password) {
    const { error } = await db.rpc('platform_team_set_password', { p_app_user: id, p_password: password });
    if (error) return fail('The password was changed but could not be stored for display.', 500);
  }
  return json({ success: true });
}
