/**
 * HTML entity decoding for text on its way into a generated PDF.
 *
 * WHY THIS EXISTS
 * Moore Luxe's signed rental agreement R-798b28 shows the renter, in the
 * security-deposit clause of the contract they put their name to:
 *
 *   "charged to the Renter&rsquo;s payment method"
 *   "not a temporary authorisation hold &mdash; the funds are taken"
 *   "received within 5&ndash;10 business days"
 *
 * We wrote that clause ourselves. It is injected by the agreement engine for
 * every tenant that charges deposits rather than holding them, and it is written
 * with HTML entities — but the PDF path decoded only seven entities
 * (&nbsp; &amp; &lt; &gt; &quot; &#39; &middot;) and `&rsquo;`, `&mdash;` and
 * `&ndash;` were not among them. So our own boilerplate printed its own markup
 * into a legal document.
 *
 * WHY DECODING TO REAL CHARACTERS IS SAFE HERE
 * The PDF text sanitiser encodes WinAnsi, and `WINANSI_HIGH` already admits
 * ’ ‘ ” “ – — • … ™, so these resolve to the correct glyph rather than "?".
 * Anything genuinely unencodable still degrades through that sanitiser, which is
 * the right place for that decision — not here.
 *
 * ORDERING MATTERS: `&amp;` is decoded LAST. Decoding it first turns the literal
 * text "&amp;rsquo;" into "&rsquo;", which the next rule then turns into an
 * apostrophe — silently corrupting text that was correctly escaped.
 */

/** Named entities, longest-lived first. `amp` is deliberately absent — see below. */
const NAMED: Record<string, string> = {
  nbsp: " ",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  middot: "·",
  // The three that put markup into a signed contract.
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  bull: "•",
  // Common in operator-authored terms pasted from Word or a website.
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  pound: "£",
  euro: "€",
  cent: "¢",
  yen: "¥",
  sect: "§",
  para: "¶",
  laquo: "«",
  raquo: "»",
  frac12: "½",
  frac14: "¼",
  sup2: "²",
  plusmn: "±",
};

/**
 * Decode HTML entities in text destined for a PDF.
 *
 * Handles named entities, decimal (`&#8217;`) and hexadecimal (`&#x2019;`)
 * numeric references. Unknown entities are left exactly as written rather than
 * dropped: an operator who typed "&foo;" in their own terms should see it back,
 * not lose it silently.
 */
export function decodeHtmlEntities(str: string): string {
  if (!str) return "";

  let out = str.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    const token = String(body);

    // Numeric: &#8217; or &#x2019;
    if (token[0] === "#") {
      const isHex = token[1] === "x" || token[1] === "X";
      const digits = isHex ? token.slice(2) : token.slice(1);
      const code = parseInt(digits, isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      // Lone surrogates are not valid scalar values and would throw.
      if (code >= 0xd800 && code <= 0xdfff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }

    // `amp` is handled in the second pass below, never here.
    if (token.toLowerCase() === "amp") return match;

    const named = NAMED[token.toLowerCase()];
    return named !== undefined ? named : match;
  });

  // LAST, and only now: a correctly-escaped "&amp;rsquo;" has survived the pass
  // above as literal text and becomes "&rsquo;", which is what the author wrote.
  out = out.replace(/&amp;/gi, "&");
  return out;
}

/**
 * The entities this codebase's own injected clauses emit. The parity test asserts
 * every rendering path decodes each one, so we cannot ship boilerplate whose
 * markup reaches a customer again.
 */
export const ENTITIES_WE_EMIT = [
  "&rsquo;",
  "&mdash;",
  "&ndash;",
  "&nbsp;",
  "&middot;",
  "&quot;",
  "&amp;",
  "&lt;",
  "&gt;",
] as const;
