/**
 * Notifications v2, SYSTEM set: the two halves of the body editor's dialect.
 *
 * WHY THIS EXISTS. The operator portal edits an email body in Tiptap, which
 * reads and writes the stored HTML directly. apps/admin has no Tiptap, and
 * adding it is a dependency decision nobody has taken, so the admin page edits
 * the same stored HTML through a markdown-light text editor instead.
 *
 * THE TRAP THIS FILE EXISTS TO AVOID. The stored body IS HTML, and
 * settings-model decides "customised or still the default" by comparing the
 * stored body with the catalog's default body. If HTML → markdown → HTML lost
 * anything at all, merely OPENING a notification would rewrite its body,
 * `rowFromEdit` would stop returning `body: null`, and every template an admin
 * so much as looked at would be saved as a hand-written copy that no longer
 * follows the catalog. So the round trip has to be exact, not approximate, for
 * the vocabulary the catalog actually uses:
 *
 *     <p> <h1> <h2> <h3> <ul><li> <ol><li> <blockquote> <hr> <br>
 *     <strong> <b> <em> <i> <a href> <a data-email-button href>
 *
 * `markdownLightToHtml(htmlToMarkdownLight(body)) === body` is asserted over
 * EVERY email default in the catalog by
 * __tests__/components/notifications-v2-markdown-light.test.ts. That test is
 * the contract; if a future template uses something this file cannot express,
 * it goes red rather than silently customising the template.
 *
 * THE DIALECT
 *   # / ## / ###       headings
 *   - item             bullet list          1. item   numbered list
 *   > quote            blockquote           ---       divider
 *   **bold**  *italic*
 *   [label](url)       link
 *   [[label]](url)     the call-to-action button (<a data-email-button>)
 *   \* \[ \] \\        a literal asterisk, bracket or backslash
 *   {{variable}}       left exactly as typed, in both directions
 *
 * Pure string work: no DOM, no React, no DOMParser (this must also behave the
 * same under jsdom and during a server render).
 */

