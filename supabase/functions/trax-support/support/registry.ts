import { KNOWLEDGE } from './knowledge.generated.ts';
import { canView, canEdit, canReadGuidance, routeAllowed } from './auth.ts';
import { isAreaHidden, isSettingsTabHidden } from './portal-lean.generated.js';
import { isV2 } from './portal-v2.generated.js';
import { stageHref } from './rental-navigation.generated.js';
import { object, onlyKeys, SupportError, UUID, type NavigationAction, type PageContext, type SupportContext, type SupportReads } from './types.ts';

export type Guide = typeof KNOWLEDGE.guides[number];
type Navigation = { id:string; label:string; href:string; permission:string; entity?:'rental'|'vehicle'|'customer'; editPermission?:string; v2Stage?:string; hiddenArea?:string; v2Area?:string };
export interface ToolContext { auth:SupportContext; reads:SupportReads }
export function targetAvailable(auth:SupportContext, target:Navigation):boolean {
  if (!canView(auth,target.permission) || (target.editPermission && !canEdit(auth,target.editPermission))) return false;
  if (target.v2Area && !isV2(target.v2Area,auth.tenant.slug)) return false;
  if (target.hiddenArea && isAreaHidden(target.hiddenArea,auth.tenant.slug)) return false;
  const tab = new URL(target.href.replace('{id}','record'), 'https://portal.invalid').searchParams.get('tab');
  if (tab && isSettingsTabHidden(tab,auth.tenant.slug)) return false;
  return routeAllowed(auth,target.href.replace('{id}','record'));
}
export async function validateEntity(env:ToolContext, page:PageContext):Promise<void> {
  if (!['rental','vehicle','customer'].includes(page.kind) || !UUID.test(page.id)) throw new SupportError('invalid_input','Invalid record reference.');
  const permission={rental:'rentals',vehicle:'vehicles',customer:'customers'}[page.kind];
  if (!canView(env.auth,permission)) throw new SupportError('record_unavailable','This record is unavailable.',403);
  const record = await env.reads.entity(page.kind,page.id,env.auth.tenant.id);
  if (!record || record.id !== page.id || record.tenant_id !== env.auth.tenant.id) throw new SupportError('record_unavailable','This record is unavailable.',403);
}
export function guideAvailable(auth:SupportContext,guide:Guide):boolean {
  if (!guide.permissions.every((key)=>canReadGuidance(auth,key))) return false;
  // Guidance-only sections (withheld finance areas) carry their own permission keys and no destinations.
  if (!guide.navigation.length) return guide.permissions.length>0;
  return guide.navigation.some((id)=>{
    const target=KNOWLEDGE.navigation.find((n)=>n.id===id) as Navigation|undefined;
    return target && targetAvailable(auth,target);
  });
}
export function isFinanceQuestion(query: string): boolean {
  // General interface guidance is safe to retrieve; this exemption adds no
  // financial data tool or finance navigation permission. Mixed/live questions
  // still fail closed, including claimed balances and missing money.
  const general=/\b(?:what|which) payment methods\b|\bpayment method (?:options|types)\b|\b(?:how (?:do i |to )?(?:choose|select)|explain) (?:a |the )?payment method\b|\bpayment methods? (?:kaise|kahan|kya)\b/i.test(query);
  const live=/\b(my|our|this|missing|failed|lost|balance|balances|refund|refunds|payout|revenue|invoice|invoices|credit|credits|charge|paid|collected|received|arrived|amount|kitna|mera|meri|mere|nahi)\b|[$£€]\s*\d/i.test(query);
  if(general&&!live)return false;
  // "How do I create an invoice / record a fine / take a payment" asks for interface guidance, not an
  // investigation. It retrieves guidance only and gains no finance tool, record or navigation permission.
  const howTo=/^\s*(?:how (?:do|can|should|would) (?:i|we)|how to|where (?:do|can) (?:i|we)|is there a way to)\b|\b(?:kaise|kis tarah) (?:karun|karein|karte|banaun|banayein|add|record|bhejun)\b/i.test(query);
  const investigation=/\b(missing|failed|failing|lost|balance|balances|refund|refunds|refunded|payout|payouts|revenue|charged|collected|received|arrived|amount|owe|owed|kitna|kitne|kitni|nahi|why)\b|[$£€]\s*\d/i.test(query);
  if(howTo&&!investigation)return false;
  return /\b(stripe|balance|balances|payment|payments|refund|refunds|payout|revenue|invoice|invoices|credit|credits|paise|paisa|raqam)\b/i.test(query);
}
/**
 * A money question that only the PROVIDER can settle: whether money arrived, where
 * it is, what the connected-account balance is. The account's own database cannot
 * answer these however good the query layer is, so they still route to a person
 * when the read-only Stripe capability is not configured — even for a staff member
 * who may otherwise read money.
 *
 * "How much did we collect last month", "export our payments", "who owes the most"
 * are NOT these: they are measurements of the account's own records.
 */
