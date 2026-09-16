import { SupportError, type SupportContext } from './types.ts';
import type { DiagnosticInput } from './operational-types.ts';
import type { SupportIssue } from './issues.ts';

const encoder = new TextEncoder();
// Only the unconfigured-storage fallback carries bounded state in its token.
// Configured conversations use a small opaque ID; full issue history stays server-side.
export const MAX_CONVERSATION_TOKEN_LENGTH=132000;
const base64 = (data: Uint8Array) => btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export interface Conversation { id: string; expires: number; section?: string; locale?: 'en' | 'ur-Latn'; turns?:{role:'user'|'assistant';content:string}[]; diagnostic?:DiagnosticInput; paymentCheck?:{rentalId:string;paymentId:string|null}; paymentCandidates?:{paymentId:string;reference:string;stripeReference:string|null;amount:string|null;stripeStatus:string|null;verification:string}[]; issues?:SupportIssue[]; activeIssueId?:string; persisted?:boolean }

/** Stateless, short-lived context. Never read legacy chat_messages or accept history. */
export async function conversationToken(secret: string, ctx: SupportContext, value: Conversation): Promise<string> {
  const key=await conversationKey(secret),iv=crypto.getRandomValues(new Uint8Array(12));
  const payload=encoder.encode(JSON.stringify(value));
  if(payload.length>98000)throw new SupportError('conversation_capacity','This session has reached its context limit. Start a new conversation; persistent support storage is needed for longer histories.',422);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(ctx.scope)},key,payload);
  return `v2.${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}
async function conversationKey(secret:string) {
  const material=await crypto.subtle.digest('SHA-256',encoder.encode(`trax.conversation.encryption.v2:${secret}`));
  return crypto.subtle.importKey('raw',material,'AES-GCM',false,['encrypt','decrypt']);
}
export async function verifyConversation(secret: string, ctx: SupportContext, token: unknown, now: number): Promise<Conversation> {
  if (typeof token !== 'string' || token.length > MAX_CONVERSATION_TOKEN_LENGTH) throw new SupportError('conversation_invalid', 'Start a new conversation.', 409);
  try {
    if(token.startsWith('v2.')) {
      const [version,iv,payload,extra]=token.split('.');if(!version||!iv||!payload||extra)throw Error();
      const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv),additionalData:encoder.encode(ctx.scope)},await conversationKey(secret),decode(payload));
      const value=JSON.parse(new TextDecoder().decode(decoded));
      if(typeof value.id!=='string'||!Number.isFinite(value.expires)||value.expires<=now||value.expires>now+30*60_000)throw Error();
      if(value.turns && (!Array.isArray(value.turns)||value.turns.length>4||value.turns.some((t:{role:string;content:string})=>!['user','assistant'].includes(t.role)||typeof t.content!=='string'||t.content.length>600)))throw Error();
      return value;
    }
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) throw new Error('shape');
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, decode(signature), encoder.encode(`trax.phase1.conversation.v1:${ctx.scope}:${payload}`));
    if (!valid) throw new Error('signature');
    const value = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (typeof value.id !== 'string' || !Number.isFinite(value.expires) || value.expires <= now || value.expires > now + 30 * 60_000) throw new Error('expired');
    return value;
  } catch {
    throw new SupportError('conversation_invalid', 'Your account context changed or this conversation expired. Start a new conversation.', 409);
  }
}