/* -------------------------------------------------------------------------- */
/* Entities                                                                    */
/* -------------------------------------------------------------------------- */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** `&amp;` → `&`, `&#39;` → `'`, `&#x27;` → `'`. Unknown entities are left alone. */
export function decodeEntities(value: string): string {
  return String(value ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Text for an HTML text node. Only `&`, `<` and `>` are escaped: a quote or an
 * apostrophe is legal raw text, and escaping them would break the round trip
 * with a catalog default that carries one.
 */
export function escapeHtmlText(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Text for a double-quoted attribute value. */
function escapeAttr(value: string): string {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}

/* -------------------------------------------------------------------------- */
/* Markdown escaping                                                           */
/* -------------------------------------------------------------------------- */

const MD_SPECIAL = /[\\*[\]]/g;

/** A literal `*`, `[`, `]` or `\` in the source text, so it survives as itself. */
function escapeMarkdown(value: string): string {
  return String(value ?? '').replace(MD_SPECIAL, (c) => '\\' + c);
}

/* -------------------------------------------------------------------------- */
/* HTML → markdown                                                             */
/* -------------------------------------------------------------------------- */

/** Every `<a …>` open tag: its attributes, and whether it is the CTA button. */
function anchorParts(tag: string): { href: string; button: boolean } {
  const button = /\sdata-email-button(?=[\s=>/])/i.test(tag);
  const match = tag.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const href = decodeEntities(String(match?.[1] ?? match?.[2] ?? match?.[3] ?? ''));
  return { href, button };
}

/**
 * The inline content of one block as markdown. Unknown tags are unwrapped (the
 * tag goes, its text stays) — the same rule `sanitizeEmailBodyHtml` applies, so
 * what the editor shows is what the email would have kept anyway.
 */
function inlineToMarkdown(html: string): string {
  const src = String(html ?? '');
  let out = '';
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      out += escapeMarkdown(decodeEntities(src.slice(i)));
      break;
    }
    if (lt > i) out += escapeMarkdown(decodeEntities(src.slice(i, lt)));

    const gt = src.indexOf('>', lt);
    if (gt === -1) {
      out += escapeMarkdown(decodeEntities(src.slice(lt)));
      break;
    }
    const tag = src.slice(lt, gt + 1);
    const name = (tag.match(/^<\/?\s*([a-z0-9]+)/i)?.[1] ?? '').toLowerCase();
    const closing = /^<\//.test(tag);
    i = gt + 1;

    if (name === 'br') {
      out += '\n';
      continue;
    }
    if (closing) continue; // handled by the opener below

    if (name === 'strong' || name === 'b' || name === 'em' || name === 'i') {
      const marker = name === 'strong' || name === 'b' ? '**' : '*';
      const end = findClose(src, i, name);
      out += marker + inlineToMarkdown(src.slice(i, end.inner)) + marker;
      i = end.after;
      continue;
    }
    if (name === 'a') {
      const { href, button } = anchorParts(tag);
      const end = findClose(src, i, 'a');
      const label = inlineToMarkdown(src.slice(i, end.inner));
      out += button ? `[[${label}]](${href})` : `[${label}](${href})`;
      i = end.after;
      continue;
    }
    // Anything else (span, u, s, a stray div): unwrap it and keep the text.
  }
  return out;
}

/** Where `<name>`'s matching close tag starts and ends, counting nesting. */
function findClose(src: string, from: number, name: string): { inner: number; after: number } {
  const open = new RegExp(`<${name}(?=[\\s>/])|<${name}>`, 'gi');
  const close = new RegExp(`</\\s*${name}\\s*>`, 'gi');
  let depth = 1;
  let cursor = from;
  while (cursor < src.length) {
    close.lastIndex = cursor;
    const c = close.exec(src);
    if (!c) break;
    open.lastIndex = cursor;
    let o = open.exec(src);
    while (o && o.index < c.index) {
      depth += 1;
      open.lastIndex = o.index + 1;
      o = open.exec(src);
    }
    depth -= 1;
    if (depth === 0) return { inner: c.index, after: c.index + c[0].length };
    cursor = c.index + c[0].length;
  }
  return { inner: src.length, after: src.length };
}

/** Built per call for the same reason as INLINE_SOURCE: `/g` carries state. */
const BLOCK_SOURCE =
  '<(p|h1|h2|h3|h4|h5|h6|ul|ol|blockquote)(?=[\\s>/])[^>]*>|<(p|h1|h2|h3|h4|h5|h6|ul|ol|blockquote)>|<hr\\s*/?\\s*>';

/** `<li>…</li>` items of a list block, in order. */
function listItems(inner: string): string[] {
  const items: string[] = [];
  const open = /<li(?=[\s>/])[^>]*>|<li>/gi;
  let match = open.exec(inner);
  while (match) {
    const start = match.index + match[0].length;
    const end = findClose(inner, start, 'li');
    items.push(inlineToMarkdown(inner.slice(start, end.inner)).trim());
    open.lastIndex = Math.max(end.after, start);
    match = open.exec(inner);
  }
  return items;
}

/**
 * The stored HTML body as the dialect above. Text outside any block becomes a
 * paragraph, which is what the sanitiser and the email layout do with it too.
 */
export function htmlToMarkdownLight(html: string | null | undefined): string {
  const src = String(html ?? '');
  const blocks: string[] = [];
  let cursor = 0;

  const loose = (text: string): void => {
    const md = inlineToMarkdown(text).trim();
    if (md) blocks.push(md);
  };

  const blockPattern = new RegExp(BLOCK_SOURCE, 'gi');
  let match = blockPattern.exec(src);
  while (match) {
    if (match.index > cursor) loose(src.slice(cursor, match.index));

    const name = (match[1] ?? match[2] ?? 'hr').toLowerCase();
    if (name === 'hr' || match[0].toLowerCase().startsWith('<hr')) {
      blocks.push('---');
      cursor = match.index + match[0].length;
    } else {
      const start = match.index + match[0].length;
      const end = findClose(src, start, name);
      const inner = src.slice(start, end.inner);

      if (name === 'ul' || name === 'ol') {
        const items = listItems(inner);
        blocks.push(
          items.map((item, index) => (name === 'ul' ? `- ${item}` : `${index + 1}. ${item}`)).join('\n'),
        );
      } else if (name === 'blockquote') {
        // A blockquote may wrap paragraphs; their text is what the quote says.
        const text = inlineToMarkdown(inner.replace(/<\/?\s*p(?=[\s>/])[^>]*>|<\/?\s*p>/gi, '\n')).trim();
        blocks.push(
          text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => `> ${line}`)
            .join('\n'),
        );
      } else if (name === 'p') {
        const text = inlineToMarkdown(inner).trim();
        if (text) blocks.push(text);
      } else {
        const level = Number(name.slice(1));
        blocks.push('#'.repeat(Math.min(3, level)) + ' ' + inlineToMarkdown(inner).trim());
      }
      cursor = end.after;
    }
    blockPattern.lastIndex = cursor;
    match = blockPattern.exec(src);
  }
  if (cursor < src.length) loose(src.slice(cursor));

  return blocks.join('\n\n');
}

