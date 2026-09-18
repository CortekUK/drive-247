// V2 TRAX: policy-gated model support and bounded read-only operational tools.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { handleSupportRequest } from './support/handler.ts';
import { createSupportReads, type SupportDatabase } from './support/reads.ts';
import { createOperationalReads, type OperationalDatabase } from './support/operational-reads.ts';
import { configuredModel } from './support/model.ts';
import { createFleetReads, type FleetDatabase } from './support/fleet-tools.ts';
import { createBusinessReads, type BusinessDatabase } from './support/business-query.ts';
import { createIntegrationReads, type IntegrationDatabase } from './support/integration-status.ts';
import { configuredReports, type ReportDatabase } from './support/report-store.ts';
import { createTicketStore, type TicketDatabase } from './support/support-store.ts';
import { configuredEscalationPolicy } from './support/issues.ts';
import { configuredFinance } from './support/finance-tools.ts';
import type { FinanceDatabase } from './support/finance-reads.ts';
import { calendarClock } from './support/calendar-clock.ts';
import { fromZonedTime, formatInTimeZone } from 'npm:date-fns-tz@3.2.0';

// Non-secret TRAX settings default here because the project is at its 100-secret limit.
// A Supabase secret with the same name still overrides any of them.
const TRAX_DEFAULTS:Record<string,string>={TRAX_MODEL:'gpt-4.1',TRAX_MODEL_DATA_POLICY:'minimal-operational-v1',TRAX_SUPPORT_STORAGE:'enabled',TRAX_FINANCE_READS:'enabled'};
const env=(key:string)=>Deno.env.get(key)??TRAX_DEFAULTS[key];

Deno.serve(async (req:Request) => {
  const preflight=handleCors(req);if(preflight)return preflight;
  const started=Date.now();const requestId=crypto.randomUUID();
  const url=Deno.env.get('SUPABASE_URL');const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!secret)return new Response(JSON.stringify({error:'TRAX is not configured.',code:'service_unavailable'}),{status:503,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});
  const requestDeadline=AbortSignal.any([req.signal,AbortSignal.timeout(65_000)]);
  const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([requestDeadline,AbortSignal.timeout(8_000)])})}});
  const reads=createSupportReads(db as unknown as SupportDatabase);
  let modelCalls=0,toolCalls=0;
  const response=await handleSupportRequest(req,{reads,signingSecret:secret,model:configuredModel(env),operational:createOperationalReads(db as unknown as OperationalDatabase),fleet:createFleetReads(db as unknown as FleetDatabase),business:createBusinessReads(db as unknown as BusinessDatabase),reports:configuredReports(db as unknown as ReportDatabase,env),integrations:createIntegrationReads(db as unknown as IntegrationDatabase),finance:configuredFinance(db as unknown as FinanceDatabase,env),store:env('TRAX_SUPPORT_STORAGE')==='enabled'?createTicketStore(db as unknown as TicketDatabase):undefined,escalationPolicy:configuredEscalationPolicy(Deno.env.get('TRAX_ESCALATION_POLICY')),clock:calendarClock(fromZonedTime,formatInTimeZone),audit:event=>{if(event.kind==='model')modelCalls++;else toolCalls++;}});
  for(const[key,value]of Object.entries(corsHeaders))response.headers.set(key,value);
  console.info(JSON.stringify({event:'trax_support',requestId,status:response.status,modelCalls,toolCalls,durationMs:Date.now()-started}));
  return response;
});
