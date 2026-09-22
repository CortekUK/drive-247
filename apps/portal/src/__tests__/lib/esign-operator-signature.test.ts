/**
 * /api/esign, additive change 2 (build-spec D9, D14): the PDF renderer learns
 * to draw ONE image, the operator's own signature, and nothing else changes.
 *
 * The parser and renderer are the SHIPPED functions, lifted out of route.ts
 * and compiled (helpers/edge-source.ts). "Nothing else changes" is proved
 * against HEAD's parser, lifted the same way from commit 5a664cbb and kept in
 * esign-operator-signature.head-parser.txt: every document without an
 * operator signature must parse to exactly the blocks it parsed to before.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { codeOnly, compileExpression, liftDeclaration, readPortalSource } from "../helpers/edge-source";
import { decodeHtmlEntities } from "@/lib/html-entities";
import {
  DEFAULT_AGREEMENT_TEMPLATE,
  DEFAULT_INSTALLMENT_AGREEMENT_TEMPLATE,
  EXTENSION_AGREEMENT_TEMPLATE,
  PAYG_AGREEMENT_TEMPLATE,
} from "@/lib/default-agreement-template";
import { injectAgreementClauses } from "@/lib/agreement-injection";
import { BONZAH_INSURANCE_ADDENDUM_HTML } from "@/lib/bonzah-addendum";

const ROUTE = readPortalSource("app/api/esign/route.ts");
const HEAD_PARSER = readFileSync(resolve(__dirname, "esign-operator-signature.head-parser.txt"), "utf8");

const PARSER_DEPS = [
  "WINANSI_REPLACEMENTS",
  "WINANSI_HIGH",
  "sanitizePdfText",
  "decodeEntities",
  "stripTags",
  "parseInlineRuns",
  "extractAlign",
  "parseTableRows",
  "parseListItems",
  "removeEmptyFields",
];

type Block = { type: string; image?: { format: string; base64: string }; [k: string]: unknown };
type Parse = (html: string) => Block[];

const lift = (source: string, names: string[]) => names.map((n) => liftDeclaration(source, n));

const parseNow = compileExpression<(d: typeof decodeHtmlEntities) => Parse>(
  ["decodeHtmlEntities"],
  lift(ROUTE, [...PARSER_DEPS, "OPERATOR_SIGNATURE_MAX_SRC", "parseOperatorSignatureImg", "parseHtmlToBlocks"]),
  "parseHtmlToBlocks"
)(decodeHtmlEntities);

const parseHead = compileExpression<(d: typeof decodeHtmlEntities) => Parse>(
  ["decodeHtmlEntities"],
  lift(HEAD_PARSER, [...PARSER_DEPS, "parseHtmlToBlocks"]),
  "parseHtmlToBlocks"
)(decodeHtmlEntities);

/* ── a real PNG and a JPEG header, built here rather than checked in ─────── */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** A grey `w` x `h` PNG, base64. */
function png(w: number, h: number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const rows = Buffer.alloc((w + 1) * h, 0x80);
  for (let y = 0; y < h; y++) rows[y * (w + 1)] = 0; // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
/** SOI + a baseline SOF0 frame header: all pdf-lib reads to embed a JPEG. */
function jpeg(w: number, h: number): string {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]).toString("base64");
}

const sigImg = (format: "png" | "jpeg", base64: string, extra = "") =>
  `<img data-operator-signature="true" src="data:image/${format};base64,${base64}" alt="Signature"${extra}>`;

/* ── documents WITHOUT an operator signature: must parse exactly as HEAD ── */

const allClauses = (t: string) =>
  injectAgreementClauses(t, {
    hasMileage: true,
    hasTerms: true,
    hasBonzahAddendum: true,
    hasDepositClause: true,
    hasHandoverTimes: true,
  });

