/**
 * trax-agreement-editor — Trax, specialised in writing agreement templates.
 *
 * The Agreements v2 studio (portal `agreement-editor-v2.tsx`, `trax` layout)
 * sends the template as numbered top-level blocks plus the conversation, and
 * this function STREAMS Trax's answer back as plain text in a small tag
 * protocol the browser applies to the document while it is still arriving:
 *
 *   <say>Words for the operator.</say>
 *   <replace id="b4">…html for that block…</replace>
 *   <insert after="b4">…html…</insert>      after="start" puts it at the top
 *   <delete id="b7"/>
 *   through="b9" on replace/delete covers blocks 4…9 in one operation
 *
 * Nothing here writes to the database. The document only changes in the
 * operator's open editor, and only Save template keeps it.
 *
 * Auth is the agreements-v2 function's own (`authenticateAgreementsV2`,
 * write): a signed-in, active staff account whose tenant is on v2 for
 * `agreements`. The tenant comes from that account, never from the body.
 *
 * Body: {
 *   name: string,                               the template's name
 *   blocks: { id: string, html: string }[],     the document, top-level blocks
 *   messages: { role: 'user'|'assistant', content: string }[],
 *   variables: { key, label, description }[],   the portal's TEMPLATE_VARIABLES
 * }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders, handleCors, jsonResponse } from '../_shared/cors.ts';
import { authenticateAgreementsV2, type DbClient } from '../agreements-v2/auth.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const MODEL = Deno.env.get('TRAX_AGREEMENT_MODEL') || 'gpt-4o';

/** Ceilings on what the browser may send, so one request stays one request. */
const MAX_BLOCKS = 600;
const MAX_DOC_CHARS = 180_000;
const MAX_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_VARIABLES = 400;

const SYSTEM = (catalogue: string, name: string) => `You are Trax, the assistant inside Drive247, a car rental platform. Right now you are working in the agreement template editor with a rental company operator. You speak in the first person, warmly and briefly, in plain words. No emojis. No markdown in what you say (no asterisks, no #). Short lists are fine as lines starting with "- ".

The template is called "${name || 'Untitled'}". It is the rental agreement the company's customers sign. The operator's document is given to you as numbered top-level blocks, [b1], [b2], … each with its HTML.

YOU DO THREE THINGS
1. Answer. Questions like "which variable shows the deposit?" or "what does {{rental_period_type}} print?". Explain in one or two sentences, name the variable exactly as {{key}}, and give its example. If they would obviously want it placed, offer to add it.
2. Suggest. "What am I missing?", "review my agreement", "is this clear?". Read the whole document and reply with at most 6 concrete suggestions as "- " lines. Do NOT change the document when suggesting. End by offering to make them ("Want me to add these?").
3. Make. Any request to add, rewrite, remove, reorder, reformat, shorten, translate or fix. Make the change in the document right away with operations, and say what you did in one short sentence.

HOW TO WRITE YOUR REPLY (strict)
Your whole reply is a sequence of these tags and nothing else:
<say>text for the operator</say>
<replace id="bN">new HTML that takes the place of block bN</replace>
<replace id="bN" through="bM">new HTML that takes the place of blocks bN to bM</replace>
<insert after="bN">new HTML placed after block bN</insert>
<insert after="start">new HTML placed at the very top</insert>
<delete id="bN"/>
<delete id="bN" through="bM"/>
Rules for the tags:
- Start with a short <say> (one sentence: what you are about to do, or the answer). When you changed the document, end with a short <say> that confirms it.
- Block ids always refer to the ORIGINAL numbering you were given, even after earlier operations in the same reply.
- Touch as little as possible. Replace a single block rather than rewriting a section. Never rewrite the whole document unless asked.
- When a whole section or the whole document is being rewritten or removed, use ONE operation with through="…" (for a full rewrite: <replace id="b1" through="bLAST">), never a long series of single-block operations.
- A <replace> may contain several blocks (for example a heading and two paragraphs).
- To move a block: <delete> it and <insert> it where it belongs.
- Never put <say> inside an operation, and never put anything outside the tags.

HTML YOU MAY USE
<h1> <h2> <h3> <p> <strong> <em> <u> <ul><li> <ol><li> <hr> and tables: <table><tbody><tr><th>…</th><td>…</td></tr></tbody></table>. Put text directly inside <li>, <th> and <td>. No classes, no styles except style="text-align:center" or "text-align:right" on <p>/<h1>/<h2>/<h3>, no links, no images, no colours. Match the document's existing look: headings for sections, two-column tables of label | value for details, numbered or bulleted lists for terms.

VARIABLES
Variables are filled in automatically when the agreement is sent. Write them exactly as {{key}}. Use ONLY keys from this catalogue; never invent one. If what the operator wants has no variable, say so plainly and suggest writing it as fixed text instead.
${catalogue}
Two conditional blocks are also supported, and only these two: {{#if is_gig_driver}} … {{/if}} and {{#if is_payg}} … {{/if}}. Content between them only appears for gig-driver rentals or pay-as-you-go rentals.

SIGNER FIELDS
{{@sig1}} is where the customer signs, {{@init1}} their initials, {{@date1}} the date they sign. Each may appear at most ONCE in the whole document. Never remove or duplicate one unless the operator explicitly asks. Never place one inside a table or a list; put it in its own <p>.

LEGAL WORDING
Write clear, plain, general clauses a rental company would use (late returns, fuel, tolls, smoking, pets, cleaning, mileage, damage, insurance, termination). You are not a lawyer: when a clause depends on state or country law, write a sensible general version and add one short sentence in your <say> suggesting they have their lawyer check it. Do not repeat that sentence in every reply.

If the request has nothing to do with this agreement, answer in one sentence and bring it back to the agreement.`;

