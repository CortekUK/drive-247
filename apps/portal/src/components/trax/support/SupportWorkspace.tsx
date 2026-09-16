'use client';

import { useState, type ReactNode } from 'react';
import { ArrowLeft, Clock, Headphones, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatApiResponse, TraxCapabilities, TraxIssue } from '@/types/trax-support';
import type { TraxSupportView } from './trax-support-context';

/**
 * The TRAX workspace body around the conversation: the issue state, and the
 * conversation history.
 *
 * Human support is deliberately NOT here. Tickets, ticket conversations and the
 * reply composer live in the portal's own Support section (`/support`), which
 * both this issue bar and the TRAX header open through `onOpenSupport`. TRAX is
 * the AI conversation; people are answered in Support.
 */
type Request=(type:string,payload?:Record<string,unknown>)=>Promise<ChatApiResponse|null>;
interface Props {children:ReactNode;request?:Request;capabilities?:TraxCapabilities;issues?:TraxIssue[];activeIssueId?:string;recent?:ChatApiResponse['recentConversations'];busy:boolean;
  /** Open the portal's Support section: an existing ticket, or a new request for this issue. */
  onOpenSupport?:(target:{ticketId?:string;issueId?:string})=>void;
  /** Controlled by the panel header. Without it the workspace draws its own row (standalone dialog). */
  view?:TraxSupportView;onView?:(view:TraxSupportView)=>void}
const reasons:Record<string,string>={missing_context:'More context needed',guidance_missing:'Verified guidance is missing',evidence_conflict:'The records conflict',tool_failure:'A required check failed',persistent_tool_failure:'A required service is unavailable',diagnostics_exhausted:'No reliable next check remains',unsupported_finance:'Payment investigation is not enabled',human_requested:'Human support requested',verified_progress:'Verified progress',user_resolved:'You marked this issue resolved'};
const stamp=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};
export function SupportWorkspace({children,request,capabilities,issues=[],activeIssueId,recent=[],busy,onOpenSupport,view,onView}:Props){
  const [ownView,setOwnView]=useState<TraxSupportView>('conversation');
  const current=view??ownView;
  const show=(next:TraxSupportView)=>{if(onView)onView(next);else setOwnView(next);};
  const [resuming,setResuming]=useState<string|null>(null),[resumeError,setResumeError]=useState<string|null>(null);
  const issue=issues.find(i=>i.id===activeIssueId);
  // Reopening a stored conversation re-checks access on the server first.
  const resume=async(id:string)=>{
    if(resuming||busy)return;
    setResuming(id);setResumeError(null);
    const result=await request?.('resume',{resumeId:id});
    setResuming(null);
    if(result)show('conversation');else setResumeError('That conversation could not be opened. Check your access and try again.');
  };
  return <>
    {/* The standalone dialog keeps a plain row; the panel drives the view from its header. */}
    {!onView&&<div className="flex flex-wrap items-center gap-1 border-b border-border/50 px-3 py-2 sm:px-5" aria-label="TRAX navigation">
      <Button size="sm" variant={current==='conversation'?'secondary':'ghost'} onClick={()=>show('conversation')}>Conversation</Button>
      <Button size="sm" variant={current==='history'?'secondary':'ghost'} onClick={()=>show('history')}>History</Button>
      {onOpenSupport&&<Button size="sm" variant="ghost" onClick={()=>onOpenSupport({})}>Open Support</Button>}
    </div>}
    {current==='history'?<>
      {onView&&<div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2.5 sm:px-4">
        <Button size="sm" variant="ghost" aria-label="Back to conversation" className="-ml-2 h-8 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground" onClick={()=>show('conversation')}><ArrowLeft className="h-3.5 w-3.5"/>Conversation</Button>
        <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold tracking-tight">Conversation history</p><p className="truncate text-[11px] text-muted-foreground">Reopening re-checks your access first</p></div>
      </div>}
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
        {/* Both of these leave TRAX for the portal's Support section; neither creates a ticket. */}
        {issue.ticketId?<Button size="sm" variant="link" onClick={()=>onOpenSupport?.({ticketId:issue.ticketId})}>Open support conversation</Button>:issue.score===100&&issue.state!=='resolved'?<>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Review your message before sharing this issue’s relevant troubleshooting context with support.</p>
          <Button size="sm" className="mt-2" disabled={busy||!onOpenSupport} onClick={()=>onOpenSupport?.({issueId:issue.id})}><Headphones className="mr-2 h-4 w-4"/>Communicate with Support</Button>
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