/* -------------------------------------------------------------------------- */
/* Markdown → HTML                                                             */
/* -------------------------------------------------------------------------- */

const INLINE_SOURCE =
  '\\\\([\\\\*[\\]])|\\[\\[([^\\]\\n]*)\\]\\]\\(([^)\\s]*)\\)|\\[([^\\]\\n]*)\\]\\(([^)\\s]*)\\)|\\*\\*([\\s\\S]+?)\\*\\*|\\*([^*\\n]+)\\*';

/**
 * One line or fragment of markdown as inline HTML.
 *
 * The pattern is built PER CALL, never shared. This function recurses (a link
 * label may be bold, a bold run may hold a link), and a `/g` regex carries a
 * mutable `lastIndex`: one shared instance would have the inner call move the
 * outer call's cursor, which corrupts the parse and can spin forever when the
 * cursor moves backwards.
 */
export function inlineToHtml(markdown: string, depth = 0): string {
  const src = String(markdown ?? '');
  if (depth > 4) return escapeHtmlText(src);
  const pattern = new RegExp(INLINE_SOURCE, 'g');
  let out = '';
  let last = 0;

  let match = pattern.exec(src);
  while (match) {
    out += escapeHtmlText(src.slice(last, match.index));
    const [whole, escaped, buttonLabel, buttonHref, linkLabel, linkHref, bold, italic] = match;

    if (escaped !== undefined) {
      out += escapeHtmlText(escaped);
    } else if (buttonLabel !== undefined) {
      // Attribute order and spacing match the catalog's own `button()` helper
      // exactly, so a default body survives the round trip byte for byte.
      out += `<a data-email-button href="${escapeAttr(buttonHref ?? '')}">${inlineToHtml(buttonLabel, depth + 1)}</a>`;
    } else if (linkLabel !== undefined) {
      out += `<a href="${escapeAttr(linkHref ?? '')}">${inlineToHtml(linkLabel, depth + 1)}</a>`;
    } else if (bold !== undefined) {
      out += `<strong>${inlineToHtml(bold, depth + 1)}</strong>`;
    } else if (italic !== undefined) {
      out += `<em>${inlineToHtml(italic, depth + 1)}</em>`;
    } else {
      out += escapeHtmlText(whole);
    }
    last = match.index + whole.length;
    match = pattern.exec(src);
  }
  out += escapeHtmlText(src.slice(last));
  return out;
}

const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const DIVIDER = /^(?:-{3,}|\*{3,}|_{3,})$/;

/**
 * The dialect as the HTML that is stored and sent. Only tags
 * `sanitizeEmailBodyHtml` keeps are produced, so the preview, the test send and
 * the stored value are the same document.
 */