export function needsProviderEvidence(query: string): boolean {
  return /\b(stripe|payout|payouts|balance|balances|arrived|missing|lost|failed|failing|not received|nahi mili|nahi aayi|nahi aaya)\b/i.test(query);
}

function searchApplicationKnowledge(input:unknown,env:ToolContext):Guide[] {
  const args=object(input); onlyKeys(args,['query']);
  if (typeof args.query!=='string' || args.query.length>4000) throw new SupportError('invalid_input','Ask a shorter application question.');
  // Financial permission is unresolved. Never route "available balance" to vehicles.
  if (isFinanceQuestion(args.query)) return [];
  const query=` ${args.query.toLowerCase().replace(/[^a-z0-9 -]/g,' ').replace(/\s+/g,' ').trim()} `;
  return KNOWLEDGE.guides.map((guide)=>({guide,score:guide.keywords.reduce((score,key)=>score+(query.includes(` ${key} `)?key.split(' ').length*3:0),0)}))
    .filter(({guide,score})=>score>0 && guideAvailable(env.auth,guide))
    .sort((a,b)=>b.score-a.score).slice(0,3).map(({guide})=>guide);
}
async function resolveNavigation(input:unknown,env:ToolContext):Promise<{href:string;action:NavigationAction}> {
  const args=object(input); onlyKeys(args,['target','entityId']);
  const target=KNOWLEDGE.navigation.find((n)=>n.id===args.target) as Navigation|undefined;
  if (!target || !targetAvailable(env.auth,target)) throw new SupportError('navigation_unavailable','This destination is not available for your account and permissions.',403);
  if (!target.entity && args.entityId!=null) throw new SupportError('invalid_input','This destination does not accept a record.');
  let href=target.href;
  if (target.entity) {
    if (typeof args.entityId!=='string') throw new SupportError('invalid_input','Select a record first.');
    await validateEntity(env,{kind:target.entity,id:args.entityId});
    href=href.replace('{id}',args.entityId);
    if (target.v2Stage && isV2('rentals',env.auth.tenant.slug)) href=stageHref(args.entityId,target.v2Stage);
  }
  if (!routeAllowed(env.auth,href)) throw new SupportError('navigation_unavailable','This destination is not available.',403);
  return {href,action:{target:target.id,label:target.label,...(target.entity?{entityId:String(args.entityId)}:{})}};
}
/** The entire initial allowlist. No legacy fallback; no model-supplied executor. */
export const READ_ONLY_TOOLS = Object.freeze({search_application_knowledge:searchApplicationKnowledge,resolve_navigation_target:resolveNavigation});
export async function runTool(name:string,input:unknown,env:ToolContext):Promise<Guide[]|{href:string;action:NavigationAction}> {
  if (!Object.prototype.hasOwnProperty.call(READ_ONLY_TOOLS,name)) throw new SupportError('tool_unavailable','That capability is not implemented in application guidance.',403);
  return READ_ONLY_TOOLS[name as keyof typeof READ_ONLY_TOOLS](input,env);
}
export async function guideNavigation(guide:Guide,env:ToolContext,page?:PageContext):Promise<NavigationAction[]> {
  const actions:NavigationAction[]=[];
  for (const id of guide.navigation) {
    const target=KNOWLEDGE.navigation.find((n)=>n.id===id) as Navigation|undefined;
    if (!target || !targetAvailable(env.auth,target)) continue;
    if (target.entity && (!page || target.entity!==page.kind)) continue;
    const resolved=await resolveNavigation({target:id,...(target.entity?{entityId:page!.id}:{})},env);
    actions.push(resolved.action);
    if (actions.length===2) break;
  }
  return actions;
}
