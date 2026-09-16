'use client';

import { useState, type ReactNode } from 'react';
import { ArrowLeft, Clock, Headphones, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SupportInbox, type SupportCompose } from '../../../../../../shared/trax-support/SupportInbox';
import { useSupportMessaging } from '@/hooks/use-support-messaging';
import { Label } from '@/components/ui/label';
import type { ChatApiResponse, TraxCapabilities, TraxIssue, TraxRetentionPolicy } from '@/types/trax-support';

/** The workspace surfaces. Support and history open INSIDE TRAX; nothing routes away. */
export type TraxSupportView='conversation'|'history'|'tickets'|'retention';
type Request=(type:string,payload?:Record<string,unknown>)=>Promise<ChatApiResponse|null>;
interface Props {children:ReactNode;request?:Request;capabilities?:TraxCapabilities;issues?:TraxIssue[];activeIssueId?:string;recent?:ChatApiResponse['recentConversations'];busy:boolean;
  /** Narrow surface (the docked panel): single-column tickets. */compact?:boolean;
  /** Controlled by the panel header. Without it the workspace draws its own row (standalone dialog). */
  view?:TraxSupportView;onView?:(view:TraxSupportView)=>void}
const reasons:Record<string,string>={missing_context:'More context needed',guidance_missing:'Verified guidance is missing',evidence_conflict:'The records conflict',tool_failure:'A required check failed',persistent_tool_failure:'A required service is unavailable',diagnostics_exhausted:'No reliable next check remains',unsupported_finance:'Payment investigation is not enabled',human_requested:'Human support requested',verified_progress:'Verified progress',user_resolved:'You marked this issue resolved'};
const stamp=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};
export function SupportWorkspace({children,request,capabilities,issues=[],activeIssueId,recent=[],busy,compact=false,view,onView}:Props){
  const [ownView,setOwnView]=useState<TraxSupportView>('conversation');
  const current=view??ownView;
  const show=(next:TraxSupportView)=>{if(onView)onView(next);else setOwnView(next);};
  const human=useSupportMessaging();
  const [humanId,setHumanId]=useState<string|undefined>();
  const [compose,setCompose]=useState<SupportCompose|undefined>();
  const [policy,setPolicy]=useState<TraxRetentionPolicy|null>(null),[preview,setPreview]=useState<Record<string,unknown>|null>(null);
  const [holdId,setHoldId]=useState(''),[hold,setHold]=useState(true),[holdResult,setHoldResult]=useState<string|null>(null);
  const [policySaved,setPolicySaved]=useState(false);
  const [resuming,setResuming]=useState<string|null>(null),[resumeError,setResumeError]=useState<string|null>(null);
  const issue=issues.find(i=>i.id===activeIssueId);
  const openHuman=(id?:string,creating=false)=>{
    setHumanId(id);setCompose(creating?{summary:issue?.summary??'',submit:async(body,nonce,subject)=>{
      if(!issue)return null;
      const result=await request?.('submit_ticket',{issueId:issue.id,ticket:{message:body,nonce,subject}});
      return result?.ticket??null;
    }}:undefined);show('tickets');
  };
  const inspectPolicy=async()=>{const result=await request?.('retention_policy');if(result?.retentionPolicy){setPolicy(result.retentionPolicy);show('retention');}};
  // Reopening a stored conversation re-checks access on the server first.
  const resume=async(id:string)=>{
    if(resuming||busy)return;
    setResuming(id);setResumeError(null);
    const result=await request?.('resume',{resumeId:id});
    setResuming(null);
    if(result)show('conversation');else setResumeError('That conversation could not be opened. Check your access and try again.');
  };
  /* Every view but the conversation opens inside TRAX and returns to it here. */
  const header=(title:string,subtitle:string,extra?:ReactNode)=>onView?<div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2.5 sm:px-4">
      <Button size="sm" variant="ghost" aria-label="Back to conversation" className="-ml-2 h-8 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground" onClick={()=>show('conversation')}><ArrowLeft className="h-3.5 w-3.5"/>Conversation</Button>
      <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold tracking-tight">{title}</p><p className="truncate text-[11px] text-muted-foreground">{subtitle}</p></div>
      {extra}
    </div>:null;
  const retentionButton=capabilities?.managePolicy?<Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs text-muted-foreground" disabled={busy} onClick={()=>void inspectPolicy()}>Retention</Button>:null;
  return <>
    {/* The standalone dialog keeps a plain row; the panel drives the view from its header. */}
    {!onView&&<div className="flex flex-wrap items-center gap-1 border-b border-border/50 px-3 py-2 sm:px-5" aria-label="TRAX support navigation">
      <Button size="sm" variant={current==='conversation'?'secondary':'ghost'} onClick={()=>show('conversation')}>Conversation</Button>
      <Button size="sm" variant={current==='tickets'?'secondary':'ghost'} onClick={()=>openHuman()}>My Tickets {human.count?`(${human.count})`:''}</Button>
      <Button size="sm" variant={current==='history'?'secondary':'ghost'} onClick={()=>show('history')}>History</Button>
      {capabilities?.managePolicy&&<Button size="sm" variant={current==='retention'?'secondary':'ghost'} disabled={busy} onClick={()=>void inspectPolicy()}>Retention</Button>}
    </div>}
    {current==='tickets'?<>
      {header('Support tickets','Human support · conversations update automatically',retentionButton)}
      <SupportInbox key={human.scope+String(humanId)+String(!!compose)} call={human.call} scope={human.scope} initialId={humanId} compose={compose} compact={compact} onCancel={()=>show('conversation')}/>
    </>:current==='history'?<>
      {header('Conversation history','Reopening re-checks your access first')}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4" aria-label="Previous TRAX conversations">
        {resumeError&&<p role="alert" className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{resumeError}</p>}
        {!recent.length?<div className="px-1 py-6 text-center">
          <Clock className="mx-auto mb-2 h-5 w-5 text-muted-foreground/60" aria-hidden/>
          <p className="text-[13px] font-medium">No saved conversations yet</p>
          <p className="mx-auto mt-1 max-w-[30ch] text-xs leading-relaxed text-muted-foreground">{capabilities?.supportStorage?'Conversations appear here once you have asked TRAX something.':'Conversations are held for this session only until support storage is configured.'}</p>
        </div>:<ul className="flex flex-col gap-1">
          {recent.map(conversation=><li key={conversation.id}>
            <button type="button" disabled={busy||!!resuming} aria-busy={resuming===conversation.id||undefined}
              onClick={()=>void resume(conversation.id)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{conversation.summary}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{stamp(conversation.lastActivityAt)}</span>
              </span>
              {resuming===conversation.id&&<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden/>}
            </button>
          </li>)}
        </ul>}
      </div>
    </>:current==='retention'&&policy?<>
      {header('Support retention','Conversations and tickets only')}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"><div className="max-w-lg space-y-4">
        <p className="text-sm text-muted-foreground">Only TRAX conversations and support tickets are affected. Open tickets remain stored; ticket handoffs survive ordinary conversation cleanup.</p>
        {([['conversation_days','Conversation days after last activity'],['closed_ticket_days','Ticket days after latest closure'],['inactive_open_days','Flag open tickets after inactive days']] as const).map(([key,label])=><div className="space-y-1.5" key={key}><Label htmlFor={'trax-'+key}>{label}</Label><Input id={'trax-'+key} type="number" min={1} max={3650} value={policy[key]} onChange={e=>{setPolicySaved(false);setPolicy({...policy,[key]:Number(e.target.value)});}}/></div>)}
        <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={async()=>{const {conversation_days,closed_ticket_days,inactive_open_days}=policy;const result=await request?.('retention_policy',{policy:{conversation_days,closed_ticket_days,inactive_open_days}});if(result?.retentionPolicy){setPolicy(result.retentionPolicy);setPolicySaved(true);}}}>Save retention periods</Button><Button variant="outline" disabled={busy} onClick={async()=>{const result=await request?.('retention_preview');if(result?.retentionPreview)setPreview(result.retentionPreview);}}>Preview cleanup</Button></div>
        {policySaved&&<p role="status" className="text-xs text-muted-foreground">Retention periods saved.</p>}
        <p className="text-xs text-muted-foreground">Destructive cleanup {policy.cleanup_enabled?'has been enabled by the deployment administrator':'is disabled pending approval'}. This screen cannot enable it. Reopening a ticket cancels its deletion schedule.</p>
        {preview&&<div role="status" className="rounded-lg border p-3 text-sm">Dry run only: {String(preview.conversationsEligible)} conversations and {String(preview.closedTicketsEligible)} closed tickets eligible. {String(preview.openTicketsForReview)} open tickets need review. Nothing was deleted.</div>}
        <section className="space-y-3 border-t pt-4"><h4 className="text-sm font-semibold">Approved conversation exception</h4><p className="text-xs text-muted-foreground">Use the conversation reference from a support handoff to preserve its original context. The ticket already retains its own redacted handoff independently.</p><Label htmlFor="trax-hold-id">Conversation reference</Label><Input id="trax-hold-id" value={holdId} onChange={e=>{setHoldId(e.target.value);setHoldResult(null);}}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hold} onChange={e=>setHold(e.target.checked)}/>Keep this conversation beyond normal retention</label><Button size="sm" variant="outline" disabled={busy||!holdId.trim()} onClick={async()=>{const result=await request?.('retention_hold',{resumeId:holdId.trim(),retentionHold:hold});if(result)setHoldResult(hold?'Conversation retention exception applied.':'Conversation retention exception removed.');}}>Apply exception</Button>{holdResult&&<p role="status" className="text-xs text-muted-foreground">{holdResult}</p>}</section>
      </div></div>
    </>:<>
      {issues.length>0&&<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2 sm:px-4">
        <label className="sr-only" htmlFor="trax-issue">Current support issue</label>
        <select id="trax-issue" aria-label="Current support issue" className="min-w-0 max-w-full flex-1 rounded-lg border border-input bg-background/70 px-2 py-1.5 text-xs" value={activeIssueId??''} disabled={busy} onChange={e=>void request?.('select_issue',{issueId:e.target.value})}>
          {issues.map(i=><option key={i.id} value={i.id}>{i.summary||i.topic}{i.state==='resolved'?' · Resolved':''}</option>)}
        </select>
      </div>}
      {children}
      {issue&&<div className="shrink-0 border-t border-border/50 bg-secondary/20 px-3 py-3 sm:px-4" data-testid="trax-issue-state">
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
    </>}
  </>;
}