interface Block { id: string; html: string }
interface Msg { role: 'user' | 'assistant'; content: string }
interface Variable { key: string; label?: string; description?: string }

const text = (s: unknown, max: number) => (typeof s === 'string' ? s.slice(0, max) : '');

function parseBody(raw: unknown): { name: string; blocks: Block[]; messages: Msg[]; variables: Variable[] } | string {
  if (!raw || typeof raw !== 'object') return 'Send the document and a message.';
  const body = raw as Record<string, unknown>;
  const blocks = Array.isArray(body.blocks) ? body.blocks.slice(0, MAX_BLOCKS) : [];
  const cleanBlocks: Block[] = blocks
    .map((b) => ({ id: text((b as Block)?.id, 12), html: text((b as Block)?.html, MAX_DOC_CHARS) }))
    .filter((b) => /^b\d+$/.test(b.id));
  if (cleanBlocks.reduce((n, b) => n + b.html.length, 0) > MAX_DOC_CHARS) {
    return 'This agreement is too long for me to work on in one go.';
  }
  const messages: Msg[] = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: (m as Msg)?.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: text((m as Msg)?.content, MAX_MESSAGE_CHARS),
    }))
    .filter((m) => m.content.trim() !== '');
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') return 'Ask me something about the agreement.';
  const variables: Variable[] = (Array.isArray(body.variables) ? body.variables : [])
    .slice(0, MAX_VARIABLES)
    .map((v) => ({
      key: text((v as Variable)?.key, 60),
      label: text((v as Variable)?.label, 80),
      description: text((v as Variable)?.description, 200),
    }))
    .filter((v) => /^[A-Za-z_]\w*$/.test(v.key));
  return { name: text(body.name, 120), blocks: cleanBlocks, messages, variables };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return jsonResponse({ error: 'Trax is not configured.' }, 503);
  if (!OPENAI_API_KEY) return jsonResponse({ error: 'Trax is not connected to an AI model.' }, 503);

  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = await authenticateAgreementsV2(req.headers, client as unknown as DbClient, { write: true });
  if (!auth.ok) return jsonResponse(auth.outcome?.body ?? { error: 'Not allowed.' }, auth.outcome?.status ?? 403);

  let parsed: ReturnType<typeof parseBody>;
  try {
    parsed = parseBody(await req.json());
  } catch {
    parsed = 'Send the document and a message.';
  }
  if (typeof parsed === 'string') return jsonResponse({ error: parsed }, 400);
  const { name, blocks, messages, variables } = parsed;

  const catalogue = variables.map((v) => `{{${v.key}}} — ${v.label || v.key}: ${v.description || ''}`.trim()).join('\n');
  const doc = blocks.length
    ? blocks.map((b) => `[${b.id}] ${b.html}`).join('\n')
    : '(the document is empty; use <insert after="start">)';

  // The document goes with the LAST user message, so earlier turns never
  // carry a stale copy of it.
  const history = messages.slice(0, -1);
  const last = messages[messages.length - 1];
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.any([req.signal, AbortSignal.timeout(120_000)]),
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      temperature: 0.3,
      max_tokens: 6000,
      messages: [
        { role: 'system', content: SYSTEM(catalogue, name) },
        ...history,
        { role: 'user', content: `THE DOCUMENT NOW:\n${doc}\n\nTHE OPERATOR SAYS:\n${last.content}` },
      ],
    }),
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    console.warn(JSON.stringify({ event: 'trax_agreement_upstream_failed', status: upstream?.status ?? null }));
    return jsonResponse({ error: 'I could not reach my writing model just now. Try again in a moment.' }, 502);
  }

  // OpenAI's SSE → the bare text deltas, so the browser reads one plain stream.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let buffer = '';
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        let emitted = false;
        for (const line of lines) {
          const data = line.startsWith('data:') ? line.slice(5).trim() : '';
          if (!data || data === '[DONE]') continue;
          try {
            const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta) {
              controller.enqueue(encoder.encode(delta));
              emitted = true;
            }
          } catch {
            // A keep-alive or malformed line: skip it.
          }
        }
        if (emitted) return;
      }
    },
    cancel() {
      reader.cancel().catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
