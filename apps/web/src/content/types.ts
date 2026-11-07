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
  | { type: "callout"; title: string; text: string };

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
      return `${block.title} ${block.text}`;
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
