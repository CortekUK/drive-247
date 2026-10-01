/**
 * trax-notification-editor — Trax, writing one notification's wording.
 *
 * The v2 Settings → Notifications page (northwind canary) has Trax in its right
 * rail, with a tab per message: Email (subject + body HTML) and App message
 * (title + message, used for both phone push and the bell). The operator asks
 * in plain words ("friendlier, and mention the pickup time"); Trax answers and,
 * when asked to change something, returns the whole new wording for that one
 * message. The browser validates it (validateTemplate) before it replaces the
 * draft, and only the page's Save keeps it.
 *
 * Nothing here reads or writes tenant data. The variables it may use arrive in
 * the body from the portal's catalog; the model is told to use only those.
 *
 * Auth mirrors notification-test-v2: a Bearer JWT, an ACTIVE app_users row, and
 * head_admin / admin / super admin, or a manager with editor on
 * settings.reminders (the Notifications page's permission).
 *
 * Body: {
 *   channel: 'email' | 'app',
 *   notification: { name, when, recipient, tooltip },
 *   current: { subject?, body?, title? },   email: subject+body, app: title+body
 *   variables: { key, label, example }[],
 *   messages: { role: 'user'|'assistant', content }[]   last one is the user's
 *   view: { preview, theme }   what the operator is looking at (phones / Gmail)
 * }
 * Reply: { say, change: null | { subject, body } | { title, body }, suggestions: string[] }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const MODEL = Deno.env.get('TRAX_NOTIFICATION_MODEL') || 'gpt-4o';

const FULL_ACCESS_ROLES = new Set(['head_admin', 'admin']);
const MANAGER_TAB_KEY = 'settings.reminders';

const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_BODY_CHARS = 20_000;
const MAX_VARIABLES = 80;

type Channel = 'email' | 'app';
interface Msg { role: 'user' | 'assistant'; content: string }
interface Variable { key: string; label: string; example: string }

const text = (s: unknown, max: number) => (typeof s === 'string' ? s.slice(0, max) : '');

/** What the operator is looking at while they talk to Trax (sent by the page). */
interface View {
  preview: string;
  theme: string;
  /** The rental company's name, as messages and the lock screen show it. */
  company: string;
}

