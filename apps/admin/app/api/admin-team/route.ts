import { createClient } from '@supabase/supabase-js';
import { handleAdminTeam } from '../../../../../supabase/functions/admin-team/handler';

export const dynamic = 'force-dynamic';

/** Local dev only: the same handler the `admin-team` edge function runs. */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') return Response.json({ error: 'Not found' }, { status: 404 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return Response.json({ error: 'Local admin team needs server configuration.' }, { status: 503 });
  return handleAdminTeam(request, createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }));
}
