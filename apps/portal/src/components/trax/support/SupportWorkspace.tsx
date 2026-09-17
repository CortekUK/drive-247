'use client';

import { useState, type ReactNode } from 'react';
import { ArrowLeft, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatApiResponse, TraxCapabilities } from '@/types/trax-support';
import type { TraxSupportView } from './trax-support-context';

/**
 * The TRAX workspace around the conversation: the conversation, or its history.
 *
 * Nothing else. The issue selector and the investigation footer — the issue
 * dropdown, "Investigating this issue", the support level and its checks
 * counter, "This is resolved" and "Request human support" — are gone: support
 * policy state is the server's (issues.ts:issueView no longer sends a score),
 * and the handoff is automatic, so the conversation itself carries the ticket
 * confirmation instead of a control strip. The messages get that space.
 *
 * Human support is deliberately NOT here either. Tickets, ticket conversations
 * and the reply composer live in the portal's own Support section (`/support`),
 * which the header and a confirmed ticket open through `onOpenSupport`.
 */
type Request=(type:string,payload?:Record<string,unknown>)=>Promise<ChatApiResponse|null>;
interface Props {children:ReactNode;request?:Request;capabilities?:TraxCapabilities;recent?:ChatApiResponse['recentConversations'];busy:boolean;
  /** Open the portal's Support section: an existing ticket, or a new request for this issue. */
  onOpenSupport?:(target:{ticketId?:string;issueId?:string})=>void;
  /** Controlled by the panel header. Without it the workspace draws its own row (standalone dialog). */
  view?:TraxSupportView;onView?:(view:TraxSupportView)=>void}
const stamp=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};
export function SupportWorkspace({children,request,capabilities,recent=[],busy,onOpenSupport,view,onView}:Props){
  const [ownView,setOwnView]=useState<TraxSupportView>('conversation');
  const current=view??ownView;
  const show=(next:TraxSupportView)=>{if(onView)onView(next);else setOwnView(next);};
  const [resuming,setResuming]=useState<string|null>(null),[resumeError,setResumeError]=useState<string|null>(null);
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
    </>:children}
  </>;
}