/** Plain facts about how the wording shows right now, so Trax can talk about them. */
function facts(channel: Channel, current: Record<string, unknown>, examples: Record<string, string>): string {
  const fill = (t: string) => t.replace(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g, (_, k) => examples[k] ?? `{{${k}}}`);
  if (channel === 'email') {
    const subject = fill(text(current.subject, 300));
    const plain = fill(text(current.body, MAX_BODY_CHARS)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return `Subject as it prints: "${subject}" (${subject.length} characters; Gmail on a phone shows about 40 before cutting it).
Email text as it prints: about ${plain.split(' ').filter(Boolean).length} words.`;
  }
  const title = fill(text(current.title, 200));
  const body = fill(text(current.body, 600));
  return `Title as it prints: "${title}" (${title.length} characters; an iPhone lock screen shows about 40, Android about 35, before cutting it).
Message as it prints: "${body}" (${body.length} characters; a lock screen shows about 4 lines, roughly 150 characters).`;
}

function system(
  channel: Channel,
  n: { name: string; when: string; recipient: string; tooltip: string },
  catalogue: string,
  view: View,
  facts: string,
) {
  const shape = channel === 'email'
    ? `an EMAIL: a subject line (plain text, at most 150 characters) and a body in simple HTML.
Body HTML you may use: <p> <h2> <h3> <strong> <em> <u> <ul><li> <ol><li> <blockquote> <hr> <a href="…">, and one call-to-action button written as <a data-email-button href="…">Button text</a>. No classes, no styles, no images, no tables.
"The email", "it" or "the message" means the body; "the subject" means the subject line.`
    : `an APP MESSAGE: a title (at most 100 characters) and a message (at most 300 characters), plain text only. The same wording shows as a push notification on phones and in the bell inside the app.
"The message", "the text", "it" or "the body" means the message (body) field; "the title" or "the heading" means the title. The title can never be empty.`;

  return `You are Trax, the assistant inside Drive247, a car rental platform. You are sitting beside a rental company operator who is editing one notification, and you talk with them about it. You speak in the first person, warmly and plainly, like a colleague looking at the same screen. No emojis anywhere, including in the wording you write. No markdown.

THE COMPANY
${view.company || 'The rental company'} (this is the name the lock screen and the emails show).

THE NOTIFICATION
Name: ${n.name}
When it is sent: ${n.when}
Who receives it: ${n.recipient}
What it is for: ${n.tooltip}

You are working on ${shape}

WHAT THE OPERATOR IS LOOKING AT RIGHT NOW
${view.preview || 'the preview'} (${view.theme || 'light'} mode).
${facts}
Refer to this naturally when it helps ("on the iPhone the title gets cut after Jordan…").

VARIABLES
Variables are filled in automatically when the message is sent. Write them exactly as {{key}}. Use ONLY these keys; never invent one. If the operator wants something with no variable, say so plainly and offer fixed text instead. Each line shows the key, what it is, and an example of what it prints:
${catalogue || '(this notification has no variables)'}

DO EXACTLY WHAT THEY ASK (this matters most)
- Follow the request literally. Never keep old wording the request replaces, and never just add to it.
- "Write X", "make it X", "just say X", "change it to X", "replace it with X": the field becomes exactly X, nothing else from before. "Just write hello in it" means the message is "Hello". "Make it one word" means one word.
- "Shorten", "friendlier", "more formal", "fix", "add a line about…": edit the existing wording that way.
- "Remove…", "delete…", "take out…": take it out; do not leave a trace of it.
- Change only the field the request is about; leave the other field EXACTLY as it is. "It" alone always means the message/body field only: "make it one word" changes the message to one word and leaves the title untouched. Touch both fields only when they say so ("both", "everything", "title and message", "the whole notification").
- Keep variables only where the new wording still needs them. If they ask for wording with no variables, use none.
- When the request is unclear, make the most reasonable change and say what you assumed.
- Things that cannot be done: an app message's title can never be empty (it is the first line on the lock screen and in the bell), and an email always needs a subject and some text. If a request would leave one empty, do NOT change anything (change is null). Say kindly why in one sentence, and offer the closest thing you can do, such as a one-word title or the company name, in your suggestions.

HOW YOU TALK (say)
- Questions ("what does {{rental_number}} show?", "which details can this fill in?"): answer in one to three sentences with examples. change is null.
- After a change: say in one or two sentences exactly what you changed, then one short observation about how it now reads in the preview (length, what gets cut, tone), if there is something worth saying.
- Never claim you did something you did not do.

SUGGESTIONS
Always offer 2 or 3 short next steps the operator can tap, written as instructions to you (each under 40 characters), fitted to this notification and to what you just did. For example: "Put the car first", "Add the pickup date", "Make the title shorter".

REPLY FORMAT (strict JSON, nothing else):
${channel === 'email'
    ? '{"say": "…", "change": null | {"subject": "…", "body": "<p>…</p>"}, "suggestions": ["…", "…"]}'
    : '{"say": "…", "change": null | {"title": "…", "body": "…"}, "suggestions": ["…", "…"]}'}
"change" holds the COMPLETE new wording of both fields (repeat the unchanged one as it is).`;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!url || !serviceKey || !anonKey) return jsonResponse({ error: 'Trax is not configured.' }, 503);
  if (!OPENAI_API_KEY) return jsonResponse({ error: 'Trax is not connected to an AI model.' }, 503);

  // ---- Who is asking ------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return jsonResponse({ error: 'Sign in to use Trax.' }, 401);
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: authData } = await caller.auth.getUser();
  if (!authData?.user) return jsonResponse({ error: 'Your session has ended. Sign in again.' }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: appUser } = await admin
    .from('app_users')
    .select('id, role, is_active, is_super_admin')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (!appUser || !appUser.is_active) return jsonResponse({ error: "This account can't use Trax here." }, 403);
  let allowed = appUser.is_super_admin === true || FULL_ACCESS_ROLES.has(appUser.role);
  if (!allowed && appUser.role === 'manager') {
    const { data: perm } = await admin
      .from('manager_permissions')
      .select('access_level')
      .eq('app_user_id', appUser.id)
      .eq('tab_key', MANAGER_TAB_KEY)
      .maybeSingle();
    allowed = perm?.access_level === 'editor';
  }
  if (!allowed) return jsonResponse({ error: "Your role can't edit notifications. Ask an admin." }, 403);

  // ---- The request --------------------------------------------------------
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Send a message for Trax.' }, 400);
  }
  const channel: Channel = body.channel === 'email' ? 'email' : 'app';
  const n = (body.notification ?? {}) as Record<string, unknown>;
  const notification = {
    name: text(n.name, 120),
    when: text(n.when, 300),
    recipient: text(n.recipient, 80),
    tooltip: text(n.tooltip, 400),
  };
  const current = (body.current ?? {}) as Record<string, unknown>;
  const variables: Variable[] = (Array.isArray(body.variables) ? body.variables : [])
    .slice(0, MAX_VARIABLES)
    .map((v) => ({ key: text(v?.key, 60), label: text(v?.label, 120), example: text(v?.example, 120) }))
    .filter((v) => /^[A-Za-z_]\w*$/.test(v.key));
  const messages: Msg[] = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m?.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: text(m?.content, MAX_MESSAGE_CHARS),
    }))
    .filter((m) => m.content.trim() !== '');
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return jsonResponse({ error: 'Ask Trax something about this message.' }, 400);
  }

  const catalogue = variables.map((v) => `{{${v.key}}} — ${v.label}. Example: ${v.example}`).join('\n');
  const rawView = (body.view ?? {}) as Record<string, unknown>;
  const view: View = { preview: text(rawView.preview, 200), theme: text(rawView.theme, 20), company: text(rawView.company, 120) };
  const examples = Object.fromEntries(variables.map((v) => [v.key, v.example]));
  const now = channel === 'email'
    ? `Subject: ${text(current.subject, 300)}\nBody HTML:\n${text(current.body, MAX_BODY_CHARS)}`
    : `Title: ${text(current.title, 200)}\nMessage: ${text(current.body, 600)}`;

  const history = messages.slice(0, -1);
  const last = messages[messages.length - 1];
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system(channel, notification, catalogue, view, facts(channel, current, examples)) },
        ...history,
        { role: 'user', content: `THE WORDING NOW:\n${now}\n\nTHE OPERATOR SAYS:\n${last.content}` },
      ],
    }),
  }).catch(() => null);

  if (!upstream || !upstream.ok) {
    console.warn(JSON.stringify({ event: 'trax_notification_upstream_failed', status: upstream?.status ?? null }));
    return jsonResponse({ error: 'I could not reach my writing model just now. Try again in a moment.' }, 502);
  }

  let reply: { say?: unknown; change?: unknown; suggestions?: unknown } = {};
  try {
    const data = await upstream.json();
    reply = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
  } catch {
    return jsonResponse({ error: 'I lost my train of thought. Ask me again.' }, 502);
  }

  const say = text(reply.say, 1000) || 'Done.';
  const raw = reply.change && typeof reply.change === 'object' ? reply.change as Record<string, unknown> : null;
  const change = !raw
    ? null
    : channel === 'email'
      ? { subject: text(raw.subject, 300), body: text(raw.body, MAX_BODY_CHARS) }
      : { title: text(raw.title, 200), body: text(raw.body, 600) };

  const suggestions = (Array.isArray((reply as { suggestions?: unknown }).suggestions) ? (reply as { suggestions: unknown[] }).suggestions : [])
    .map((x) => text(x, 60).trim())
    .filter(Boolean)
    .slice(0, 3);

  return jsonResponse({ say, change, suggestions });
});
