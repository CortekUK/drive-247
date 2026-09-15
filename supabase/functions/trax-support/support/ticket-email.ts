import { redactSupportText } from './issues.ts';
import type { MessagingDatabase } from './messaging.ts';
interface Email {to:string;subject:string;html:string;text:string;fromName:string;idempotencyKey:string}
interface Job {ticket_id:string;lease:string;payload:Record<string,unknown>}
export interface EmailConfig {recipient:string;origin:string}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Alerts carry a short redacted preview, never the diagnostic handoff. */
export function emailPreview(input:unknown,max=240){
  const text=redactSupportText(String(input??''),1000);
  // Financial and identity-document reports remain inside authenticated support.
  if(/\b(passport|licen[cs]e|ssn|identity document|card|iban|payment|refund|balance|stripe|charge|bank|cvv|cvc)\b|[$£€]|\b(?:USD|GBP|EUR|AED)\b/i.test(text))return '[Sensitive details available inside Support]';
  return text.replace(/https?:\/\/\S+/gi,'[link]').replace(/\b[\w-]{18,}\b/g,'[reference]').replace(/[\r\n]+/g,' ').slice(0,max);
}
export function ticketEmail(job:Job,config:EmailConfig):Email {
  const url=new URL(config.origin);
  if((url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))||url.username||url.password||url.search||url.hash)throw Error('Invalid admin origin');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.recipient))throw Error('Invalid recipient');
  const p=job.payload,ref=emailPreview(p.reference,40),tenant=emailPreview(p.tenant,80);
  const href=new URL('/admin/support',url);href.searchParams.set('ticket',job.ticket_id);
  const lines=['A new support ticket has been raised.',`Ticket: ${ref}`,`Tenant: ${tenant}`,`Submitted by: ${emailPreview(p.requester,80)}`,`Subject: ${emailPreview(p.subject)}`,`Created: ${emailPreview(p.createdAt,40)}`,'',`Message: ${emailPreview(p.message)}`,'','Open this ticket in Super Admin → Support to reply inside Drive247.'];
  return {to:config.recipient,subject:`[Drive247 Support] New ticket #${ref} — ${tenant}`,fromName:'Drive247 Support',idempotencyKey:`trax-new-ticket/${job.ticket_id}`,
    text:lines.join('\n')+'\n'+href.href,html:`<div style="font-family:Arial,sans-serif;max-width:600px;line-height:1.6"><h2>New support ticket</h2>${lines.map(line=>`<p>${escape(line)}</p>`).join('')}<a href="${escape(href.href)}">Open Support Ticket</a></div>`};
}
export async function processTicketEmails(db:MessagingDatabase,config:EmailConfig,send:(email:Email)=>Promise<{success:boolean;messageId?:string;simulated?:boolean}>){
  let accepted=0,failed=0;
  for(let i=0;i<5;i++){
    const result=await db.rpc('trax_support_email_claim',{});if(result.error)throw Error('Email queue unavailable');
    const job=result.data as Job|null;if(!job)break;
    let providerId:string|null=null;
    try{
      // Persist the fully rendered envelope before sending; retries keep the same
      // recipient, origin, body and idempotency key even if config changes.
      const prepared=await db.rpc('trax_support_email_prepare',{p_id:job.ticket_id,p_lease:job.lease,p_envelope:ticketEmail(job,config)});
      if(prepared.error)throw Error('Email envelope unavailable');
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{const sent=await Promise.race([send(prepared.data as Email),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),15000);})]);
        if(sent.success&&!sent.simulated&&sent.messageId)providerId=sent.messageId;
      }finally{clearTimeout(timer);}
    }catch{/* Never store provider errors, credentials or raw response bodies. */}
    const finish=await db.rpc('trax_support_email_finish',{p_id:job.ticket_id,p_lease:job.lease,p_provider_id:providerId,p_error:providerId?null:'Provider delivery not confirmed; retry or review required'});
    if(finish.error)throw Error('Email completion could not be recorded');
    if(providerId)accepted++;else failed++;
  }
  return {accepted,failed};
}
