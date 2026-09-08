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

/**
 * Marks a real paragraph boundary while the string is being cleaned.
 *
 * This used to split on "\n", which broke every story whose source HTML was
 * wrapped across lines — and rich-text editors wrap constantly. A single `<p>`
 * spanning four source lines rendered as FOUR paragraphs, each break landing
 * mid-sentence. A NUL is used because it cannot occur in the decoded text, so
 * it can never split a paragraph the author actually wrote.
 */
const SPLIT = "\u0000";

/**
 * Does this content carry block-level markup? Non-global on purpose: a `/g`
 * regex keeps `lastIndex` between `.test()` calls and would answer differently
 * on alternate invocations.
 */
const HAS_BLOCK = /<\/(p|div|h[1-6]|li|blockquote|tr)\s*>|<br\s*\/?>/i;

/** A blank line — an unambiguous paragraph break in anyone's convention. */
const BLANK_LINE = /\n[ \t]*\n+/g;

/**
 * A single newline that FOLLOWS the end of a sentence.
 *
 * The hard case this exists for: a plain-text story has no tags, so a newline
 * is the only structure there is — but the same character does two jobs. An
 * operator pressing Enter between paragraphs means "new paragraph"; the same
 * operator (or a paste from a wrapped document) puts one at the end of every
 * visual line, meaning nothing at all.
 *
 * Treating every newline as a break shattered a three-paragraph story into
 * nine, each fragment ending mid-clause — "renting a car" / "had become an
 * exercise in fine print". Treating none of them as breaks collapsed the whole
 * story into one slab.
 *
 * Sentence-ending punctuation is what separates the two, and it is right far
 * more often than either extreme: a line ending "…already scratched." is a
 * paragraph, a line ending "…the car you get, the" is a wrap. A blank line
 * still always wins, for anyone who writes that way.
 */
const SENTENCE_BREAK = /([.!?][")'’”]?)\n+/g;

/** Any remaining newline is a soft wrap inside a paragraph. */
const SOFT_WRAP = /\n+/g;

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
  /**
   * Which character actually separates paragraphs depends on what was written.
   *
   *  - HTML (`</p>`, `<br>`): the TAGS are the structure, and the newlines are
   *    just source formatting. Splitting on newlines here — which this did —
   *    tore a wrapped `<p>` into one paragraph per source line, mid-sentence.
   *  - Plain prose typed in the textarea: there are no tags, so a newline is
   *    the only paragraph signal the author has, and it must be honoured.
   *
   * Guessing one rule for both cannot work, because in plain text a wrapped
   * line and a new paragraph are the same character.
   */
  const separated = HAS_BLOCK.test(html)
    ? html.replace(BLOCK_BREAK, SPLIT)
    : html
        .replace(BLANK_LINE, SPLIT)
        .replace(SENTENCE_BREAK, `$1${SPLIT}`)
        .replace(SOFT_WRAP, " ");

  return separated
    .replace(TAG, "")
    .split(SPLIT)
    /* `\s+` covers newlines, so wrapping inside a paragraph collapses to a
       single space rather than tearing the sentence in half. */
    .map((line) => decode(line).replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}
