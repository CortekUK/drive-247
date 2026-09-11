/**
 * diag-resend-delivery
 * ---------------------------------------------------------------------------
 * READ-ONLY diagnostic. Answers the one question our own tables cannot:
 * after Resend accepted a message, what actually happened to it?
 *
 * We store `email_delivery_status='sent'`, which only ever meant "Resend's API
 * returned 2xx". No Resend delivery/bounce webhook is consumed anywhere, so a
 * bounce, block or spam-complaint after acceptance is invisible to us and to
 * the operator. Meanwhile RESEND_API_KEY is a Supabase secret — the CLI returns
 * only a SHA-256 digest — so it cannot be read out and used from a laptop.
 *
 * This function closes that gap without moving the secret: it runs inside the
 * same environment that already holds the key, calls Resend's GET /emails/{id},
 * and returns ONLY the delivery outcome. The key is never logged and never
 * included in a response.
 *
 * Strictly GET against Resend. It sends no mail and writes nothing.
 */
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  if (!RESEND_API_KEY) return errorResponse('RESEND_API_KEY is not configured', 500);

  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body?.ids) ? body.ids : [];
  } catch {
    return errorResponse('Body must be JSON: { "ids": ["<resend message id>", ...] }', 400);
  }
  if (!ids.length) return errorResponse('No ids supplied', 400);
  if (ids.length > 60) return errorResponse('Max 60 ids per call', 400);

  const results: unknown[] = [];
  for (const id of ids) {
    try {
      const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      });
      const raw = await r.text();
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(raw); } catch { /* non-JSON body */ }

      if (!r.ok) {
        results.push({ id, http: r.status, error: (data as any)?.message ?? raw.slice(0, 160) });
        continue;
      }
      results.push({
        id,
        http: r.status,
        // last_event is Resend's own verdict: delivered | bounced | complained |
        // delivery_delayed | sent | opened | clicked
        last_event: (data as any)?.last_event ?? null,
        to: (data as any)?.to ?? null,
        subject: (data as any)?.subject ?? null,
        created_at: (data as any)?.created_at ?? null,
      });
    } catch (e) {
      results.push({ id, error: String((e as Error)?.message ?? e).slice(0, 160) });
    }
  }

  const tally: Record<string, number> = {};
  for (const r of results as any[]) {
    const k = r.last_event ?? (r.error ? 'lookup_failed' : 'unknown');
    tally[k] = (tally[k] ?? 0) + 1;
  }

  return jsonResponse({ ok: true, checked: results.length, tally, results });
});
