/**
 * The portal's about-page story is written in a Tiptap editor and stored as
 * HTML. v2 renders it as paragraphs of TEXT rather than injecting the markup.
 *
 * Two reasons, in order of importance:
 *
 *  1. `dangerouslySetInnerHTML` on operator-authored content is a stored-XSS
 *     sink. The portal does not sanitise on write, and this site is public.
 *  2. The section it lands in is a fixed two-column Figma layout. Arbitrary
 *     `<table>` / `<img>` / inline styles from a rich-text editor would break
 *     it at 360px regardless of whether they were hostile.
 *
 * Block-level tags become paragraph breaks so a three-paragraph story still
 * reads as three paragraphs; everything else is dropped.
 */

const BLOCK_BREAK = /<\/(p|div|h[1-6]|li|blockquote|tr)\s*>|<br\s*\/?>/gi;
const TAG = /<[^>]*>/g;

const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/g, " "],
  [/&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#0?39;/g, "'"],
  [/&apos;/g, "'"],
  [/&mdash;/g, "—"],
  [/&ndash;/g, "–"],
  [/&hellip;/g, "…"],
  [/&rsquo;/g, "’"],
  [/&lsquo;/g, "‘"],
  [/&ldquo;/g, "“"],
  [/&rdquo;/g, "”"],
];

function decode(text: string): string {
  return ENTITIES.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text,
  );
}

/**
 * Rich text (or plain text) -> an array of paragraphs, never empty-stringed.
 * Plain text with no markup at all round-trips unchanged as a single item.
 */
export function htmlToParagraphs(html: string): string[] {
  if (!html) return [];
  return html
    .replace(BLOCK_BREAK, "\n")
    .replace(TAG, "")
    .split("\n")
    .map((line) => decode(line).replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}
