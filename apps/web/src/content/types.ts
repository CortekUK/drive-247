/**
 * The blog and the customer stories are static: plain data in this folder, rendered
 * by the pages under app/(marketing)/(content). No CMS, no database. Adding a post is
 * adding an object to posts.ts.
 */

/** One piece of an article body. */
export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "list"; items: readonly string[] }
  | { type: "steps"; items: readonly { title: string; text: string }[] }
  | { type: "quote"; text: string; by?: string }
  | { type: "callout"; title: string; text: string }
  /* The blocks below are drawn by the blog article page only. Text in them (and in p, h2)
     may mark a phrase *like this* for the cursive face, or **like this** for bold. */
  /** One large statement on its own. */
  | { type: "big"; text: string }
  /** A full-width purple band with white type. */
  | { type: "band"; text: string; sub?: string }
  /** A row of large figures. */
  | { type: "stats"; items: readonly { value: string; label: string }[] }
  /** A bar chart. Values are plain numbers; `prefix` is put before each one ("$"). */
  | { type: "bars"; title: string; note?: string; prefix?: string; bars: readonly { label: string; value: number; strong?: boolean }[] }
  /** Two columns set against each other; the right one is the one we argue for. */
  | { type: "compare"; left: { title: string; items: readonly string[] }; right: { title: string; items: readonly string[] } }
  /** A photograph beside a short passage. */
  | { type: "side"; src: string; alt: string; title: string; text: string };

/** A real product screen used as a cover, with its dark-mode capture. */
export interface Cover {
  src: string;
  dark: string;
  alt: string;
}

const WORDS_PER_MINUTE = 200;

function blockWords(block: Block): string {
  switch (block.type) {
    case "list":
      return block.items.join(" ");
    case "steps":
      return block.items.map((step) => `${step.title} ${step.text}`).join(" ");
    case "callout":
    case "side":
      return `${block.title} ${block.text}`;
    case "band":
      return `${block.text} ${block.sub ?? ""}`;
    case "stats":
      return block.items.map((item) => `${item.value} ${item.label}`).join(" ");
    case "bars":
      return `${block.title} ${block.note ?? ""}`;
    case "compare":
      return [block.left.title, ...block.left.items, block.right.title, ...block.right.items].join(" ");
    default:
      return block.text;
  }
}

export function readMinutes(body: readonly Block[]): number {
  const words = body.map(blockWords).join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round(words / WORDS_PER_MINUTE));
}

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Nov 3, 2026" for an ISO date. */
export function formatDate(iso: string): string {
  return DATE.format(new Date(`${iso}T00:00:00Z`));
}
