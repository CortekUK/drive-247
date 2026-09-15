import type { DiagnosticInput, OperationalResult } from './operational-types.ts';
import type { EntityKind } from './types.ts';
import { SupportError } from './types.ts';

export const ISSUE_TOPICS=['vehicle_availability','fleet_counts','bookings','payments','workflow','other'] as const;
export type IssueTopic=typeof ISSUE_TOPICS[number];
export type EventReason='missing_context'|'guidance_missing'|'evidence_conflict'|'tool_failure'|'persistent_tool_failure'|'diagnostics_exhausted'|'unsupported_finance'|'human_requested'|'verified_progress'|'user_resolved';
export interface IssueEvent {key:string;reason:EventReason;at:string;score:number}
export interface IssueCheck {key:string;tool:string;status:string;observedAt:string;findings:string[];limitations:string[]}
export interface SupportIssue {
  id:string;topic:IssueTopic;record?:{kind:EntityKind;id:string};summary:string;
  score:number;state:'investigating'|'needs_support'|'resolved'|'submitted';events:IssueEvent[];
  checks:IssueCheck[];records:{kind:EntityKind;id:string}[];unknowns:string[];
  excerpts:{role:'user'|'assistant';content:string;at:string}[];ticketId?:string;
  diagnostic?:DiagnosticInput;
  paymentCheck?:{rentalId:string;paymentId:string|null};
  /** Structured references from payment tools only (never model text), for the explicit support handoff. */
  paymentReferences?:{paymentId:string;stripeReference:string|null;mode:'live'|'test'|null;account:string|null;verification:string;reason:string;observedAt:string}[];
}
export interface EscalationPolicy {missing_context:number;guidance_missing:number;evidence_conflict:number;tool_failure:number;persistent_tool_failure:number;diagnostics_exhausted:number;unsupported_finance:number;human_requested:number;verified_progress:number;user_resolved:number}
export const DEFAULT_ESCALATION_POLICY:EscalationPolicy={missing_context:25,guidance_missing:50,evidence_conflict:75,tool_failure:50,persistent_tool_failure:100,diagnostics_exhausted:100,unsupported_finance:100,human_requested:100,verified_progress:-25,user_resolved:0};
/** These are support policy thresholds, never model confidence probabilities. */
export function configuredEscalationPolicy(value:string|undefined):EscalationPolicy {
  if(!value)return {...DEFAULT_ESCALATION_POLICY};
  try{const parsed=JSON.parse(value);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();const policy={...DEFAULT_ESCALATION_POLICY};
    for(const [key,score] of Object.entries(parsed)){if(!(key in policy)||!Number.isInteger(score)||Number(score)<(key==='verified_progress'?-100:0)||Number(score)>100||(key==='verified_progress'&&Number(score)>0))throw Error();policy[key as EventReason]=Number(score);}
    // User handoff, no-safe-option and resolution are invariant.
    policy.human_requested=policy.unsupported_finance=policy.diagnostics_exhausted=100;policy.user_resolved=0;return policy;
  }catch{throw new SupportError('policy_unavailable','The support policy is not configured correctly.',503);}
}
export function redactSupportText(text:string,limit=600):string {
  return text.replace(/(?:sk|rk|pk)[_-](?:proj-|live_|test_)?[A-Za-z0-9_-]{10,}/g,'[credential removed]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[token removed]')
    .replace(/\b(?:Bearer\s+\S+|(?:password|secret|api[_ -]?key|passport|licen[cs]e|card number|cvv|iban)\s*[:=]\s*\S+)/gi,'[sensitive value removed]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email removed]')
    .replace(/\b(?:pi|pm|cus|ch|re|acct)_[A-Za-z0-9]+\b/g,'[payment reference removed]')
    .replace(/(?:\+?\d[\d ()-]{8,}\d)/g,value=>/^\d{4}-\d{2}-\d{2}(?:\s+-\s+\d{4}-\d{2}-\d{2})?$/.test(value)?value:'[number removed]')
    .replace(/data:[^\s]+|[A-Za-z0-9+/=_-]{100,}/g,'[attachment removed]')
    .replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,limit);
}
export function newIssue(topic:IssueTopic,summary:string,record?:SupportIssue['record']):SupportIssue {
  return {id:crypto.randomUUID(),topic,record,summary:redactSupportText(summary,240),score:0,state:'investigating',events:[],checks:[],records:record?[record]:[],unknowns:[],excerpts:[]};
}
export function recordIssueEvent(issue:SupportIssue,reason:EventReason,key:string,now:number,policy=DEFAULT_ESCALATION_POLICY):void {
  if(issue.state==='resolved'||issue.events.some(e=>e.key===key&&e.reason===reason))return;
  const value=policy[reason];
  const score=reason==='user_resolved'?0:value<0?Math.max(0,issue.score+value):Math.max(issue.score,value);
  issue.score=score;
  // Submission is independent of resolution; an AI answer never closes a ticket.
  if(reason==='user_resolved')issue.state='resolved';
  else if(issue.state!=='submitted')issue.state=score===100?'needs_support':'investigating';
  issue.events=[...issue.events,{key,reason,at:new Date(now).toISOString(),score}].slice(-32);
}
export function recordIssueCheck(issue:SupportIssue,tool:string,key:string,result:OperationalResult,now:number,policy=DEFAULT_ESCALATION_POLICY):void {
  const previous=issue.checks.find(c=>c.key===key);
  if(result.diagnostic)issue.diagnostic=result.diagnostic;
  const findings=result.findings.map(f=>redactSupportText(f.summary,350)).slice(0,8);
  const changed=!previous||previous.status!==result.status||JSON.stringify(previous.findings)!==JSON.stringify(findings);
  const check:IssueCheck={key,tool,status:result.status,observedAt:result.observedAt,findings,limitations:result.limitations.map(x=>redactSupportText(x,240)).slice(0,8)};
  issue.checks=[...issue.checks.filter(c=>c.key!==key),check].slice(-24);
  issue.unknowns=[...new Set(issue.checks.flatMap(c=>c.limitations))].slice(0,12);
  for(const source of result.sources){if(source.recordId&&['vehicles','rentals'].includes(source.table)){const kind=source.table==='vehicles'?'vehicle':'rental';if(!issue.records.some(r=>r.kind===kind&&r.id===source.recordId)&&issue.records.length<12)issue.records.push({kind,id:source.recordId});}}
  if(result.status==='needs_input')recordIssueEvent(issue,'missing_context',key,now,policy);
  else if(result.status==='error')recordIssueEvent(issue,'tool_failure',key,now,policy);
  else if(result.findings.some(f=>f.code==='return_conflict'||f.code==='payment_conflict'))recordIssueEvent(issue,'evidence_conflict',key,now,policy);
  else if(changed&&result.status==='verified')recordIssueEvent(issue,'verified_progress',key+':'+JSON.stringify(findings).slice(0,160),now,policy);
}
export function issueView(issue:SupportIssue) {return {id:issue.id,topic:issue.topic,summary:issue.summary,score:issue.score,state:issue.state,reason:issue.events.at(-1)?.reason??null,ticketId:issue.ticketId,checks:issue.checks.length};}
