import { SupportError, type SupportContext } from './types.ts';

const encoder = new TextEncoder();
const base64 = (data: Uint8Array) => btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export interface Conversation { id: string; expires: number; section?: string; locale?: 'en' | 'ur-Latn' }

/** Stateless, short-lived context. Never read legacy chat_messages or accept history. */
export async function conversationToken(secret: string, ctx: SupportContext, value: Conversation): Promise<string> {
  const payload = base64(encoder.encode(JSON.stringify(value)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`trax.phase1.conversation.v1:${ctx.scope}:${payload}`));
  return `${payload}.${base64(new Uint8Array(signature))}`;
}
export async function verifyConversation(secret: string, ctx: SupportContext, token: unknown, now: number): Promise<Conversation> {
  if (typeof token !== 'string' || token.length > 1200) throw new SupportError('conversation_invalid', 'Start a new conversation.', 409);
  try {
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
