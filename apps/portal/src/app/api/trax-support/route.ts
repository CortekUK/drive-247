import { createClient } from '@supabase/supabase-js';
import { handleSupportRequest } from '../../../../../../supabase/functions/trax-support/support/handler';
import { createSupportReads, type SupportDatabase } from '../../../../../../supabase/functions/trax-support/support/reads';
import { createOperationalReads, type OperationalDatabase } from '../../../../../../supabase/functions/trax-support/support/operational-reads';
import { configuredModel } from '../../../../../../supabase/functions/trax-support/support/model';
import { createFleetReads, type FleetDatabase } from '../../../../../../supabase/functions/trax-support/support/fleet-tools';
import { createBusinessReads, type BusinessDatabase } from '../../../../../../supabase/functions/trax-support/support/business-query';
import { configuredReports, type ReportDatabase } from '../../../../../../supabase/functions/trax-support/support/report-store';
import { createTicketStore, type TicketDatabase } from '../../../../../../supabase/functions/trax-support/support/support-store';
import { configuredEscalationPolicy } from '../../../../../../supabase/functions/trax-support/support/issues';
import { configuredFinance } from '../../../../../../supabase/functions/trax-support/support/finance-tools';
import type { FinanceDatabase } from '../../../../../../supabase/functions/trax-support/support/finance-reads';
import { calendarClock } from '../../../../../../supabase/functions/trax-support/support/calendar-clock';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Local V2 entry point. Authorization and guidance use the same code as the
 * edge function; development never supplies a fake user or bypasses permissions.
 * Production continues to use the reviewed, separately deployed edge endpoint.
 */
export async function POST(request: Request): Promise<Response> {
  const fail = (code: string, error: string, status: number) => Response.json({ code, error }, {
    status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization' },
  });
  if (process.env.NODE_ENV !== 'development') return fail('not_found', 'Not found.', 404);
  if (!/^Bearer \S+$/.test(request.headers.get('Authorization') ?? '')) {
    return fail('unauthorized', 'Sign in to use TRAX.', 401);
  }
  // Use the same project as browser sign-in. No unrelated URL or anon-key fallback.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    return fail('local_configuration_required', 'Local TRAX needs server configuration. Follow docs/trax/local-testing.md, then restart the portal.', 503);
  }
  try {
    const requestDeadline=AbortSignal.any([request.signal,AbortSignal.timeout(65_000)]);
    const db = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([requestDeadline,AbortSignal.timeout(8_000)]) }) },
    });
    // Narrow the SDK at the adapter boundary; recursively comparing its generic
    // query builders exceeds TypeScript's depth limit. No client reaches a tool.
    const requestId=crypto.randomUUID(),started=Date.now();let modelCalls=0,toolCalls=0;
    // Resolved here rather than inline so the log below can say whether a model was
    // available at all. "Prepared guidance fallback" looks identical whether the
    // model is unconfigured, refused by the gate, or failed mid-call, and guessing
    // between those cost an evening.
    const model=configuredModel(key=>process.env[key]);
    const response = await handleSupportRequest(request, { reads: createSupportReads(db as unknown as SupportDatabase), signingSecret: secret,
      model,operational:createOperationalReads(db as unknown as OperationalDatabase),clock:calendarClock(fromZonedTime,formatInTimeZone),
      fleet:createFleetReads(db as unknown as FleetDatabase),
      business:createBusinessReads(db as unknown as BusinessDatabase),
      reports:configuredReports(db as unknown as ReportDatabase,key=>process.env[key]),
      finance:configuredFinance(db as unknown as FinanceDatabase,key=>process.env[key]),
      store:process.env.TRAX_SUPPORT_STORAGE==='enabled'?createTicketStore(db as unknown as TicketDatabase):undefined,
      escalationPolicy:configuredEscalationPolicy(process.env.TRAX_ESCALATION_POLICY),
      audit:event=>{if(event.kind==='model')modelCalls++;else toolCalls++;},
    });
    // Dev execution evidence contains counters only, never account or record data.
    console.info(JSON.stringify({event:'trax_support',requestId,status:response.status,modelConfigured:!!model,modelName:model?.name??null,modelCalls,toolCalls,durationMs:Date.now()-started}));
    response.headers.set('X-TRAX-Request-ID',requestId);
    response.headers.set('X-TRAX-Runtime', 'local-development');
    return response;
  } catch {
    return fail('service_unavailable', 'Local TRAX could not verify access. Check the server configuration and connection.', 503);
  }
}
