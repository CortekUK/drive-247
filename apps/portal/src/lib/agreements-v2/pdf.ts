/**
 * Agreements v2 — the PDF an INDIVIDUAL agreement is sent as (drawn in the browser).
 *
 * A COPY of the HTML → blocks parser and the pdf-lib renderer in
 * app/api/esign/route.ts (the rental send path), not an import of them: that
 * route is v1, its helpers are module-private, and it must stay byte-identical
 * (V2_PLAN §3). Same fonts (Helvetica family), same sizes and line heights,
 * the same banner box, the same WinAnsi sanitising, and the BoldSign text tags
 * (`{{@sig1}}`, `{{@init1}}`, `{{@date1}}`) drawn in WHITE so the signing
 * provider finds them and the reader does not see them. The parser is pinned
 * to the original by a parity test (__tests__/lib/agreements-v2-pdf.test.ts),
 * which lifts route.ts's own `parseHtmlToBlocks` and compares the output.
 *
 * TWO DIFFERENCES, both deliberate:
 *
 *  1. The operator's signature. `<img data-operator-signature="true"
 *     src="data:image/png|jpeg;base64,…">` (D9) becomes an `image` block,
 *     drawn with embedPng / embedJpg, scaled to fit 200 × 70 pt keeping its
 *     aspect ratio. Every other `<img>` is still ignored, exactly as today: a
 *     pasted logo, a remote URL or an SVG never reaches the PDF.
 *  2. The banner says the document's own title (uppercased) instead of
 *     "ORIGINAL RENTAL AGREEMENT", because an individual agreement is not a
 *     rental agreement.
 *
 * Also: route.ts's WINANSI_REPLACEMENTS has seven entries whose keys are empty
 * strings (the ballot-box and check-mark characters were lost from the file at
 * some point), so a "☐" in a rental agreement prints as "?". Here the keys are
 * written as \u escapes and do what their comments say. That is the only
 * sanitising difference, and it only affects those seven characters.
 *
 * BROWSER-SAFE, and rendered in the browser on purpose: the portal's Next
 * server holds no secrets, so the send runs in the `agreements-v2` edge
 * function, and the PDF it forwards is drawn HERE, from the exact final html
 * the Send dialog previews (lib/agreements-v2/api-client.ts). Nothing in this
 * file uses a Node API: pdf-lib is plain JS, and base64 is made with chunked
 * `btoa` (`renderAgreementPdfBase64`). The api-client loads this module with a
 * dynamic import, so pdf-lib stays out of the page's first bundle.
 */

import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import { decodeHtmlEntities } from '@/lib/html-entities';
import { OPERATOR_SIGNATURE_ATTR } from '@/lib/agreements-v2/types';

// ============================================================================
// HTML → STRUCTURED BLOCKS PARSER (copied from app/api/esign/route.ts)
// ============================================================================

export interface TextRun { text: string; bold: boolean; italic: boolean; underline: boolean; }
export interface TableRow { cells: string[]; isHeader: boolean; }
export type TextAlign = 'left' | 'center' | 'right';
export interface PdfImage { format: 'png' | 'jpeg'; base64: string; }
export interface PdfBlock {
  type: 'h1' | 'h2' | 'h3' | 'paragraph' | 'table' | 'bullet-list' | 'ordered-list' | 'hr' | 'image';
  runs?: TextRun[];
  rows?: TableRow[];
  items?: TextRun[][];
  align?: TextAlign;
  /** `image` blocks only: the operator's signature. */
  image?: PdfImage;
}

function removeEmptyFields(html: string): string {
  return html
    .replace(/<tr>\s*<td>.*?<\/td>\s*<td>\s*<\/td>\s*<\/tr>/gi, '')
    .replace(/<p>\s*<strong>[^<]*:<\/strong>\s*<\/p>/gi, '')
    .replace(/<p>\s*<strong>[^<]*:<\/strong>(\s|&nbsp;)*<\/p>/gi, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/<tr>\s*<td>.*?<\/td>\s*<td>\s+<\/td>\s*<\/tr>/gi, '');
}

function decodeEntities(str: string): string {
  return decodeHtmlEntities(str);
}

function stripTags(html: string): string {
  return sanitizePdfText(decodeEntities(html.replace(/<[^>]+>/g, '')).trim());
}