export function markdownLightToHtml(markdown: string | null | undefined): string {
  const lines = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const out: string[] = [];
  let i = 0;

  const isBlank = (line: string): boolean => line.trim() === '';

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    const trimmed = line.trim();

    if (DIVIDER.test(trimmed)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    const heading = trimmed.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inlineToHtml(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    if (BULLET.test(trimmed) || NUMBERED.test(trimmed)) {
      const ordered = !BULLET.test(trimmed) && NUMBERED.test(trimmed);
      const items: string[] = [];
      while (i < lines.length) {
        const current = (lines[i] ?? '').trim();
        const match = ordered ? current.match(NUMBERED) : current.match(BULLET);
        // A run ends at the first line that is not an item of the same kind.
        if (!match) break;
        items.push(`<li>${inlineToHtml(match[1].trim())}</li>`);
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    if (QUOTE.test(trimmed)) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const match = (lines[i] ?? '').trim().match(QUOTE);
        if (!match) break;
        quoted.push(inlineToHtml(match[1].trim()));
        i += 1;
      }
      out.push(`<blockquote><p>${quoted.join('<br>')}</p></blockquote>`);
      continue;
    }

    // A paragraph: every line until a blank one or the start of another block.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = (lines[i] ?? '').trim();
      if (
        isBlank(current) ||
        DIVIDER.test(current) ||
        HEADING.test(current) ||
        BULLET.test(current) ||
        NUMBERED.test(current) ||
        QUOTE.test(current)
      ) {
        break;
      }
      paragraph.push(inlineToHtml(current));
      i += 1;
    }
    out.push(`<p>${paragraph.join('<br>')}</p>`);
  }

  return out.join('');
}

/* -------------------------------------------------------------------------- */
/* Toolbar helpers                                                             */
/* -------------------------------------------------------------------------- */

export type MarkdownAction = 'bold' | 'italic' | 'heading' | 'bullet' | 'numbered' | 'quote' | 'link' | 'button' | 'divider';

export interface MarkdownEdit {
  value: string;
  /** Where the caret (or the selection) goes afterwards. */
  start: number;
  end: number;
}

/** The markdown a toolbar button produces around (or in place of) the selection. */
export function applyMarkdownAction(
  value: string,
  selection: { start: number; end: number } | null | undefined,
  action: MarkdownAction,
): MarkdownEdit {
  const text = String(value ?? '');
  const clamp = (n: number): number => Math.min(Math.max(0, Number.isFinite(n) ? n : text.length), text.length);
  const start = clamp(selection?.start ?? text.length);
  const end = Math.max(start, clamp(selection?.end ?? start));
  const selected = text.slice(start, end);

  const wrap = (marker: string, placeholder: string): MarkdownEdit => {
    const body = selected || placeholder;
    const next = text.slice(0, start) + marker + body + marker + text.slice(end);
    return { value: next, start: start + marker.length, end: start + marker.length + body.length };
  };

  const prefixLines = (prefix: (index: number) => string): MarkdownEdit => {
    // The whole of every line the selection touches.
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEndIndex = text.indexOf('\n', end);
    const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
    const block = text.slice(lineStart, lineEnd) || '';
    const prefixed = block
      .split('\n')
      .map((line, index) => prefix(index) + line.replace(/^(?:[-*]\s+|\d+[.)]\s+|>\s?|#{1,3}\s+)/, ''))
      .join('\n');
    const next = text.slice(0, lineStart) + prefixed + text.slice(lineEnd);
    return { value: next, start: lineStart, end: lineStart + prefixed.length };
  };

  switch (action) {
    case 'bold':
      return wrap('**', 'bold text');
    case 'italic':
      return wrap('*', 'italic text');
    case 'heading':
      return prefixLines(() => '### ');
    case 'bullet':
      return prefixLines(() => '- ');
    case 'numbered':
      return prefixLines((index) => `${index + 1}. `);
    case 'quote':
      return prefixLines(() => '> ');
    case 'divider': {
      const before = start === 0 || text[start - 1] === '\n' ? '' : '\n';
      const token = `${before}\n---\n`;
      const next = text.slice(0, start) + token + text.slice(end);
      return { value: next, start: start + token.length, end: start + token.length };
    }
    case 'link':
    case 'button': {
      const label = selected || (action === 'button' ? 'Open your portal' : 'this link');
      const token = action === 'button' ? `[[${label}]](https://)` : `[${label}](https://)`;
      const next = text.slice(0, start) + token + text.slice(end);
      // The caret lands inside the empty URL, which is the part that must be filled in.
      const caret = start + token.length - 1;
      return { value: next, start: caret, end: caret };
    }
    default:
      return { value: text, start, end };
  }
}
