/** In-memory persistence contract for OFFLINE UI/handler tests only.
 * SQL behavior is separately tested by support-storage.mjs. Never used by apps.
 */
export function createMemoryTicketStore(){
  const conversations=new Map(),tickets=new Map();let fail=false,agent=false;
  const copy=value=>structuredClone(value);
  const matches=(row,ctx)=>row&&row.tenant_id===ctx.tenant.id&&row.user_id===ctx.userId&&row.scope===ctx.scope;
  const must=()=>{if(fail)throw Error('Offline storage failure');};
  const store={
    capabilities:async()=>{must();return {supportAgent:agent,managePolicy:agent,deliveryReady:true};},
    load:async(ctx,id)=>{must();const row=conversations.get(id);return matches(row,ctx)?copy(row):null;},
    recent:async(ctx)=>{must();return [...conversations.values()].filter(row=>matches(row,ctx)).map(copy);},
    save:async(ctx,state,revision)=>{must();const old=conversations.get(state.id);if(old&&(!matches(old,ctx)||old.revision!==revision))throw Error('Conflict');const row={id:state.id,tenant_id:ctx.tenant.id,user_id:ctx.userId,scope:ctx.scope,revision:(old?.revision??0)+1,state:copy(state),last_activity_at:new Date().toISOString()};conversations.set(state.id,row);return row.revision;},
    submit:async(ctx,state,issue)=>{must();const existing=[...tickets.values()].find(t=>t.issue_id===issue.id);if(existing){if(!matches(existing,ctx))throw Error('Denied');return copy(existing);}
      if(issue.score!==100)throw Error('Not ready');const id=crypto.randomUUID(),at=new Date().toISOString();const ticket={id,reference:'TRX-FIXTURE-'+(tickets.size+1),tenant_id:ctx.tenant.id,user_id:ctx.userId,scope:ctx.scope,issue_id:issue.id,summary:issue.summary,status:'open',created_at:at,updated_at:at,closed_at:null,retention_hold:false,staff_note:'',handoff:{reportedByUser:copy(issue.excerpts.filter(e=>e.role==='user')),verifiedChecks:copy(issue.checks),recordReferences:copy(issue.records),unknowns:copy(issue.unknowns)}};tickets.set(id,ticket);
      const saved=conversations.get(state.id);if(saved){const savedIssue=saved.state.issues.find(i=>i.id===issue.id);savedIssue.ticketId=id;savedIssue.state='submitted';saved.revision++;}return copy(ticket);},
    tickets:async(ctx,queue,offset)=>{must();if(queue&&!agent)throw Error('Denied');return {tickets:[...tickets.values()].filter(t=>queue||matches(t,ctx)).slice(offset,offset+20).map(copy),nextOffset:null};},
    detail:async(ctx,id,queue)=>{must();const t=tickets.get(id);if(!t||queue&&!agent||!queue&&!matches(t,ctx))throw Error('Denied');return copy(t);},
    update:async(ctx,id,status,note,hold)=>{must();if(!agent)throw Error('Denied');const t=tickets.get(id);if(!t)throw Error('Denied');Object.assign(t,{status,staff_note:note,retention_hold:hold,updated_at:new Date().toISOString(),closed_at:status==='closed'?new Date().toISOString():null});return copy(t);},
    policy:async()=>{must();if(!agent)throw Error('Denied');return {conversation_days:90,closed_ticket_days:365,inactive_open_days:90,cleanup_enabled:false};},
    holdConversation:async()=>{must();if(!agent)throw Error('Denied');},
    dryRun:async()=>{must();if(!agent)throw Error('Denied');return {dryRun:true,conversationsEligible:0,closedTicketsEligible:0,openTicketsForReview:0};},
  };
  return {store,conversations,tickets,setFail:value=>{fail=value;},setAgent:value=>{agent=value;}};
}