function parseInlineRuns(html: string, parentBold = false, parentItalic = false, parentUnderline = false): TextRun[] {
  const runs: TextRun[] = [];
  let remaining = html;

  // Match the first inline formatting tag
  const tagRe = /<(strong|b|em|i|u)((?:\s+[^>]*)?)>([\s\S]*?)<\/\1>/i;

  while (remaining.length > 0) {
    const match = remaining.match(tagRe);
    if (match && match.index !== undefined) {
      if (match.index > 0) {
        const text = stripTags(remaining.substring(0, match.index));
        if (text) runs.push({ text, bold: parentBold, italic: parentItalic, underline: parentUnderline });
      }
      const tagName = match[1].toLowerCase();
      const innerHtml = match[3];
      const isBold = parentBold || tagName === 'strong' || tagName === 'b';
      const isItalic = parentItalic || tagName === 'em' || tagName === 'i';
      const isUnderline = parentUnderline || tagName === 'u';
      const innerRuns = parseInlineRuns(innerHtml, isBold, isItalic, isUnderline);
      runs.push(...innerRuns);
      remaining = remaining.substring(match.index + match[0].length);
    } else {
      const text = stripTags(remaining);
      if (text) runs.push({ text, bold: parentBold, italic: parentItalic, underline: parentUnderline });
      break;
    }
  }

  return runs.length > 0 ? runs : [{ text: '', bold: false, italic: false, underline: false }];
}

function extractAlign(tagHtml: string): TextAlign {
  const alignMatch = tagHtml.match(/text-align:\s*(left|center|right)/i);
  return (alignMatch ? alignMatch[1].toLowerCase() : 'left') as TextAlign;
}

function parseTableRows(tableHtml: string): TableRow[] {
  const rows: TableRow[] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const rowContent = rowMatch[1];
    const isHeader = /<th/i.test(rowContent);
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      cells.push(stripTags(cellMatch[1]));
    }
    if (cells.length > 0) {
      rows.push({ cells, isHeader });
    }
  }
  return rows;
}

function parseListItems(listHtml: string): TextRun[][] {
  const items: TextRun[][] = [];
  const itemRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = itemRegex.exec(listHtml)) !== null) {
    const runs = parseInlineRuns(match[1]);
    if (runs.some(r => r.text.trim())) items.push(runs);
  }
  return items;
}

// ── The one addition: the operator's signature image ─────────────────────────

/** The longest signature data URL accepted: the same 500 kB cap as the editor, the hook and the table CHECK. */
export const OPERATOR_SIGNATURE_MAX_LENGTH = 512_000;
const SIGNATURE_DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;
const IMG_TAG = /<img\b[^>]*>/gi;

