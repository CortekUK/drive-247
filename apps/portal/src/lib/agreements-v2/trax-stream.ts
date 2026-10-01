/**
 * Agreements v2 — Trax in the template studio: the call and the stream parser.
 *
 * `trax-agreement-editor` (edge function) streams Trax's reply as plain text
 * in a small tag protocol, and the studio applies it to the open document
 * WHILE it arrives, so the operator watches Trax write:
 *
 *   <say>Words for the operator.</say>
 *   <replace id="b4">…html…</replace>       through="b9": blocks 4 to 9 as one
 *   <insert after="b4">…html…</insert>       after="start" = the very top
 *   <delete id="b7"/>
 *
 * `createTraxStreamParser` is pure and incremental: feed it chunks as they
 * come, cut anywhere (mid-tag, mid-word), and it calls back with the pieces.
 */

import { supabase } from "@/integrations/supabase/client";
import { TEMPLATE_VARIABLES } from "@/lib/template-variables";

export const TRAX_AGREEMENT_FUNCTION = "trax-agreement-editor";

export type TraxOpStart =
  | { kind: "replace"; id: string; through?: string }
  | { kind: "insert"; after: string }
  | { kind: "delete"; id: string; through?: string };

export interface TraxStreamHandlers {
  onSayStart?: () => void;
  onSayText?: (text: string) => void;
  onSayEnd?: () => void;
  onOpStart?: (op: TraxOpStart) => void;
  /** Html for the open replace/insert, in arrival order. */
  onOpText?: (html: string) => void;
  onOpEnd?: () => void;
}

type Mode = "between" | "say" | "replace" | "insert";

const CLOSE: Record<Exclude<Mode, "between">, string> = {
  say: "</say>",
  replace: "</replace>",
  insert: "</insert>",
};

/** How many trailing chars might be the start of `close`, so they are held back. */
function heldBack(buf: string, close: string): number {
  for (let n = Math.min(close.length - 1, buf.length); n > 0; n--) {
    if (close.startsWith(buf.slice(buf.length - n))) return n;
  }
  return 0;
}

export function createTraxStreamParser(h: TraxStreamHandlers) {
  let buf = "";
  let mode: Mode = "between";

  const step = (final: boolean): boolean => {
    if (mode === "between") {
      const lt = buf.indexOf("<");
      if (lt === -1) {
        // Stray text outside any tag is still Trax talking: show it.
        if (buf.trim() && final) {
          h.onSayStart?.();
          h.onSayText?.(buf.trim());
          h.onSayEnd?.();
        }
        if (final || !buf.trim()) buf = "";
        return false;
      }
      if (lt > 0) {
        const stray = buf.slice(0, lt).trim();
        if (stray) {
          h.onSayStart?.();
          h.onSayText?.(stray);
          h.onSayEnd?.();
        }
        buf = buf.slice(lt);
      }
      const gt = buf.indexOf(">");
      if (gt === -1) return false;
      const tag = buf.slice(0, gt + 1);
      buf = buf.slice(gt + 1);
      let m: RegExpMatchArray | null;
      if (/^<say\s*>$/i.test(tag)) {
        mode = "say";
        h.onSayStart?.();
      } else if ((m = tag.match(/^<replace\s+id="(b\d+)"(?:\s+through="(b\d+)")?\s*>$/i))) {
        mode = "replace";
        h.onOpStart?.({ kind: "replace", id: m[1], through: m[2] });
      } else if ((m = tag.match(/^<insert\s+after="(start|b\d+)"\s*>$/i))) {
        mode = "insert";
        h.onOpStart?.({ kind: "insert", after: m[1] });
      } else if ((m = tag.match(/^<delete\s+id="(b\d+)"(?:\s+through="(b\d+)")?\s*\/?>$/i))) {
        h.onOpStart?.({ kind: "delete", id: m[1], through: m[2] });
        h.onOpEnd?.();
        buf = buf.replace(/^\s*<\/delete>/i, "");
      }
      // Anything else (a stray closing tag) is dropped.
      return true;
    }

    const close = CLOSE[mode];
    const at = buf.toLowerCase().indexOf(close);
    if (at !== -1) {
      const piece = buf.slice(0, at);
      if (piece) (mode === "say" ? h.onSayText : h.onOpText)?.(piece);
      buf = buf.slice(at + close.length);
      if (mode === "say") h.onSayEnd?.();
      else h.onOpEnd?.();
      mode = "between";
      return true;
    }
    const keep = final ? 0 : heldBack(buf, close);
    const piece = buf.slice(0, buf.length - keep);
    if (piece) (mode === "say" ? h.onSayText : h.onOpText)?.(piece);
    buf = buf.slice(buf.length - keep);
    if (final) {
      if (mode === "say") h.onSayEnd?.();
      else h.onOpEnd?.();
      mode = "between";
    }
    return false;
  };

  return {
    push(chunk: string) {
      buf += chunk;
      while (step(false)) {
        /* keep going while a tag was consumed */
      }
    },
    /** The stream ended: flush whatever is open. */
    end() {
      while (step(true)) {
        /* drain */
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The call                                                                    */
/* -------------------------------------------------------------------------- */

export interface TraxTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TraxDocBlock {
  id: string;
  html: string;
}

/** The catalogue Trax may use, from the one list the editor and preview use. */
export const TRAX_VARIABLE_CATALOGUE = TEMPLATE_VARIABLES.map((v) => ({
  key: v.key,
  label: v.label,
  description: v.description,
}));

export const TRAX_UNAVAILABLE =
  "Trax can't write in this editor yet: its writing service hasn't been switched on.";

/**
 * Ask Trax. Resolves when the stream ends; rejects with an operator-readable
 * sentence on any failure before or during the stream. An abort rejects with
 * an `AbortError`.
 */
export async function streamTraxAgreementEdit(
  body: { name: string; blocks: TraxDocBlock[]; messages: TraxTurn[] },
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Sign in again.");

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hviqoaokxvlancmftwuo.supabase.co";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  let response: Response;
  try {
    response = await fetch(`${base}/functions/v1/${TRAX_AGREEMENT_FUNCTION}`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(anon ? { apikey: anon } : {}),
      },
      body: JSON.stringify({ ...body, variables: TRAX_VARIABLE_CATALOGUE }),
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new Error(TRAX_UNAVAILABLE);
  }

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    if (response.status === 404 && !payload?.error) throw new Error(TRAX_UNAVAILABLE);
    throw new Error(payload?.error || "I couldn't answer just now. Try again in a moment.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) onChunk(text);
  }
  const tail = decoder.decode();
  if (tail) onChunk(tail);
}
