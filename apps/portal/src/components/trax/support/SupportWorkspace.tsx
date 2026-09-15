'use client';

import { useState, type ReactNode } from 'react';
import { Headphones, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SupportInbox, type SupportCompose } from '../../../../../../shared/trax-support/SupportInbox';
import { useSupportMessaging } from '@/hooks/use-support-messaging';
import { Label } from '@/components/ui/label';
import type { ChatApiResponse, TraxCapabilities, TraxIssue, TraxRetentionPolicy } from '@/types/trax-support';

type Request=(type:string,payload?:Record<string,unknown>)=>Promise<ChatApiResponse|null>;
interface Props {children:ReactNode;request?:Request;capabilities?:TraxCapabilities;issues?:TraxIssue[];activeIssueId?:string;recent?:ChatApiResponse['recentConversations'];busy:boolean}
const reasons:Record<string,string>={missing_context:'More context needed',guidance_missing:'Verified guidance is missing',evidence_conflict:'The records conflict',tool_failure:'A required check failed',persistent_tool_failure:'A required service is unavailable',diagnostics_exhausted:'No reliable next check remains',unsupported_finance:'Payment investigation is not enabled',human_requested:'Human support requested',verified_progress:'Verified progress',user_resolved:'You marked this issue resolved'};
export function SupportWorkspace({children,request,capabilities,issues=[],activeIssueId,recent=[],busy}:Props){
  const [view,setView]=useState<'conversation'|'human'|'retention'>('conversation');
  const human=useSupportMessaging();
  const [humanId,setHumanId]=useState<string|undefined>();
  const [compose,setCompose]=useState<SupportCompose|undefined>();
  const [policy,setPolicy]=useState<TraxRetentionPolicy|null>(null),[preview,setPreview]=useState<Record<string,unknown>|null>(null);
  const [holdId,setHoldId]=useState(''),[hold,setHold]=useState(true),[holdResult,setHoldResult]=useState<string|null>(null);
  const [policySaved,setPolicySaved]=useState(false);
  const issue=issues.find(i=>i.id===activeIssueId);
  const openHuman=(id?:string,creating=false)=>{
    setHumanId(id);setCompose(creating?{summary:issue?.summary??'',submit:async(body,nonce,subject)=>{
      if(!issue)return null;
      const result=await request?.('submit_ticket',{issueId:issue.id,ticket:{message:body,nonce,subject}});
      return result?.ticket??null;
    }}:undefined);setView('human');
  };
  const inspectPolicy=async()=>{const result=await request?.('retention_policy');if(result?.retentionPolicy){setPolicy(result.retentionPolicy);setView('retention');}};
  return <>
    <div className="flex flex-wrap items-center gap-1 border-b border-border/50 px-3 py-2 sm:px-5" aria-label="TRAX support navigation">
      <Button size="sm" variant={view==='conversation'?'secondary':'ghost'} onClick={()=>setView('conversation')}>Conversation</Button>
      <Button size="sm" variant={view==='human'?'secondary':'ghost'} onClick={()=>openHuman()}>My Tickets {human.count?`(${human.count})`:''}</Button>
      {capabilities?.managePolicy&&<Button size="sm" variant={view==='retention'?'secondary':'ghost'} disabled={busy} onClick={()=>void inspectPolicy()}>Retention</Button>}
    </div>
    {view==='human'?<SupportInbox key={human.scope+String(humanId)+String(!!compose)} call={human.call} scope={human.scope} initialId={humanId} compose={compose} onCancel={()=>setView('conversation')}/>:view==='retention'&&policy?<div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"><div className="max-w-lg space-y-4">
        <div><h3 className="text-base font-semibold">Support retention</h3><p className="mt-1 text-sm text-muted-foreground">Only TRAX conversations and support tickets are affected. Open tickets remain stored; ticket handoffs survive ordinary conversation cleanup.</p></div>
        {([['conversation_days','Conversation days after last activity'],['closed_ticket_days','Ticket days after latest closure'],['inactive_open_days','Flag open tickets after inactive days']] as const).map(([key,label])=><div className="space-y-1.5" key={key}><Label htmlFor={'trax-'+key}>{label}</Label><Input id={'trax-'+key} type="number" min={1} max={3650} value={policy[key]} onChange={e=>{setPolicySaved(false);setPolicy({...policy,[key]:Number(e.target.value)});}}/></div>)}
        <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={async()=>{const {conversation_days,closed_ticket_days,inactive_open_days}=policy;const result=await request?.('retention_policy',{policy:{conversation_days,closed_ticket_days,inactive_open_days}});if(result?.retentionPolicy){setPolicy(result.retentionPolicy);setPolicySaved(true);}}}>Save retention periods</Button><Button variant="outline" disabled={busy} onClick={async()=>{const result=await request?.('retention_preview');if(result?.retentionPreview)setPreview(result.retentionPreview);}}>Preview cleanup</Button></div>
        {policySaved&&<p role="status" className="text-xs text-muted-foreground">Retention periods saved.</p>}
        <p className="text-xs text-muted-foreground">Destructive cleanup {policy.cleanup_enabled?'has been enabled by the deployment administrator':'is disabled pending approval'}. This screen cannot enable it. Reopening a ticket cancels its deletion schedule.</p>
        {preview&&<div role="status" className="rounded-lg border p-3 text-sm">Dry run only: {String(preview.conversationsEligible)} conversations and {String(preview.closedTicketsEligible)} closed tickets eligible. {String(preview.openTicketsForReview)} open tickets need review. Nothing was deleted.</div>}
        <section className="space-y-3 border-t pt-4"><h4 className="text-sm font-semibold">Approved conversation exception</h4><p className="text-xs text-muted-foreground">Use the conversation reference from a support handoff to preserve its original context. The ticket already retains its own redacted handoff independently.</p><Label htmlFor="trax-hold-id">Conversation reference</Label><Input id="trax-hold-id" value={holdId} onChange={e=>{setHoldId(e.target.value);setHoldResult(null);}}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hold} onChange={e=>setHold(e.target.checked)}/>Keep this conversation beyond normal retention</label><Button size="sm" variant="outline" disabled={busy||!holdId.trim()} onClick={async()=>{const result=await request?.('retention_hold',{resumeId:holdId.trim(),retentionHold:hold});if(result)setHoldResult(hold?'Conversation retention exception applied.':'Conversation retention exception removed.');}}>Apply exception</Button>{holdResult&&<p role="status" className="text-xs text-muted-foreground">{holdResult}</p>}</section>
      </div></div>:<>
      {issues.length>0&&<div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2 sm:px-5">
        <label className="sr-only" htmlFor="trax-issue">Current support issue</label>
        <select id="trax-issue" aria-label="Current support issue" className="min-w-0 max-w-full flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs" value={activeIssueId??''} disabled={busy} onChange={e=>void request?.('select_issue',{issueId:e.target.value})}>
          {issues.map(i=><option key={i.id} value={i.id}>{i.summary||i.topic}{i.state==='resolved'?' · Resolved':''}</option>)}
        </select>
        <Button size="sm" variant="ghost" disabled={busy} onClick={()=>void request?.('new_issue')}><Plus className="mr-1 h-3.5 w-3.5"/>New issue</Button>
      </div>}
      {children}
      {issue&&<div className="shrink-0 border-t border-border/50 bg-secondary/20 px-3 py-3 sm:px-5" data-testid="trax-issue-state">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium">{issue.state==='resolved'?'Issue resolved':issue.state==='submitted'?'Shared with support':issue.score===100?'Human support recommended':reasons[issue.reason??'']??'Investigating this issue'}</p>
          <span className="text-[11px] text-muted-foreground" title="Application support policy score, not AI confidence">Support level {issue.score}/100 · {issue.checks} checks</span>
        </div>
        {issue.ticketId?<Button size="sm" variant="link" onClick={()=>openHuman(issue.ticketId)}>Open support conversation</Button>:issue.score===100&&issue.state!=='resolved'?<>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Review your message before sharing this issue’s relevant troubleshooting context with support.</p>
          <Button size="sm" className="mt-2" disabled={busy} onClick={()=>openHuman(undefined,true)}><Headphones className="mr-2 h-4 w-4"/>Communicate with Support</Button>
          {!capabilities?.supportSubmission&&<p className="mt-2 text-xs text-muted-foreground">Persistent support submission is not configured in this environment. No ticket has been created.</p>}
        </>:issue.state!=='resolved'&&<div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={()=>void request?.('resolve_issue',{issueId:issue.id})}>This is resolved</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={()=>void request?.('escalate',{issueId:issue.id})}>Request human support</Button>
        </div>}
        {!capabilities?.supportStorage&&<p className="mt-2 text-[11px] text-muted-foreground">This AI conversation is held only for the current session until support storage is configured.</p>}
      </div>}
      {!issues.length&&recent.length>0&&<div className="border-t px-3 py-2 sm:px-5"><label htmlFor="trax-resume" className="mr-2 text-xs text-muted-foreground">Continue a previous issue</label><select id="trax-resume" className="max-w-full rounded border bg-background p-1 text-xs" value="" disabled={busy} onChange={e=>{if(e.target.value)void request?.('resume',{resumeId:e.target.value});}}><option value="">Choose a conversation</option>{recent.map(c=><option key={c.id} value={c.id}>{c.summary}</option>)}</select></div>}
    </>}
  </>;
}
