/**
 * A blog post's body, read into typed blocks for the v2 article column.
 *
 * Same rule as v1's post page and `lib/cms/html.ts`: the portal's editor HTML
 * is never injected (the portal does not sanitise on write and this page is
 * public). What v2 adds is the STRUCTURE — headings, lists, quotes, code and
 * images become their own blocks, so the article can give each its own
 * typography. Every block carries plain text only; tags inside a block (bold,
 * links, spans) are dropped by `htmlToParagraphs`, which also decodes entities.
 */

import { htmlToParagraphs } from '@nw/lib/cms/html';

export type PostBlock =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; paragraphs: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'rule' };

/** Top-level blocks, in document order. Lazy, so `</p>` closes the nearest `<p>`. */
const BLOCK =
  /<(h[1-6]|p|ul|ol|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1\s*>|<img\b[^>]*>|<hr\b[^>]*>/gi;
const LIST_ITEM = /<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi;
const HAS_BLOCK = /<(h[1-6]|p|ul|ol|blockquote|pre|img|hr)\b/i;

/** Only http(s) images: an operator-typed `src` is still operator-typed. */
function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/** Code keeps its line breaks and spacing, so it cannot go through `htmlToParagraphs`. */
function codeText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/^\n+|\s+$/g, '');
}

const inline = (html: string) => htmlToParagraphs(html).join(' ');

function paragraphs(html: string, into: PostBlock[]) {
  for (const text of htmlToParagraphs(html)) into.push({ kind: 'paragraph', text });
}

/** Script and style bodies are not prose; without this their source would print as text. */
const NON_PROSE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

export function htmlToBlocks(source: string): PostBlock[] {
  if (!source) return [];
  const html = source.replace(NON_PROSE, '');
  // Plain prose typed without markup: v1's paragraph rules, unchanged.
  if (!HAS_BLOCK.test(html)) return htmlToParagraphs(html).map((text) => ({ kind: 'paragraph', text }));

  const blocks: PostBlock[] = [];
  let cursor = 0;

  for (const match of html.matchAll(BLOCK)) {
    const index = match.index ?? 0;
    // Loose text between blocks still reads, as paragraphs.
    if (index > cursor) paragraphs(html.slice(cursor, index), blocks);
    cursor = index + match[0].length;

    const tag = match[1]?.toLowerCase();
    const inner = match[2] ?? '';

    if (!tag) {
      if (/^<hr/i.test(match[0])) {
        blocks.push({ kind: 'rule' });
        continue;
      }
      const src = attr(match[0], 'src');
      if (src && /^https?:\/\//i.test(src.trim())) {
        blocks.push({ kind: 'image', src: src.trim(), alt: inline(attr(match[0], 'alt') ?? '') });
      }
      continue;
    }

    if (tag[0] === 'h') {
      const text = inline(inner);
      // The page's own title is the only h1.
      if (text) blocks.push({ kind: 'heading', level: Number(tag[1]) <= 2 ? 2 : 3, text });
    } else if (tag === 'p') {
      // An editor sometimes wraps an image in a paragraph.
      const img = /<img\b[^>]*>/i.exec(inner);
      if (img) {
        const src = attr(img[0], 'src');
        if (src && /^https?:\/\//i.test(src.trim())) {
          blocks.push({ kind: 'image', src: src.trim(), alt: inline(attr(img[0], 'alt') ?? '') });
        }
      }
      paragraphs(inner, blocks);
    } else if (tag === 'ul' || tag === 'ol') {
      const items = [...inner.matchAll(LIST_ITEM)].map((li) => inline(li[1])).filter(Boolean);
      if (items.length > 0) blocks.push({ kind: 'list', ordered: tag === 'ol', items });
    } else if (tag === 'blockquote') {
      const quote = htmlToParagraphs(inner);
      if (quote.length > 0) blocks.push({ kind: 'quote', paragraphs: quote });
    } else if (tag === 'pre') {
      const text = codeText(inner);
      if (text) blocks.push({ kind: 'code', text });
    }
  }

  if (cursor < html.length) paragraphs(html.slice(cursor), blocks);
  return blocks;
}