const IMAGE_FREE: Record<string, string> = {
  "default template": DEFAULT_AGREEMENT_TEMPLATE,
  "payg template": PAYG_AGREEMENT_TEMPLATE,
  "extension template": EXTENSION_AGREEMENT_TEMPLATE,
  "installment template": DEFAULT_INSTALLMENT_AGREEMENT_TEMPLATE,
  "default template with every clause injected": allClauses(DEFAULT_AGREEMENT_TEMPLATE),
  "the Bonzah addendum": BONZAH_INSURANCE_ADDENDUM_HTML,
  "headings, alignment, marks and signer tags":
    '<h1 style="text-align: center">Agreement</h1><h2>Parties</h2><h3>Renter</h3>' +
    '<p style="text-align: right"><strong>Bold <em>both</em></strong> <u>under</u> &amp; &rsquo;quoted&rsquo;</p>' +
    "<p>Signature: {{@sig1}} Initials: {{@init1}} Date: {{@date1}}</p><hr><p></p>",
  "tables and lists": "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr><tr><td>Empty</td><td></td></tr></table><ul><li>one</li><li><strong>two</strong></li></ul><ol><li>first</li></ol>",
  "raw text between blocks": "Loose text\n<p>then a paragraph</p>\nmore loose <b>text</b>",
  "a remote image between blocks": '<p>Before</p><img src="https://example.com/logo.png"><p>After</p>',
  "an image without the attribute": `<p>Before</p><img src="data:image/png;base64,${png(4, 4)}"><p>After</p>`,
  "the attribute set to false": `<p>Before</p><img data-operator-signature="false" src="data:image/png;base64,${png(4, 4)}"><p>After</p>`,
  "the attribute on a remote image": '<p>Before</p><img data-operator-signature="true" src="https://example.com/sig.png"><p>After</p>',
  "the attribute on an SVG": '<p>Before</p><img data-operator-signature="true" src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="><p>After</p>',
  "an operator signature inside a paragraph": `<p>Signed: ${sigImg("png", png(4, 4))} by us</p>`,
  "an operator signature inside a table cell": `<table><tr><td>Company</td><td>${sigImg("png", png(4, 4))}</td></tr></table>`,
  "an oversized operator signature": `<p>Before</p>${sigImg("png", "A".repeat(520_000))}<p>After</p>`,
};

describe("parseHtmlToBlocks: nothing changes without an operator signature", () => {
  it.each(Object.entries(IMAGE_FREE))("%s parses to exactly HEAD's blocks", (_label, html) => {
    const now = parseNow(html);
    expect(now).toEqual(parseHead(html));
    expect(now.some((b) => b.type === "image")).toBe(false);
  });

  it("the fixtures are not trivially empty", () => {
    expect(parseHead(DEFAULT_AGREEMENT_TEMPLATE).length).toBeGreaterThan(20);
    expect(parseHead(IMAGE_FREE["tables and lists"]).map((b) => b.type)).toEqual(["table", "bullet-list", "ordered-list"]);
  });
});

describe("parseHtmlToBlocks: the operator signature becomes an image block", () => {
  it("a PNG signature between blocks is an image block, in document order", () => {
    const base64 = png(12, 4);
    const html = `<h3>FOR THE COMPANY</h3><p><strong>Company:</strong> Northwind</p>${sigImg("png", base64)}<p><strong>Date:</strong> 21 Sep 2026</p>`;
    const blocks = parseNow(html);
    expect(blocks.map((b) => b.type)).toEqual(["h3", "paragraph", "image", "paragraph"]);
    expect(blocks[2]).toEqual({ type: "image", image: { format: "png", base64 } });
    // Everything around it is what HEAD made of the same document.
    expect(blocks.filter((b) => b.type !== "image")).toEqual(parseHead(html));
  });

  it("a JPEG signature, attributes in any order, is an image block", () => {
    const base64 = jpeg(40, 20);
    const html = `<p>a</p><img alt="Signature" src="data:image/jpeg;base64,${base64}" data-operator-signature="true" /><p>b</p>`;
    const image = parseNow(html).find((b) => b.type === "image");
    expect(image).toEqual({ type: "image", image: { format: "jpeg", base64 } });
  });

  it("the text tags beside it are left exactly as they were", () => {
    const html = `${sigImg("png", png(4, 4))}<p>Customer: {{@sig1}} {{@date1}}</p>`;
    const text = parseNow(html)
      .flatMap((b) => ((b.runs as { text: string }[]) ?? []).map((r) => r.text))
      .join(" ");
    expect(text).toContain("{{@sig1}}");
    expect(text).toContain("{{@date1}}");
  });
});

/* ── the renderer ───────────────────────────────────────────────────────── */

