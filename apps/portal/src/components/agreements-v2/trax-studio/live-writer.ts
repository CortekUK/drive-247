/**
 * Agreements v2 — Trax's live writer: types a streamed edit into the open
 * Tiptap document, a few characters a frame, so the operator watches it
 * being written.
 *
 * The stream (lib/agreements-v2/trax-stream.ts) names blocks by their number
 * when the request was made (`b1`, `b2`, …). Those positions are captured
 * once, then carried through every transaction with a cumulative Mapping, so
 * `after="b4"` still means "after what was block 4" once blocks 1–3 have been
 * rewritten.
 *
 * HISTORY. Every frame is its own transaction, kept out of the undo history
 * (`addToHistory: false`). When the run ends, the document is put back to how
 * it started and the result applied in ONE transaction, so Ctrl+Z undoes the
 * whole Trax change in one step, and `before` is kept for the chat's Undo.
 *
 * The document is read-only while Trax writes, so no keystroke can land in a
 * range that is being rewritten.
 */

import type { Editor } from "@tiptap/react";
import { DOMParser as PMDOMParser, DOMSerializer, Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { TraxDocBlock, TraxOpStart } from "@/lib/agreements-v2/trax-stream";

/* -------------------------------------------------------------------------- */
/* The "Trax is writing here" highlight and caret                              */
/* -------------------------------------------------------------------------- */

type WritingRange = { from: number; to: number } | null;

export const traxWritingKey = new PluginKey<WritingRange>("traxWriting");

export function createTraxWritingPlugin(): Plugin<WritingRange> {
  return new Plugin<WritingRange>({
    key: traxWritingKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const meta = tr.getMeta(traxWritingKey) as WritingRange | undefined;
        if (meta !== undefined) return meta;
        if (!value || !tr.docChanged) return value;
        return { from: tr.mapping.map(value.from, -1), to: tr.mapping.map(value.to, 1) };
      },
    },
    props: {
      decorations(state) {
        const range = traxWritingKey.getState(state);
        if (!range) return null;
        const size = state.doc.content.size;
        const from = Math.max(0, Math.min(range.from, size));
        const to = Math.max(from, Math.min(range.to, size));
        const decos: Decoration[] = [];
        if (to > from) decos.push(Decoration.inline(from, to, { class: "trax-writing" }));
        decos.push(
          Decoration.widget(
            to,
            () => {
              const caret = document.createElement("span");
              caret.className = "trax-caret";
              caret.setAttribute("aria-hidden", "true");
              return caret;
            },
            { side: 1, key: "trax-caret" },
          ),
        );
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Reading the document as blocks                                              */
/* -------------------------------------------------------------------------- */

export interface CapturedBlock extends TraxDocBlock {
  from: number;
  to: number;
  /** Plain text, for the chat's "Rewriting · …" labels. */
  text: string;
}

export function captureBlocks(editor: Editor): CapturedBlock[] {
  const serializer = DOMSerializer.fromSchema(editor.schema);
  const blocks: CapturedBlock[] = [];
  editor.state.doc.forEach((node, offset, index) => {
    const holder = document.createElement("div");
    holder.appendChild(serializer.serializeNode(node));
    blocks.push({
      id: `b${index + 1}`,
      html: holder.innerHTML,
      from: offset,
      to: offset + node.nodeSize,
      text: node.textContent.trim(),
    });
  });
  // An editor holding only its empty starting paragraph has nothing to name.
  if (blocks.length === 1 && !blocks[0].text && !/table|hr|img/.test(blocks[0].html)) return [];
  return blocks;
}

/** The text a label is taken from: the first heading, else the first words. */
function labelFromHtml(html: string): string {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const heading = holder.querySelector("h1, h2, h3, th");
  const text = (heading?.textContent || holder.textContent || "").replace(/\s+/g, " ").trim();
  return text;
}

export const shortLabel = (text: string, max = 42) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/* -------------------------------------------------------------------------- */
/* The writer                                                                  */
/* -------------------------------------------------------------------------- */

export interface TraxActivity {
  id: number;
  kind: "replace" | "insert" | "delete";
  label: string;
  state: "writing" | "done";
}

type QueueItem =
  | { type: "start"; op: TraxOpStart }
  | { type: "text"; html: string }
  | { type: "end" }
  /** Anything that must wait its turn behind the typing (Trax's closing words). */
  | { type: "call"; fn: () => void };

export class TraxLiveWriter {
  readonly before: PMNode;
  private readonly editor: Editor;
  private readonly blocks: Map<string, CapturedBlock>;
  private readonly mapping = new Mapping();
  private readonly parser: PMDOMParser;
  private readonly onActivity: (a: TraxActivity) => void;
  private readonly scrollHost: () => HTMLElement | null;

  private queue: QueueItem[] = [];
  private cur: { from: number; to: number; activity: TraxActivity | null } | null = null;
  private target = "";
  private shown = 0;
  private frame: number | null = null;
  private streamEnded = false;
  private resolveDone: (() => void) | null = null;
  private activityId = 0;
  private lastScroll = 0;
  private changed = false;
  private readonly offTransaction: () => void;

  constructor(opts: {
    editor: Editor;
    blocks: CapturedBlock[];
    onActivity: (a: TraxActivity) => void;
    scrollHost: () => HTMLElement | null;
  }) {
    this.editor = opts.editor;
    this.before = opts.editor.state.doc;
    this.blocks = new Map(opts.blocks.map((b) => [b.id, b]));
    this.parser = PMDOMParser.fromSchema(opts.editor.schema);
    this.onActivity = opts.onActivity;
    this.scrollHost = opts.scrollHost;

    // Every change to the document, ours and any a plugin appends, moves the
    // original block positions; carry them all.
    const onTx = ({ transaction, appendedTransactions }: { transaction: Transaction; appendedTransactions?: Transaction[] }) => {
      this.mapping.appendMapping(transaction.mapping);
      for (const t of appendedTransactions ?? []) {
        this.mapping.appendMapping(t.mapping);
        // A plugin fixing up what was just typed (the table plugin adds the
        // cells a half-typed row is missing) changes the length of the range
        // being written. Carry it, or the next frame writes into the middle
        // of the table. `to` keeps -1 so a node appended right after the
        // range (the trailing paragraph) stays outside it.
        if (this.cur) {
          this.cur.from = t.mapping.map(this.cur.from, -1);
          this.cur.to = Math.max(this.cur.from, t.mapping.map(this.cur.to, -1));
        }
      }
    };
    this.editor.on("transaction", onTx as never);
    this.offTransaction = () => this.editor.off("transaction", onTx as never);
    this.editor.setEditable(false);
  }

  /* The parser's callbacks feed these. */
  opStart(op: TraxOpStart) {
    this.queue.push({ type: "start", op });
    this.kick();
  }
  opText(html: string) {
    this.queue.push({ type: "text", html });
    this.kick();
  }
  opEnd() {
    this.queue.push({ type: "end" });
    this.kick();
  }
  /** Run `fn` once everything queued before it has been typed; right away if nothing is. */
  after(fn: () => void) {
    if (!this.cur && this.queue.length === 0) {
      fn();
      return;
    }
    this.queue.push({ type: "call", fn });
    this.kick();
  }

  /** The stream is over: resolves once everything queued has been typed. */
  finish(): Promise<void> {
    this.streamEnded = true;
    return new Promise((resolve) => {
      this.resolveDone = resolve;
      this.kick();
    });
  }

  /** Stop now: keep what is on the page, drop the rest. */
  stop() {
    this.queue = [];
    if (this.cur && !this.editor.isDestroyed) {
      this.shown = this.target.length;
      this.render();
      this.closeOp();
    }
    this.streamEnded = true;
    this.kick();
  }

  /** Did the run change the document at all? */
  get didChange() {
    return this.changed;
  }

  /* ---------------------------------------------------------------------- */

  private kick() {
    if (this.frame === null && typeof window !== "undefined") {
      this.frame = window.requestAnimationFrame(this.tick);
    }
  }

  private tick = () => {
    this.frame = null;
    if (this.editor.isDestroyed) {
      this.queue = [];
      this.cur = null;
      this.offTransaction();
      const done = this.resolveDone;
      this.resolveDone = null;
      done?.();
      return;
    }
    try {
      this.step();
    } catch (error) {
      // Never let one bad frame freeze the run: drop the op being typed and move on.
      console.warn("[trax] live write skipped a step", error);
      this.cur = null;
      this.target = "";
      this.shown = 0;
    }

    const busy = this.queue.length > 0 || (this.cur && this.shown < this.target.length);
    if (busy) {
      this.kick();
      return;
    }
    if (this.streamEnded && !this.cur && this.queue.length === 0) {
      this.complete();
    }
  };

  private step() {
    // Process queued items up to the first one that needs animation time.
    for (;;) {
      const head = this.queue[0];
      if (!head) break;
      if (head.type === "start") {
        if (this.cur) break; // still typing the previous op
        this.queue.shift();
        this.openOp(head.op);
        continue;
      }
      if (head.type === "text") {
        this.queue.shift();
        this.target += head.html;
        continue;
      }
      if (head.type === "call") {
        if (this.cur) break;
        this.queue.shift();
        head.fn();
        continue;
      }
      // end: only once everything received has been typed
      if (this.cur && this.shown < this.target.length) break;
      this.queue.shift();
      if (this.cur) {
        this.shown = this.target.length;
        this.render();
        this.closeOp();
      }
    }

    if (this.cur && this.shown < this.target.length) {
      this.advance(this.queue[0]?.type === "end");
      this.render();
    }
  }

  /** A few characters a frame; faster the further behind the stream it is. Never stops inside a tag. */
  private advance(allReceived: boolean) {
    const remaining = this.target.length - this.shown;
    let next = this.shown + Math.max(3, Math.ceil(remaining / 8));
    next = Math.min(next, this.target.length);
    const lt = this.target.lastIndexOf("<", next - 1);
    const gt = this.target.lastIndexOf(">", next - 1);
    if (lt > gt) {
      const close = this.target.indexOf(">", lt);
      // A tag still arriving waits for its end; one that never closes is taken as is.
      next = close !== -1 ? close + 1 : allReceived ? this.target.length : lt;
    }
    this.shown = Math.max(this.shown, next);
  }

  private map(pos: number, assoc: 1 | -1) {
    return this.mapping.map(pos, assoc);
  }

  private openOp(op: TraxOpStart) {
    const doc = this.editor.state.doc;
    const size = doc.content.size;
    const clamp = (n: number) => Math.max(0, Math.min(n, size));

    if (op.kind === "delete") {
      const block = this.blocks.get(op.id);
      if (!block) return;
      const last = this.lastOfRun(op.id, op.through);
      const from = clamp(this.map(block.from, 1));
      const to = clamp(this.map(last.to, -1));
      if (to > from) {
        const count = this.runLength(op.id, op.through);
        const activity = this.startActivity("delete", count > 1 ? `${count} blocks from ${block.text || "here"}` : block.text || "a block");
        this.dispatch(this.editor.state.tr.delete(from, to), null);
        this.changed = true;
        this.endActivity(activity);
      }
      return;
    }

    let from: number;
    let to: number;
    let label = "";
    if (op.kind === "replace") {
      const block = this.blocks.get(op.id);
      if (!block) {
        // An id Trax made up: put its text at the end rather than lose it.
        from = to = size;
      } else {
        from = clamp(this.map(block.from, 1));
        to = Math.max(from, clamp(this.map(this.lastOfRun(op.id, op.through).to, -1)));
        label = op.through && op.through !== op.id ? "" : block.text;
      }
    } else {
      const anchor = op.after === "start" ? null : this.blocks.get(op.after);
      from = to = clamp(anchor ? this.map(anchor.to, 1) : op.after === "start" ? this.map(0, 1) : size);
    }
    const activity = this.startActivity(op.kind, label);
    this.cur = { from, to, activity };
    this.target = "";
    this.shown = 0;
  }

  /** The last block of `id … through`; `id` itself when there is no valid `through`. */
  private lastOfRun(id: string, through?: string): CapturedBlock {
    const first = this.blocks.get(id)!;
    const last = through ? this.blocks.get(through) : undefined;
    return last && last.from >= first.from ? last : first;
  }

  private runLength(id: string, through?: string): number {
    const n = (b: string) => Number(b.slice(1));
    const last = this.lastOfRun(id, through);
    return Math.max(1, n(last.id) - n(id) + 1);
  }

  private closeOp() {
    if (!this.cur) return;
    if (this.cur.activity) {
      if (this.cur.activity.kind === "insert" || !this.cur.activity.label) {
        this.cur.activity.label = labelFromHtml(this.target) || this.cur.activity.label;
      }
      this.endActivity(this.cur.activity);
    }
    this.cur = null;
    this.target = "";
    this.shown = 0;
    const tr = this.editor.state.tr.setMeta(traxWritingKey, null);
    this.dispatch(tr, undefined);
  }

  private render() {
    if (!this.cur) return;
    const partial = this.target.slice(0, this.shown);
    const holder = document.createElement("div");
    holder.innerHTML = partial;
    const parsed = holder.textContent?.trim() || /<(table|hr)/i.test(partial) ? this.parser.parse(holder) : null;
    const content = parsed ? parsed.content : Fragment.empty;
    if (content.size === 0 && this.cur.from === this.cur.to) return;

    const size = this.editor.state.doc.content.size;
    const from = Math.max(0, Math.min(this.cur.from, size));
    const to = Math.max(from, Math.min(this.cur.to, size));
    let tr: Transaction;
    try {
      tr = this.editor.state.tr.replaceWith(from, to, content);
    } catch {
      // The half-typed piece doesn't fit as it stands: place it the forgiving
      // way a paste is placed, or wait for more text and try again.
      try {
        tr = this.editor.state.tr.replaceRange(from, to, this.parser.parseSlice(holder));
      } catch {
        return;
      }
    }
    const nextFrom = tr.mapping.map(from, -1);
    const nextTo = tr.mapping.map(to, 1);
    this.cur.from = nextFrom;
    this.cur.to = nextTo;
    this.dispatch(tr, { from: nextFrom, to: nextTo });
    this.changed = true;
    this.followCaret();
    // Name what is being added as soon as its first heading or line is complete.
    const activity = this.cur?.activity;
    if (activity && !activity.label && /<\/(h[1-3]|p|th|li)>/i.test(partial)) {
      activity.label = shortLabel(labelFromHtml(partial));
      if (activity.label) this.onActivity({ ...activity });
    }
  }

  private dispatch(tr: Transaction, writing: WritingRange | undefined) {
    if (this.editor.isDestroyed) return;
    tr.setMeta("addToHistory", false);
    tr.setMeta("trax", true);
    if (writing !== undefined) tr.setMeta(traxWritingKey, writing);
    this.editor.view.dispatch(tr);
  }

  /** Keep the line being written in view, without yanking the page every frame. */
  private followCaret() {
    const now = performance.now();
    if (now - this.lastScroll < 120) return;
    this.lastScroll = now;
    const host = this.scrollHost();
    const caret = this.editor.view.dom.querySelector(".trax-caret") as HTMLElement | null;
    if (!host || !caret) return;
    const h = host.getBoundingClientRect();
    const c = caret.getBoundingClientRect();
    if (c.bottom > h.bottom - 64 || c.top < h.top + 32) {
      host.scrollTo({ top: host.scrollTop + (c.top - h.top) - h.height / 2, behavior: "smooth" });
    }
  }

  private startActivity(kind: TraxActivity["kind"], label: string): TraxActivity {
    const activity: TraxActivity = { id: ++this.activityId, kind, label: shortLabel(label), state: "writing" };
    this.onActivity({ ...activity });
    return activity;
  }

  private endActivity(activity: TraxActivity) {
    activity.state = "done";
    activity.label = shortLabel(activity.label);
    this.onActivity({ ...activity });
  }

  /** One undo step for the whole run, then hand the document back. */
  private complete() {
    this.offTransaction();
    if (this.changed) {
      const result = this.editor.state.doc;
      const reset = this.editor.state.tr.replaceWith(0, this.editor.state.doc.content.size, this.before.content);
      reset.setMeta("addToHistory", false).setMeta(traxWritingKey, null);
      this.editor.view.dispatch(reset);
      const apply = this.editor.state.tr.replaceWith(0, this.editor.state.doc.content.size, result.content);
      apply.setMeta("trax", true);
      this.editor.view.dispatch(apply);
    }
    this.editor.setEditable(true);
    const done = this.resolveDone;
    this.resolveDone = null;
    done?.();
  }
}

/** Put the document back to `before`, as one undoable step. */
export function restoreDocument(editor: Editor, before: PMNode) {
  const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, before.content);
  tr.setMeta("trax", true);
  editor.view.dispatch(tr);
}