/** An attribute's value from one tag's source, double- or single-quoted. */
function attrOf(tag: string, name: string): string | null {
  const escaped = name.replace(/[-]/g, '\\-');
  const m = tag.match(new RegExp(`\\s${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

/**
 * The image an `<img>` tag stands for, when (and only when) it is the
 * operator's signature: marked `data-operator-signature="true"`, and its `src`
 * a PNG or JPEG data URL within the cap. Anything else answers null and is
 * ignored, as every `<img>` always has been.
 */
export function operatorSignatureImage(tag: string): PdfImage | null {
  if (attrOf(tag, OPERATOR_SIGNATURE_ATTR) !== 'true') return null;
  const src = attrOf(tag, 'src');
  if (!src || src.length > OPERATOR_SIGNATURE_MAX_LENGTH) return null;
  const m = src.match(SIGNATURE_DATA_URL);
  if (!m) return null;
  return { format: m[1] as 'png' | 'jpeg', base64: m[2] };
}

const hasOperatorSignature = (html: string): boolean =>
  (html.match(IMG_TAG) ?? []).some((tag) => operatorSignatureImage(tag) !== null);

/**
 * A paragraph's content, split around any operator-signature images in it:
 * the text before becomes a paragraph, the image an image block, and so on.
 * Only called for a paragraph that has one; every other paragraph takes the
 * original path untouched.
 */
function paragraphWithSignature(content: string, align: TextAlign): PdfBlock[] {
  const out: PdfBlock[] = [];
  let last = 0;
  const pushText = (html: string) => {
    const runs = parseInlineRuns(html);
    if (runs.some(r => r.text.trim())) out.push({ type: 'paragraph', runs, align });
  };
  for (const m of content.matchAll(IMG_TAG)) {
    const image = operatorSignatureImage(m[0]);
    if (!image) continue;
    pushText(content.slice(last, m.index));
    out.push({ type: 'image', image, align });
    last = (m.index ?? 0) + m[0].length;
  }
  pushText(content.slice(last));
  return out;
}

export function parseHtmlToBlocks(html: string): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  let cleaned = removeEmptyFields(html).replace(/\r\n/g, '\n');

  // Replace block-level elements with indexed markers to preserve document order
  let idx = 0;
  const blockMap = new Map<string, { tag: string; content: string; attrs: string }>();

  const replaceBlock = (tag: string) => (match: string, ...args: string[]) => {
    const key = `\n\x00BLOCK_${idx++}\x00\n`;
    // For tags with captured attrs group: args[0]=attrs, args[1]=content
    // For tags without attrs: args[0]=content
    const hasAttrs = args.length >= 2 && typeof args[1] === 'string';
    const attrs = hasAttrs ? (args[0] || '') : '';
    const content = hasAttrs ? (args[1] || '') : (args[0] || '');
    blockMap.set(key.trim(), { tag, content, attrs });
    return key;
  };

  // Order matters: tables first (they contain <td>/<th>/<p> which shouldn't be matched separately)
  cleaned = cleaned.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, replaceBlock('table'));
  cleaned = cleaned.replace(/<h1([^>]*)>([\s\S]*?)<\/h1>/gi, replaceBlock('h1'));
  cleaned = cleaned.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi, replaceBlock('h2'));
  cleaned = cleaned.replace(/<h3([^>]*)>([\s\S]*?)<\/h3>/gi, replaceBlock('h3'));
  cleaned = cleaned.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, replaceBlock('ul'));
  cleaned = cleaned.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, replaceBlock('ol'));
  cleaned = cleaned.replace(/<hr\s*\/?>/gi, () => {
    const key = `\n\x00BLOCK_${idx++}\x00\n`;
    blockMap.set(key.trim(), { tag: 'hr', content: '', attrs: '' });
    return key;
  });
  cleaned = cleaned.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, replaceBlock('p'));
  // v2: an operator signature that stands on its own (the editor writes it as a
  // block node, outside any <p>). One inside a <p> is still in that
  // paragraph's content and is split out below; one in a table cell, heading
  // or list item is ignored, as every image there always was.
  cleaned = cleaned.replace(IMG_TAG, (tag) => {
    const image = operatorSignatureImage(tag);
    if (!image) return tag;
    const key = `\n\x00BLOCK_${idx++}\x00\n`;
    blockMap.set(key.trim(), { tag: 'img', content: tag, attrs: '' });
    return key;
  });

  // Split by lines and process in document order
  const parts = cleaned.split('\n').map(p => p.trim()).filter(Boolean);

  for (const part of parts) {
    const block = blockMap.get(part);
    if (block) {
      const align = extractAlign(block.attrs);
      switch (block.tag) {
        case 'hr':
          blocks.push({ type: 'hr' });
          break;
        case 'h1':
          blocks.push({ type: 'h1', runs: parseInlineRuns(block.content), align });
          break;
        case 'h2':
          blocks.push({ type: 'h2', runs: parseInlineRuns(block.content), align });
          break;
        case 'h3':
          blocks.push({ type: 'h3', runs: parseInlineRuns(block.content), align });
          break;
        case 'p': {
          if (hasOperatorSignature(block.content)) {
            blocks.push(...paragraphWithSignature(block.content, align));
            break;
          }
          const runs = parseInlineRuns(block.content);
          if (runs.some(r => r.text.trim())) {
            blocks.push({ type: 'paragraph', runs, align });
          }
          break;
        }
        case 'table': {
          const rows = parseTableRows(block.content);
          if (rows.length > 0) blocks.push({ type: 'table', rows });
          break;
        }
        case 'ul':
          blocks.push({ type: 'bullet-list', items: parseListItems(block.content) });
          break;
        case 'ol':
          blocks.push({ type: 'ordered-list', items: parseListItems(block.content) });
          break;
        case 'img': {
          const image = operatorSignatureImage(block.content);
          if (image) blocks.push({ type: 'image', image, align: 'left' });
          break;
        }
      }
    } else {
      // Raw text outside any block tag — skip internal markers and strip control chars
      if (/\x00/.test(part)) continue;
      const text = stripTags(part).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
      if (text) {
        blocks.push({ type: 'paragraph', runs: [{ text, bold: false, italic: false, underline: false }] });
      }
    }
  }

  return blocks;
}

// ============================================================================
// STRUCTURED PDF RENDERER (copied from app/api/esign/route.ts)
// ============================================================================

/**
 * Sanitize text for pdf-lib's StandardFonts (WinAnsi/CP1252 only). Replaces
 * common Unicode characters with WinAnsi equivalents and anything still
 * outside WinAnsi with '?', so a stray glyph can never throw
 * `WinAnsi cannot encode …` and kill the send.
 */
const WINANSI_REPLACEMENTS: Record<string, string> = {
  '☐': '[ ]', // ballot box
  '☑': '[x]', // ballot box with check
  '☒': '[x]', // ballot box with x
  '✓': 'Y', // check mark
  '✔': 'Y', // heavy check mark
  '✗': 'X', // ballot x
  '✘': 'X', // heavy ballot x
  '→': '->', // rightwards arrow
  '←': '<-', // leftwards arrow
  '⇒': '=>', // rightwards double arrow
  ' ': ' ', // nbsp -> regular space
};
// CP1252 high chars (0x80–0x9F range) that ARE encodable by WinAnsi
const WINANSI_HIGH = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function sanitizePdfText(s: string): string {
  if (!s) return '';
  let out = '';
  for (const ch of s) {
    const replacement = WINANSI_REPLACEMENTS[ch];
    if (replacement !== undefined) { out += replacement; continue; }
    const code = ch.codePointAt(0)!;
    if (code === 0x09 || code === 0x0A || code === 0x0D) { out += ch; continue; }
    if (code < 0x20) continue;
    if (code <= 0x7E) { out += ch; continue; }
    if (code >= 0xA0 && code <= 0xFF) { out += ch; continue; }
    if (WINANSI_HIGH.has(ch)) { out += ch; continue; }
    out += '?';
  }
  return out;
}

/**
 * The same, for text drawn on ONE line: pdf-lib's WinAnsi encoder throws on a
 * newline, and the single-line draw sites never split (see route.ts for the
 * Kedic Services history behind this).
 */
function sanitizePdfLine(s: string): string {
  return sanitizePdfText(s).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

const PAGE_W = 595; // A4
const PAGE_H = 842;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const ESIGN_TAG_SPLIT_RE = /(\{\{@\w+\}\})/;
const ESIGN_TAG_TEST_RE = /\{\{@\w+\}\}/;

/** The largest the operator's signature is drawn, in points. */
export const SIGNATURE_MAX_W = 200;
export const SIGNATURE_MAX_H = 70;

interface PdfCtx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  boldFont: PDFFont;
  italicFont: PDFFont;
  boldItalicFont: PDFFont;
}

function newPage(ctx: PdfCtx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - MARGIN;
}

function ensureSpace(ctx: PdfCtx, needed: number) {
  if (ctx.y - needed < MARGIN) newPage(ctx);
}

function pickFont(ctx: PdfCtx, bold: boolean, italic: boolean): PDFFont {
  if (bold && italic) return ctx.boldItalicFont;
  if (bold) return ctx.boldFont;
  if (italic) return ctx.italicFont;
  return ctx.font;
}

/** Draw text, rendering e-sign tags in white (invisible but BoldSign-detectable) */
function drawText(ctx: PdfCtx, rawText: string, x: number, fontSize: number, useFont: PDFFont, underline: boolean = false) {
  const text = sanitizePdfLine(rawText);
  if (ESIGN_TAG_TEST_RE.test(text)) {
    const segments = text.split(ESIGN_TAG_SPLIT_RE);
    let xPos = x;
    for (const seg of segments) {
      if (!seg) continue;
      const isTag = /^\{\{@\w+\}\}$/.test(seg);
      ctx.page.drawText(seg, {
        x: xPos, y: ctx.y, size: fontSize, font: useFont,
        color: isTag ? rgb(1, 1, 1) : rgb(0, 0, 0),
      });
      const segW = useFont.widthOfTextAtSize(seg, fontSize);
      if (underline && !isTag) {
        ctx.page.drawLine({
          start: { x: xPos, y: ctx.y - 1.5 },
          end: { x: xPos + segW, y: ctx.y - 1.5 },
          thickness: 0.5, color: rgb(0, 0, 0),
        });
      }
      xPos += segW;
    }
  } else {
    ctx.page.drawText(text, { x, y: ctx.y, size: fontSize, font: useFont, color: rgb(0, 0, 0) });
    if (underline) {
      const textW = useFont.widthOfTextAtSize(text, fontSize);
      ctx.page.drawLine({
        start: { x, y: ctx.y - 1.5 },
        end: { x: x + textW, y: ctx.y - 1.5 },
        thickness: 0.5, color: rgb(0, 0, 0),
      });
    }
  }
}

/** Measure total width of runs */
function measureRunsWidth(ctx: PdfCtx, runs: TextRun[], fontSize: number, forceBold: boolean): number {
  let totalW = 0;
  for (const run of runs) {
    const f = pickFont(ctx, run.bold || forceBold, run.italic);
    const words = run.text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      totalW += f.widthOfTextAtSize(words[i], fontSize);
      if (i < words.length - 1) totalW += f.widthOfTextAtSize(' ', fontSize);
    }
  }
  return totalW;
}

/** Word-wrap and draw a sequence of text runs */
function drawWrappedRuns(ctx: PdfCtx, runs: TextRun[], fontSize: number, lineHeight: number, forceBold: boolean, indent: number = 0, align: TextAlign = 'left') {
  const maxW = CONTENT_W - indent;
  const startX = MARGIN + indent;
  let xPos = startX;

  if (align !== 'left') {
    const totalW = measureRunsWidth(ctx, runs, fontSize, forceBold);
    if (totalW <= maxW) {
      if (align === 'center') xPos = startX + (maxW - totalW) / 2;
      else if (align === 'right') xPos = startX + maxW - totalW;
    }
  }

  for (const run of runs) {
    const f = pickFont(ctx, run.bold || forceBold, run.italic);
    const words = run.text.split(/\s+/).filter(Boolean);

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const wordW = f.widthOfTextAtSize(word, fontSize);
      const spaceW = f.widthOfTextAtSize(' ', fontSize);

      if (xPos > startX && xPos + wordW > startX + maxW) {
        ctx.y -= lineHeight;
        ensureSpace(ctx, lineHeight);
        xPos = startX;
      }

      drawText(ctx, word, xPos, fontSize, f, run.underline);
      xPos += wordW + spaceW;
    }
  }

  ctx.y -= lineHeight;
}

/** The drawn size of an image of `width` × `height`, fitted into the signature box without upscaling. */
export function fitSignatureSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(SIGNATURE_MAX_W / width, SIGNATURE_MAX_H / height, 1);
  return { width: width * scale, height: height * scale };
}

async function renderBlocksToPdf(ctx: PdfCtx, blocks: PdfBlock[]) {
  const S = { h1: 16, h2: 13, h3: 11, body: 10 };
  const LH = { h1: 22, h2: 18, h3: 15, body: 14 };

  for (const block of blocks) {
    switch (block.type) {
      case 'h1': {
        ensureSpace(ctx, S.h1 + 16);
        ctx.y -= 14;
        drawWrappedRuns(ctx, block.runs || [], S.h1, LH.h1, true, 0, block.align || 'left');
        ctx.y -= 4;
        break;
      }
      case 'h2': {
        ensureSpace(ctx, S.h2 + 14);
        ctx.y -= 12;
        drawWrappedRuns(ctx, block.runs || [], S.h2, LH.h2, true, 0, block.align || 'left');
        ctx.page.drawLine({
          start: { x: MARGIN, y: ctx.y + 4 },
          end: { x: PAGE_W - MARGIN, y: ctx.y + 4 },
          thickness: 0.5, color: rgb(0.8, 0.8, 0.8),
        });
        ctx.y -= 6;
        break;
      }
      case 'h3': {
        ensureSpace(ctx, S.h3 + 10);
        ctx.y -= 8;
        drawWrappedRuns(ctx, block.runs || [], S.h3, LH.h3, true, 0, block.align || 'left');
        ctx.y -= 2;
        break;
      }
      case 'paragraph': {
        ensureSpace(ctx, LH.body);
        drawWrappedRuns(ctx, block.runs || [], S.body, LH.body, false, 0, block.align || 'left');
        ctx.y -= 2;
        break;
      }
      case 'image': {
        // The operator's signature (D9). A PNG or JPEG the parser has already
        // checked; pdf-lib still throws on bytes that are not a real image,
        // and that throw is left to fail the render, because a contract that
        // silently lost the company's signature is worse than one not sent.
        if (!block.image) break;
        // pdf-lib decodes a base64 string itself.
        const data = block.image.base64;
        const embedded = block.image.format === 'png' ? await ctx.doc.embedPng(data) : await ctx.doc.embedJpg(data);
        const size = fitSignatureSize(embedded.width, embedded.height);
        if (size.width <= 0 || size.height <= 0) break;
        ensureSpace(ctx, size.height + 8);
        ctx.y -= 4;
        const align = block.align || 'left';
        const x = align === 'center'
          ? MARGIN + (CONTENT_W - size.width) / 2
          : align === 'right' ? MARGIN + CONTENT_W - size.width : MARGIN;
        ctx.page.drawImage(embedded, { x, y: ctx.y - size.height, width: size.width, height: size.height });
        ctx.y -= size.height + 4;
        break;
      }
      case 'table': {
        const rows = block.rows || [];
        if (rows.length === 0) break;

        const colCount = Math.max(...rows.map(r => r.cells.length));
        if (colCount === 0) break;

        const colW = CONTENT_W / colCount;
        const cellPad = 6;
        const rowH = LH.body + cellPad * 2;

        ctx.y -= 6;

        for (const row of rows) {
          ensureSpace(ctx, rowH + 2);
          const topY = ctx.y;

          if (row.isHeader) {
            ctx.page.drawRectangle({
              x: MARGIN, y: topY - rowH,
              width: CONTENT_W, height: rowH,
              color: rgb(0.94, 0.94, 0.96),
            });
          }

          for (let c = 0; c < colCount; c++) {
            const cellX = MARGIN + c * colW;
            const cellText = c < row.cells.length ? row.cells[c] : '';
            const cellFont = row.isHeader ? ctx.boldFont : ctx.font;

            ctx.page.drawRectangle({
              x: cellX, y: topY - rowH,
              width: colW, height: rowH,
              borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5,
            });

            if (cellText) {
              let display = sanitizePdfLine(cellText);
              const maxTextW = colW - cellPad * 2;
              while (cellFont.widthOfTextAtSize(display, S.body) > maxTextW && display.length > 1) {
                display = display.slice(0, -1);
              }
              const textY = topY - cellPad - S.body + 2;
              if (ESIGN_TAG_TEST_RE.test(display)) {
                const segs = display.split(ESIGN_TAG_SPLIT_RE);
                let xPos = cellX + cellPad;
                for (const seg of segs) {
                  if (!seg) continue;
                  const isTag = /^\{\{@\w+\}\}$/.test(seg);
                  ctx.page.drawText(seg, {
                    x: xPos, y: textY, size: S.body, font: cellFont,
                    color: isTag ? rgb(1, 1, 1) : rgb(0, 0, 0),
                  });
                  xPos += cellFont.widthOfTextAtSize(seg, S.body);
                }
              } else {
                ctx.page.drawText(display, {
                  x: cellX + cellPad, y: textY,
                  size: S.body, font: cellFont, color: rgb(0, 0, 0),
                });
              }
            }
          }

          ctx.y = topY - rowH;
        }
        ctx.y -= 6;
        break;
      }
      case 'bullet-list':
      case 'ordered-list': {
        const items = block.items || [];
        ctx.y -= 2;
        items.forEach((item, i) => {
          ensureSpace(ctx, LH.body);
          const bullet = block.type === 'bullet-list' ? '•' : `${i + 1}.`;
          const bulletW = ctx.font.widthOfTextAtSize(bullet + '  ', S.body);
          ctx.page.drawText(bullet, {
            x: MARGIN + 8, y: ctx.y, size: S.body, font: ctx.font, color: rgb(0, 0, 0),
          });
          const itemRuns = Array.isArray(item) ? item as TextRun[] : [{ text: String(item), bold: false, italic: false, underline: false }];
          drawWrappedRuns(ctx, itemRuns, S.body, LH.body, false, 8 + bulletW);
        });
        ctx.y -= 4;
        break;
      }
      case 'hr': {
        ensureSpace(ctx, 20);
        ctx.y -= 8;
        ctx.page.drawLine({
          start: { x: MARGIN, y: ctx.y },
          end: { x: PAGE_W - MARGIN, y: ctx.y },
          thickness: 0.5, color: rgb(0.7, 0.7, 0.7),
        });
        ctx.y -= 8;
        break;
      }
    }
  }
}

// ============================================================================
// PLATFORM DISCLAIMER (appended to every agreement, as route.ts does)
// ============================================================================

export const PLATFORM_DISCLAIMER_BLOCKS: PdfBlock[] = [
  { type: 'hr' },
  { type: 'paragraph', runs: [{ text: 'Platform Disclaimer', bold: true, italic: false, underline: false }] },
  {
    type: 'paragraph',
    runs: [{
      text: 'The parties acknowledge that Drive247 is a software platform operated by Cortek Systems Ltd, which provides technology services solely to facilitate booking, documentation, and administrative processes for vehicle rental companies. Drive247 and Cortek Systems Ltd are not a party to this Rental Agreement and do not own, lease, manage, insure, or control any vehicles listed on the platform.',
      bold: false, italic: false, underline: false,
    }],
  },
  {
    type: 'paragraph',
    runs: [{
      text: 'All contractual obligations, responsibilities, and liabilities relating to the rental transaction, including vehicle condition, insurance coverage, payment collection, disputes, and claims, exist solely between the Rental Company and the Renter. Drive247 and Cortek Systems Ltd shall have no liability for any losses, damages, claims, disputes, or obligations arising from or relating to this rental transaction.',
      bold: false, italic: false, underline: false,
    }],
  },
];

// ============================================================================
// ENTRY POINT
// ============================================================================

/** The banner's words: the title, uppercased, cut to fit the box on one line. */
export function bannerLabel(title: string, measure: (text: string) => number, maxWidth: number): string {
  const full = sanitizePdfLine((title || '').toUpperCase()) || 'AGREEMENT';
  if (measure(full) <= maxWidth) return full;
  let cut = full;
  while (cut.length > 1 && measure(`${cut}…`) > maxWidth) cut = cut.slice(0, -1).trimEnd();
  return `${cut}…`;
}

/**
 * Render an individual agreement's FINAL html (already substituted, with
 * `{{@sig1}}` ensured) to PDF bytes: the title banner, the document, then the
 * platform disclaimer, exactly as the rental path lays out its own.
 */
export async function renderAgreementPdf(html: string, opts: { title: string }): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const boldItalicFont = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);
  const ctx: PdfCtx = { doc: pdfDoc, page: pdfDoc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN, font, boldFont, italicFont, boldItalicFont };

  // The banner, in route.ts's exact style, carrying the document's title.
  const bannerHeight = 32;
  const bannerY = ctx.y - bannerHeight;
  ctx.page.drawRectangle({
    x: MARGIN,
    y: bannerY,
    width: CONTENT_W,
    height: bannerHeight,
    color: rgb(0.93, 0.94, 0.98), // light indigo bg
    borderColor: rgb(0.39, 0.4, 0.95), // indigo border
    borderWidth: 1,
  });
  const labelFontSize = 11;
  const label = bannerLabel(opts.title, (t) => ctx.boldFont.widthOfTextAtSize(t, labelFontSize), CONTENT_W - 24);
  const labelWidth = ctx.boldFont.widthOfTextAtSize(label, labelFontSize);
  ctx.page.drawText(label, {
    x: MARGIN + (CONTENT_W - labelWidth) / 2,
    y: bannerY + (bannerHeight - labelFontSize) / 2 + 1,
    size: labelFontSize,
    font: ctx.boldFont,
    color: rgb(0.24, 0.25, 0.59), // dark indigo text
  });
  ctx.y = bannerY - 16;

  const blocks = parseHtmlToBlocks(html);
  blocks.push(...PLATFORM_DISCLAIMER_BLOCKS);
  await renderBlocksToPdf(ctx, blocks);

  return pdfDoc.save();
}

/**
 * Bytes to base64 without Node's Buffer: `String.fromCharCode` over 32 kB
 * chunks (one call per chunk stays well under every engine's argument limit),
 * then `btoa`.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

/**
 * The PDF an individual agreement is sent as, base64-encoded for the edge
 * function's JSON body. `html` is the FINAL html (substituted, `{{@sig1}}`
 * ensured); `banner` is the document's title.
 */
export async function renderAgreementPdfBase64(html: string, opts: { banner: string }): Promise<string> {
  return bytesToBase64(await renderAgreementPdf(html, { title: opts.banner }));
}