const RENDER_DEPS = [
  "WINANSI_REPLACEMENTS",
  "WINANSI_HIGH",
  "sanitizePdfText",
  "sanitizePdfLine",
  "PAGE_W",
  "PAGE_H",
  "MARGIN",
  "CONTENT_W",
  "ESIGN_TAG_SPLIT_RE",
  "ESIGN_TAG_TEST_RE",
  "newPage",
  "ensureSpace",
  "pickFont",
  "drawText",
  "measureRunsWidth",
  "drawWrappedRuns",
  "renderBlocksToPdf",
];
const render = compileExpression<(r: typeof rgb) => (ctx: unknown, blocks: Block[]) => Promise<void>>(
  ["rgb"],
  lift(ROUTE, RENDER_DEPS),
  "renderBlocksToPdf"
)(rgb);

async function makeCtx(y = 842 - 50) {
  const doc = await PDFDocument.create();
  const ctx = {
    doc,
    page: doc.addPage([595, 842]),
    y,
    font: await doc.embedFont(StandardFonts.Helvetica),
    boldFont: await doc.embedFont(StandardFonts.HelveticaBold),
    italicFont: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalicFont: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  return ctx;
}

describe("renderBlocksToPdf draws the operator signature", () => {
  it.each([
    ["a wide PNG, bound by both limits", "png", 600, 210, 200, 70],
    ["a very wide PNG, bound by the width", "png", 800, 100, 200, 25],
    ["a tall PNG, bound by the height", "png", 100, 140, 50, 70],
    ["a small PNG, never enlarged", "png", 50, 20, 50, 20],
    ["a JPEG", "jpeg", 400, 100, 200, 50],
  ] as const)("%s: at most 200 x 70pt, aspect kept", async (_l, format, w, h, ew, eh) => {
    const ctx = await makeCtx();
    const draw = vi.spyOn(ctx.page, "drawImage");
    const startY = ctx.y;
    await render(ctx, [{ type: "image", image: { format, base64: format === "png" ? png(w, h) : jpeg(w, h) } }]);

    expect(draw).toHaveBeenCalledTimes(1);
    const opts = draw.mock.calls[0][1] as { x: number; y: number; width: number; height: number };
    expect(opts.width).toBeCloseTo(ew, 5);
    expect(opts.height).toBeCloseTo(eh, 5);
    expect(opts.x).toBe(50);
    // The next block starts below the image.
    expect(ctx.y).toBeCloseTo(startY - eh - 4, 5);

    const bytes = Buffer.from(await ctx.doc.save()).toString("latin1");
    expect(bytes).toContain("/Subtype /Image");
  });

  it("an image that does not fit goes to a new page (ensureSpace)", async () => {
    const ctx = await makeCtx(60);
    const first = ctx.page;
    await render(ctx, [{ type: "image", image: { format: "png", base64: png(600, 210) } }]);
    expect(ctx.doc.getPageCount()).toBe(2);
    expect(ctx.page).not.toBe(first);
    expect(ctx.y).toBeCloseTo(842 - 50 - 74, 5);
  });

  it("an image pdf-lib cannot decode is left out; the document still renders", async () => {
    const ctx = await makeCtx();
    const draw = vi.spyOn(ctx.page, "drawImage");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await render(ctx, [
      { type: "paragraph", runs: [{ text: "Before", bold: false, italic: false, underline: false }] },
      { type: "image", image: { format: "png", base64: "bm90IGEgcG5n" } },
      { type: "paragraph", runs: [{ text: "After", bold: false, italic: false, underline: false }] },
    ]);
    expect(draw).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    await expect(ctx.doc.save()).resolves.toBeInstanceOf(Uint8Array);
    warn.mockRestore();
  });

  it("a document without an image renders as before (no image drawn)", async () => {
    const ctx = await makeCtx();
    const draw = vi.spyOn(ctx.page, "drawImage");
    await render(ctx, parseNow(DEFAULT_AGREEMENT_TEMPLATE));
    expect(draw).not.toHaveBeenCalled();
  });
});

describe("the send path awaits the renderer before saving the PDF", () => {
  it("renderBlocksToPdf is awaited, and the PDF is saved after it", () => {
    // It is async now (pdf-lib embeds images asynchronously). Un-awaited, the
    // PDF would be saved before the signature was drawn into it.
    const src = codeOnly(ROUTE);
    const call = src.indexOf("await renderBlocksToPdf(ctx, blocks);");
    const save = src.indexOf("const pdfBytes = await pdfDoc.save();");
    expect(call).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(call);
    expect(src.match(/renderBlocksToPdf\(/g)?.length).toBe(2); // the declaration and the one call
  });
});
