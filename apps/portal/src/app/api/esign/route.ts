import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from 'pdf-lib';

// BoldSign configuration — resolved per-request based on tenant mode
const BOLDSIGN_BASE_URL = process.env.BOLDSIGN_BASE_URL || 'https://api.boldsign.com';

function getBoldSignApiKey(mode: 'test' | 'live'): string {
    return mode === 'live'
        ? (process.env.BOLDSIGN_LIVE_API_KEY || process.env.BOLDSIGN_API_KEY || '')
        : (process.env.BOLDSIGN_TEST_API_KEY || process.env.BOLDSIGN_API_KEY || '');
}

// Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

interface ESignRequest {
    rentalId: string;
    customerEmail: string;
    customerName: string;
    tenantId: string;
    agreementType?: 'original' | 'extension';
    extensionPreviousEndDate?: string;
    extensionNewEndDate?: string;
    extensionNumber?: number;
}

// ============================================================================
// FORMAT HELPERS
// ============================================================================

function formatDate(date: string | Date | null): string {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatCurrency(amount: number | null, currencyCode: string = 'USD'): string {
    const value = amount ?? 0;
    const code = currencyCode?.toUpperCase() || 'USD';
    const localeMap: Record<string, string> = { USD: 'en-US', GBP: 'en-GB', EUR: 'en-IE' };
    const locale = localeMap[code] || 'en-US';
    try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(value);
    } catch {
        return `${code} ${value.toFixed(2)}`;
    }
}

// ============================================================================
// TEMPLATE PROCESSING
// ============================================================================

interface InstallmentData {
    plan_type: string;
    total_installable_amount: number;
    number_of_installments: number;
    installment_amount: number;
    upfront_amount: number;
    status: string;
    scheduled_installments: Array<{
        installment_number: number;
        amount: number;
        due_date: string;
        status: string;
    }>;
}

function buildInstallmentScheduleHtml(installment: InstallmentData, currencyCode: string): string {
    const rows = installment.scheduled_installments
        .sort((a, b) => a.installment_number - b.installment_number)
        .map(si => `<tr><td>Payment ${si.installment_number}</td><td>${formatCurrency(si.amount, currencyCode)}</td><td>${formatDate(si.due_date)}</td></tr>`)
        .join('');

    return `<h2>Payment Schedule</h2>
<p>This rental is set up with an installment payment plan. <strong>You will NOT be charged the full amount upfront.</strong></p>
<table>
<tr><td><strong>Plan Type</strong></td><td>${installment.plan_type.charAt(0).toUpperCase() + installment.plan_type.slice(1)}</td></tr>
<tr><td><strong>Total Rental Amount</strong></td><td>${formatCurrency(installment.total_installable_amount, currencyCode)}</td></tr>
<tr><td><strong>Upfront Amount</strong></td><td>${formatCurrency(installment.upfront_amount, currencyCode)}</td></tr>
<tr><td><strong>Number of Installments</strong></td><td>${installment.number_of_installments}</td></tr>
<tr><td><strong>Per Installment</strong></td><td>${formatCurrency(installment.installment_amount, currencyCode)}</td></tr>
</table>
<h3>Scheduled Payments</h3>
<table>
<tr><th>Payment</th><th>Amount</th><th>Due Date</th></tr>
${rows}
</table>`;
}

function processTemplate(template: string, rental: any, customer: any, vehicle: any, tenant: any, currencyCode: string = 'USD', verification?: any, extensionData?: { previousEndDate?: string; newEndDate?: string; extensionNumber?: number }, installment?: InstallmentData | null): string {
    // Compose full address from separate fields (DB stores street/city/state/zip separately)
    const customerAddress = [
        customer?.address_street,
        customer?.address_city,
        customer?.address_state,
        customer?.address_zip,
    ].filter(Boolean).join(', ') || customer?.address || verification?.address || '';

    // Resolve identity fields: customer table first, then fall back to identity_verifications
    const dob = customer?.date_of_birth || verification?.date_of_birth || '';
    const documentNumber = customer?.license_number || verification?.document_number || '';
    const documentExpiry = verification?.document_expiry_date || '';
    const documentType = verification?.document_type || '';

    const variables: Record<string, string> = {
        // Customer — basic
        customer_name: customer?.name || '',
        customer_email: customer?.email || '',
        customer_phone: customer?.phone || '',
        customer_type: customer?.customer_type || customer?.type || '',
        customer_address: customerAddress,
        customer_address_street: customer?.address_street || '',
        customer_address_city: customer?.address_city || '',
        customer_address_state: customer?.address_state || '',
        customer_address_zip: customer?.address_zip || '',

        // Customer — identity & license (with verification fallback)
        customer_id_number: customer?.id_number || documentNumber,
        customer_license_number: documentNumber,
        customer_license_state: customer?.license_state || '',
        customer_license_expiry: documentExpiry ? formatDate(documentExpiry) : '',
        customer_document_type: documentType === 'drivers_license' ? "Driver's License" : documentType === 'passport' ? 'Passport' : documentType === 'id_card' ? 'ID Card' : '',
        customer_date_of_birth: dob ? formatDate(dob) : '',
        customer_dob: dob ? formatDate(dob) : '',

        // Customer — next of kin
        nok_name: customer?.nok_full_name || '',
        nok_phone: customer?.nok_phone || '',
        nok_email: customer?.nok_email || '',
        nok_address: customer?.nok_address || '',
        nok_relationship: customer?.nok_relationship || '',

        // Vehicle
        vehicle_make: vehicle?.make || '',
        vehicle_model: vehicle?.model || '',
        vehicle_year: vehicle?.year?.toString() || '',
        vehicle_reg: vehicle?.reg || '',
        vehicle_color: vehicle?.color || vehicle?.colour || '',
        vehicle_vin: vehicle?.vin || 'Not Added',
        vehicle_fuel_type: vehicle?.fuel_type || '',
        vehicle_description: vehicle?.description || '',
        vehicle_daily_rent: formatCurrency(vehicle?.daily_rent, currencyCode),
        vehicle_weekly_rent: formatCurrency(vehicle?.weekly_rent, currencyCode),
        vehicle_monthly_rent: formatCurrency(vehicle?.monthly_rent, currencyCode),
        vehicle_mileage: vehicle?.current_mileage?.toString() || '',
        vehicle_daily_mileage: vehicle?.daily_mileage?.toString() || '',
        vehicle_weekly_mileage: vehicle?.weekly_mileage?.toString() || '',
        vehicle_monthly_mileage: vehicle?.monthly_mileage?.toString() || '',
        vehicle_allowed_mileage: (() => {
            if (!vehicle?.daily_mileage && !vehicle?.weekly_mileage && !vehicle?.monthly_mileage) return 'Unlimited';
            if (rental?.start_date && rental?.end_date) {
                const days = Math.max(1, Math.ceil((new Date(rental.end_date).getTime() - new Date(rental.start_date).getTime()) / (1000 * 60 * 60 * 24)));
                const _mtd = (tenant as any)?.monthly_tier_days ?? 30;
                let tier: 'daily' | 'weekly' | 'monthly' = days >= _mtd ? 'monthly' : days >= 7 ? 'weekly' : 'daily';
                const perUnit = tier === 'daily' ? vehicle.daily_mileage : tier === 'weekly' ? vehicle.weekly_mileage : vehicle.monthly_mileage;
                if (perUnit == null) return 'Unlimited';
                const total = tier === 'daily' ? days * perUnit : tier === 'weekly' ? Math.ceil(days / 7) * perUnit : Math.ceil(days / _mtd) * perUnit;
                return total.toString();
            }
            return vehicle?.monthly_mileage?.toString() || '';
        })(),

        // Rental — for extensions, show extension period dates instead of original
        rental_number: rental?.rental_number || rental?.id?.substring(0, 8)?.toUpperCase() || '',
        rental_id: rental?.id || '',
        rental_start_date: extensionData?.previousEndDate
            ? formatDate(extensionData.previousEndDate)
            : formatDate(rental?.start_date),
        rental_end_date: extensionData?.newEndDate
            ? formatDate(extensionData.newEndDate)
            : (rental?.end_date ? formatDate(rental.end_date) : 'Ongoing'),
        rental_days: (() => {
            const start = extensionData?.previousEndDate || rental?.start_date;
            const end = extensionData?.newEndDate || rental?.end_date;
            if (start && end) {
                const diff = Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24));
                return diff > 0 ? diff.toString() : '1';
            }
            return '';
        })(),
        monthly_amount: formatCurrency(rental?.discount_applied ? (rental.monthly_amount - rental.discount_applied) : rental?.monthly_amount, currencyCode),
        rental_amount: formatCurrency(rental?.discount_applied ? (rental.monthly_amount - rental.discount_applied) : rental?.monthly_amount, currencyCode),
        rental_price: (() => {
            const type = rental?.rental_period_type || 'Monthly';
            const rate = type === 'Daily' ? vehicle?.daily_rent : type === 'Weekly' ? vehicle?.weekly_rent : vehicle?.monthly_rent;
            // Apply discount if present
            if (rental?.discount_applied && rate) {
                return formatCurrency(rate - rental.discount_applied, currencyCode);
            }
            return formatCurrency(rate, currencyCode);
        })(),
        discount_amount: rental?.discount_applied ? formatCurrency(rental.discount_applied, currencyCode) : '',
        rental_period_type: rental?.rental_period_type || 'Monthly',
        rental_status: rental?.status || '',
        pickup_location: rental?.pickup_location || '',
        return_location: rental?.return_location || '',
        delivery_address: rental?.delivery_address || '',
        pickup_time: rental?.pickup_time || '',
        return_time: rental?.return_time || '',
        promo_code: rental?.promo_code || '',

        // Company / Tenant
        company_name: tenant?.company_name || 'Drive 247',
        company_email: tenant?.contact_email || '',
        company_phone: tenant?.contact_phone || tenant?.phone || '',
        company_address: tenant?.address || '',
        admin_name: tenant?.admin_name || '',
        admin_email: tenant?.admin_email || '',

        // Dates
        agreement_date: formatDate(new Date()),
        today_date: formatDate(new Date()),
        current_date: formatDate(new Date()),

        // Extension (empty if not an extension agreement — non-breaking)
        extension_previous_end_date: extensionData?.previousEndDate ? formatDate(extensionData.previousEndDate) : '',
        extension_new_end_date: extensionData?.newEndDate ? formatDate(extensionData.newEndDate) : '',
        extension_days: (() => {
            if (extensionData?.previousEndDate && extensionData?.newEndDate) {
                const diff = Math.ceil((new Date(extensionData.newEndDate).getTime() - new Date(extensionData.previousEndDate).getTime()) / (1000 * 60 * 60 * 24));
                return diff > 0 ? diff.toString() : '';
            }
            return '';
        })(),
        extension_number: extensionData?.extensionNumber ? extensionData.extensionNumber.toString() : '',

        // Installment payment schedule
        installment_schedule: installment ? buildInstallmentScheduleHtml(installment, currencyCode) : '',
        has_installments: installment ? 'true' : 'false',
        installment_plan_type: installment ? installment.plan_type.charAt(0).toUpperCase() + installment.plan_type.slice(1) : '',
        installment_total_amount: installment ? formatCurrency(installment.total_installable_amount, currencyCode) : '',
        installment_upfront_amount: installment ? formatCurrency(installment.upfront_amount, currencyCode) : '',
        installment_count: installment ? installment.number_of_installments.toString() : '',
        installment_per_payment: installment ? formatCurrency(installment.installment_amount, currencyCode) : '',
    };

    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), value);
    }
    // Unwrap block-level elements that ended up inside <p> tags from variable substitution
    // e.g. <p><h2>...</h2><table>...</table></p> → <h2>...</h2><table>...</table>
    result = result.replace(/<p>\s*(<(?:h[1-6]|table|div|ul|ol|hr)[^>]*>[\s\S]*?)\s*<\/p>/gi, '$1');
    return result;
}

function removeEmptyFields(html: string): string {
    return html
        .replace(/<tr>\s*<td>.*?<\/td>\s*<td>\s*<\/td>\s*<\/tr>/gi, '')
        .replace(/<p>\s*<strong>[^<]*:<\/strong>\s*<\/p>/gi, '')
        .replace(/<p>\s*<strong>[^<]*:<\/strong>(\s|&nbsp;)*<\/p>/gi, '')
        .replace(/<p>\s*<\/p>/gi, '')
        .replace(/<tr>\s*<td>.*?<\/td>\s*<td>\s+<\/td>\s*<\/tr>/gi, '');
}

// ============================================================================
// HTML → STRUCTURED BLOCKS PARSER
// ============================================================================

interface TextRun { text: string; bold: boolean; italic: boolean; underline: boolean; }
interface TableRow { cells: string[]; isHeader: boolean; }
type TextAlign = 'left' | 'center' | 'right';
interface PdfBlock {
    type: 'h1' | 'h2' | 'h3' | 'paragraph' | 'table' | 'bullet-list' | 'ordered-list' | 'hr';
    runs?: TextRun[];
    rows?: TableRow[];
    items?: TextRun[][];
    align?: TextAlign;
}

function decodeEntities(str: string): string {
    return str
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&middot;/gi, '\u00b7');
}

function stripTags(html: string): string {
    return decodeEntities(html.replace(/<[^>]+>/g, '')).trim();
}

function parseInlineRuns(html: string, parentBold = false, parentItalic = false, parentUnderline = false): TextRun[] {
    const runs: TextRun[] = [];
    let remaining = html;

    // Match the first inline formatting tag
    const tagRe = /<(strong|b|em|i|u)((?:\s+[^>]*)?)>([\s\S]*?)<\/\1>/i;

    while (remaining.length > 0) {
        const match = remaining.match(tagRe);
        if (match && match.index !== undefined) {
            // Text before the tag
            if (match.index > 0) {
                const text = stripTags(remaining.substring(0, match.index));
                if (text) runs.push({ text, bold: parentBold, italic: parentItalic, underline: parentUnderline });
            }
            const tagName = match[1].toLowerCase();
            const innerHtml = match[3];
            const isBold = parentBold || tagName === 'strong' || tagName === 'b';
            const isItalic = parentItalic || tagName === 'em' || tagName === 'i';
            const isUnderline = parentUnderline || tagName === 'u';
            // Recurse for nested tags
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

function parseHtmlToBlocks(html: string): PdfBlock[] {
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
            }
        } else {
            // Raw text outside any block tag
            const text = stripTags(part);
            if (text) {
                blocks.push({ type: 'paragraph', runs: [{ text, bold: false, italic: false, underline: false }] });
            }
        }
    }

    return blocks;
}

// ============================================================================
// STRUCTURED PDF RENDERER
// ============================================================================

const PAGE_W = 595;  // A4
const PAGE_H = 842;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const ESIGN_TAG_SPLIT_RE = /(\{\{@\w+\}\})/;
const ESIGN_TAG_TEST_RE = /\{\{@\w+\}\}/;

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
function drawText(ctx: PdfCtx, text: string, x: number, fontSize: number, useFont: PDFFont, underline: boolean = false) {
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

    // For center/right alignment on single-line content, calculate offset
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

            // Wrap to next line if needed
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

function renderBlocksToPdf(ctx: PdfCtx, blocks: PdfBlock[]) {
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
                            let display = cellText;
                            const maxTextW = colW - cellPad * 2;
                            while (cellFont.widthOfTextAtSize(display, S.body) > maxTextW && display.length > 1) {
                                display = display.slice(0, -1);
                            }
                            const textY = topY - cellPad - S.body + 2;
                            // Draw directly on page at exact position (not using ctx.y)
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
                    const bullet = block.type === 'bullet-list' ? '\u2022' : `${i + 1}.`;
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
// PLAIN TEXT → PDF (for default template fallback)
// ============================================================================

function renderTextToPdf(ctx: PdfCtx, text: string) {
    const fontSize = 10;
    const lineHeight = 14;
    const maxWidth = CONTENT_W;

    const lines = text.split('\n');
    for (const line of lines) {
        const words = line.split(' ');
        let currentLine = '';
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const width = ctx.font.widthOfTextAtSize(testLine, fontSize);
            if (width > maxWidth && currentLine) {
                ensureSpace(ctx, lineHeight);
                const isHeader = currentLine.startsWith('=') || (currentLine === currentLine.toUpperCase() && currentLine.length > 3 && !currentLine.startsWith('{{'));
                drawText(ctx, currentLine, MARGIN, fontSize, isHeader ? ctx.boldFont : ctx.font);
                ctx.y -= lineHeight;
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        ensureSpace(ctx, lineHeight);
        if (currentLine) {
            const isHeader = currentLine.startsWith('=') || (currentLine === currentLine.toUpperCase() && currentLine.length > 3 && !currentLine.startsWith('{{'));
            drawText(ctx, currentLine, MARGIN, fontSize, isHeader ? ctx.boldFont : ctx.font);
        }
        ctx.y -= lineHeight;
    }
}

// ============================================================================
// DEFAULT TEXT TEMPLATE (when tenant has no custom template)
// ============================================================================

function generateDefaultAgreement(rental: any, customer: any, vehicle: any, tenant: any, currencyCode: string = 'USD', extensionData?: { previousEndDate?: string; newEndDate?: string; extensionNumber?: number }): string {
    const companyName = tenant?.company_name || 'Drive 247';
    const line = (label: string, value: string | null | undefined) => value ? `${label}: ${value}` : '';
    const lines = (...parts: string[]) => parts.filter(Boolean).join('\n');

    const isExtension = !!extensionData?.extensionNumber;
    const agreementTitle = isExtension
        ? `RENTAL EXTENSION AGREEMENT - Extension #${extensionData!.extensionNumber}`
        : 'RENTAL AGREEMENT';

    return `
${agreementTitle}
${'='.repeat(70)}

Date: ${formatDate(new Date())}
${isExtension ? `Agreement Type: Extension #${extensionData!.extensionNumber}` : 'Agreement Type: Original Rental Agreement'}
Reference: ${rental?.id?.substring(0, 8)?.toUpperCase() || 'N/A'}

${'='.repeat(70)}

LANDLORD: ${companyName}
${lines(tenant?.contact_email, tenant?.contact_phone)}

${'='.repeat(70)}

CUSTOMER:
${lines(
    line('Name', customer?.name),
    line('Email', customer?.email),
    line('Phone', customer?.phone)
)}

${'='.repeat(70)}

VEHICLE:
${lines(
    line('Registration', vehicle?.reg),
    (vehicle?.make || vehicle?.model) ? `Make & Model: ${[vehicle?.make, vehicle?.model].filter(Boolean).join(' ')}` : ''
)}

${'='.repeat(70)}

RENTAL TERMS:
${lines(
    line('Start Date', isExtension && extensionData?.previousEndDate
        ? formatDate(extensionData.previousEndDate)
        : formatDate(rental?.start_date)),
    line('End Date', isExtension && extensionData?.newEndDate
        ? formatDate(extensionData.newEndDate)
        : (rental?.end_date ? formatDate(rental.end_date) : 'Ongoing')),
    line('Rental Price', (() => {
        const type = rental?.rental_period_type || 'Monthly';
        const rate = type === 'Daily' ? vehicle?.daily_rent : type === 'Weekly' ? vehicle?.weekly_rent : vehicle?.monthly_rent;
        return `${formatCurrency(rate, currencyCode)} (${type})`;
    })())
)}
${isExtension ? `
${'='.repeat(70)}

EXTENSION DETAILS:
${lines(
    `Extension Number: #${extensionData!.extensionNumber}`,
    line('Previous End Date', extensionData!.previousEndDate ? formatDate(extensionData!.previousEndDate) : ''),
    line('New End Date', extensionData!.newEndDate ? formatDate(extensionData!.newEndDate) : ''),
    (() => {
        if (extensionData!.previousEndDate && extensionData!.newEndDate) {
            const diff = Math.ceil((new Date(extensionData!.newEndDate).getTime() - new Date(extensionData!.previousEndDate).getTime()) / (1000 * 60 * 60 * 24));
            return diff > 0 ? `Extension Duration: ${diff} day${diff !== 1 ? 's' : ''}` : '';
        }
        return '';
    })()
)}` : ''}

${'='.repeat(70)}

TERMS:
1. Customer agrees to rent the vehicle for the specified period.
2. Customer will maintain the vehicle in good condition.
3. Customer is responsible for any damage during rental.

${'='.repeat(70)}

SIGNATURE:

Customer Signature: _________________________

Date: ______________

${'='.repeat(70)}
${companyName} - Generated: ${new Date().toISOString()}
`;
}

// ============================================================================
// PLATFORM DISCLAIMER (appended to every agreement)
// ============================================================================

const PLATFORM_DISCLAIMER_BLOCKS: PdfBlock[] = [
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
// MAIN API HANDLER
// ============================================================================

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as ESignRequest;

        console.log('='.repeat(50));
        console.log('PORTAL ESIGN API (BoldSign)');
        console.log('='.repeat(50));
        console.log('Rental ID:', body.rentalId);
        console.log('Customer:', body.customerName, body.customerEmail);
        console.log('Tenant ID:', body.tenantId);

        if (!body.rentalId || !body.customerEmail || !body.customerName) {
            return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Fetch rental with related data
        const { data: rental } = await supabase
            .from('rentals')
            .select(`*, customers:customer_id(*), vehicles:vehicle_id(*)`)
            .eq('id', body.rentalId)
            .single();

        const customer = rental?.customers || { name: body.customerName, email: body.customerEmail };
        const vehicle = rental?.vehicles || { make: '', model: '', reg: 'N/A' };

        // Fetch latest identity verification for this customer (AI or Veriff)
        let verification: any = null;
        const customerId = rental?.customer_id || (customer as any)?.id;
        if (customerId) {
            const { data: verificationData } = await supabase
                .from('identity_verifications')
                .select('date_of_birth, document_number, document_expiry_date, document_type, address')
                .eq('customer_id', customerId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            verification = verificationData;
            console.log('Verification data:', verification ? 'found' : 'none');
        }

        // Fetch tenant
        let tenant = null;
        if (body.tenantId) {
            const { data: tenantData } = await supabase
                .from('tenants')
                .select('company_name, contact_email, contact_phone, phone, address, admin_name, admin_email, currency_code, logo_url, boldsign_mode, boldsign_test_brand_id, boldsign_live_brand_id, monthly_tier_days')
                .eq('id', body.tenantId)
                .single();
            tenant = tenantData;
        }

        // Fetch installment plan if rental has one
        let installment: InstallmentData | null = null;
        if (body.rentalId) {
            const { data: plan } = await supabase
                .from('installment_plans')
                .select('plan_type, total_installable_amount, number_of_installments, installment_amount, upfront_amount, status')
                .eq('rental_id', body.rentalId)
                .in('status', ['active', 'pending'])
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (plan) {
                const { data: scheduled } = await supabase
                    .from('scheduled_installments')
                    .select('installment_number, amount, due_date, status')
                    .eq('rental_id', body.rentalId)
                    .order('installment_number', { ascending: true });
                installment = { ...plan, scheduled_installments: scheduled || [] } as InstallmentData;
                console.log(`Installment plan found: ${plan.plan_type}, ${plan.number_of_installments} payments`);
            }
        }

        // ── Generate PDF ──
        const currencyCode = tenant?.currency_code || 'USD';
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
        const boldItalicFont = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);
        const ctx: PdfCtx = { doc: pdfDoc, page: pdfDoc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN, font, boldFont, italicFont, boldItalicFont };

        let hasCustomTemplate = false;
        let processedHtml = '';

        // ── Hardcoded Agreement Type banner at the top of every PDF ──
        const isExtensionAgreement = body.agreementType === 'extension' && body.extensionNumber;
        const agreementTypeLabel = isExtensionAgreement
            ? `EXTENSION AGREEMENT #${body.extensionNumber}`
            : 'ORIGINAL RENTAL AGREEMENT';
        // Draw a visible banner box
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
        const labelWidth = ctx.boldFont.widthOfTextAtSize(agreementTypeLabel, labelFontSize);
        ctx.page.drawText(agreementTypeLabel, {
            x: MARGIN + (CONTENT_W - labelWidth) / 2,
            y: bannerY + (bannerHeight - labelFontSize) / 2 + 1,
            size: labelFontSize,
            font: ctx.boldFont,
            color: rgb(0.24, 0.25, 0.59), // dark indigo text
        });
        ctx.y = bannerY - 16; // spacing after banner

        if (body.tenantId) {
            // Pick template category: extension > payg > standard
            const templateCategory = body.agreementType === 'extension'
                ? 'extension'
                : rental?.is_pay_as_you_go ? 'payg' : 'standard';
            let { data: templateData } = await supabase
                .from('agreement_templates')
                .select('template_content')
                .eq('tenant_id', body.tenantId)
                .eq('template_category', templateCategory)
                .eq('is_active', true)
                .single();

            // Fallback to standard template if no category-specific template configured
            if (!templateData && templateCategory !== 'standard') {
                const { data: fallback } = await supabase
                    .from('agreement_templates')
                    .select('template_content')
                    .eq('tenant_id', body.tenantId)
                    .eq('template_category', 'standard')
                    .eq('is_active', true)
                    .single();
                templateData = fallback;
            }

            if (templateData?.template_content) {
                console.log('Using admin template (structured HTML → PDF)');
                hasCustomTemplate = true;
                processedHtml = removeEmptyFields(
                    processTemplate(templateData.template_content, rental, customer, vehicle, tenant, currencyCode, verification, body.extensionPreviousEndDate ? { previousEndDate: body.extensionPreviousEndDate, newEndDate: body.extensionNewEndDate, extensionNumber: body.extensionNumber } : undefined, installment)
                );

                // Ensure a signature tag exists
                if (!/\{\{@sig1\}\}/.test(processedHtml)) {
                    processedHtml += '<hr><h3>Signature</h3><p>Customer Signature: {{@sig1}}</p>';
                }

                const blocks = parseHtmlToBlocks(processedHtml);
                // Append platform disclaimer
                blocks.push(...PLATFORM_DISCLAIMER_BLOCKS);
                renderBlocksToPdf(ctx, blocks);
            }
        }

        if (!hasCustomTemplate) {
            console.log('Using default template (text → PDF)');
            let textContent = generateDefaultAgreement(rental, customer, vehicle, tenant, currencyCode, body.extensionPreviousEndDate ? { previousEndDate: body.extensionPreviousEndDate, newEndDate: body.extensionNewEndDate, extensionNumber: body.extensionNumber } : undefined);

            // Inject sig tag
            const hasSig = /\{\{@sig1\}\}/.test(textContent);
            if (!hasSig) {
                const sigLineExists = /Customer Signature:\s*_+/i.test(textContent);
                textContent = textContent.replace(/Customer Signature:\s*_+/i, 'Customer Signature: {{@sig1}}');
                if (!sigLineExists) {
                    textContent += '\n\nCustomer Signature: {{@sig1}}';
                }
            }
            processedHtml = textContent; // for tag detection below

            renderTextToPdf(ctx, textContent);
        }

        const pdfBytes = await pdfDoc.save();

        // ── Resolve BoldSign mode + API key ──
        const boldsignMode: 'test' | 'live' = tenant?.boldsign_mode || 'test';
        const BOLDSIGN_API_KEY = getBoldSignApiKey(boldsignMode);
        if (!BOLDSIGN_API_KEY) {
            return NextResponse.json({ ok: false, error: 'BoldSign not configured' }, { status: 500 });
        }
        console.log('BoldSign mode:', boldsignMode);

        // ── BoldSign brand ──
        let brandId = (boldsignMode === 'test' ? tenant?.boldsign_test_brand_id : tenant?.boldsign_live_brand_id) || '';
        if (!brandId && body.tenantId && tenant?.company_name) {
            try {
                const brandForm = new FormData();
                brandForm.append('BrandName', tenant.company_name);
                brandForm.append('EmailDisplayName', tenant.company_name);

                let logoAttached = false;
                if (tenant.logo_url) {
                    try {
                        const logoResponse = await fetch(tenant.logo_url);
                        if (logoResponse.ok) {
                            const logoBuffer = await logoResponse.arrayBuffer();
                            const contentType = logoResponse.headers.get('content-type') || 'image/png';
                            const ext = contentType.includes('svg') ? 'svg' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
                            const logoBlob = new Blob([logoBuffer], { type: contentType });
                            brandForm.append('BrandLogo', logoBlob, `logo.${ext}`);
                            logoAttached = true;
                        }
                    } catch (e) {
                        console.warn('Could not fetch tenant logo for brand:', e);
                    }
                }

                if (!logoAttached) {
                    const initials = tenant.company_name.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase();
                    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#3366CC"/><text x="100" y="120" font-family="Arial,sans-serif" font-size="80" font-weight="bold" fill="white" text-anchor="middle">${initials}</text></svg>`;
                    const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
                    brandForm.append('BrandLogo', svgBlob, 'logo.svg');
                }

                const brandResponse = await fetch(`${BOLDSIGN_BASE_URL}/v1/brand/create`, {
                    method: 'POST',
                    headers: { 'X-API-KEY': BOLDSIGN_API_KEY },
                    body: brandForm,
                });

                if (brandResponse.ok) {
                    const brandResult = await brandResponse.json();
                    brandId = brandResult.brandId;
                    const brandColumn = boldsignMode === 'test' ? 'boldsign_test_brand_id' : 'boldsign_live_brand_id';
                    await supabase
                        .from('tenants')
                        .update({ [brandColumn]: brandId })
                        .eq('id', body.tenantId);
                    console.log('Created BoldSign brand:', brandId, 'for mode:', boldsignMode);
                } else {
                    console.warn('Failed to create BoldSign brand:', await brandResponse.text());
                }
            } catch (e) {
                console.warn('Error creating BoldSign brand:', e);
            }
        }

        // ── Build BoldSign request ──
        const formData = new FormData();
        formData.append('Title', `Rental Agreement - Ref: ${body.rentalId.substring(0, 8).toUpperCase()}`);
        formData.append('Message', 'Please review and sign the rental agreement.');
        if (brandId) {
            formData.append('BrandId', brandId);
        }
        formData.append('Signers[0][Name]', body.customerName);
        formData.append('Signers[0][EmailAddress]', body.customerEmail);
        formData.append('Signers[0][SignerType]', 'Signer');

        // Text tags: BoldSign finds {{@sig1}}, {{@date1}}, {{@init1}} in the PDF
        formData.append('UseTextTags', 'true');

        const hasDateTag = /\{\{@date1\}\}/.test(processedHtml);
        const hasInitTag = /\{\{@init1\}\}/.test(processedHtml);

        let tagIdx = 0;

        // Signature (always present)
        formData.append(`TextTagDefinitions[${tagIdx}][DefinitionId]`, 'sig1');
        formData.append(`TextTagDefinitions[${tagIdx}][Type]`, 'Signature');
        formData.append(`TextTagDefinitions[${tagIdx}][SignerIndex]`, '1');
        formData.append(`TextTagDefinitions[${tagIdx}][IsRequired]`, 'true');
        formData.append(`TextTagDefinitions[${tagIdx}][Size][Width]`, '250');
        formData.append(`TextTagDefinitions[${tagIdx}][Size][Height]`, '50');
        tagIdx++;

        if (hasDateTag) {
            formData.append(`TextTagDefinitions[${tagIdx}][DefinitionId]`, 'date1');
            formData.append(`TextTagDefinitions[${tagIdx}][Type]`, 'DateSigned');
            formData.append(`TextTagDefinitions[${tagIdx}][SignerIndex]`, '1');
            formData.append(`TextTagDefinitions[${tagIdx}][IsRequired]`, 'true');
            formData.append(`TextTagDefinitions[${tagIdx}][Size][Width]`, '150');
            formData.append(`TextTagDefinitions[${tagIdx}][Size][Height]`, '30');
            tagIdx++;
        }

        if (hasInitTag) {
            formData.append(`TextTagDefinitions[${tagIdx}][DefinitionId]`, 'init1');
            formData.append(`TextTagDefinitions[${tagIdx}][Type]`, 'Initial');
            formData.append(`TextTagDefinitions[${tagIdx}][SignerIndex]`, '1');
            formData.append(`TextTagDefinitions[${tagIdx}][IsRequired]`, 'true');
            formData.append(`TextTagDefinitions[${tagIdx}][Size][Width]`, '100');
            formData.append(`TextTagDefinitions[${tagIdx}][Size][Height]`, '40');
            tagIdx++;
        }

        formData.append('EnableSigningOrder', 'false');
        formData.append('DisableEmails', 'true');

        const fileBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        formData.append('Files', fileBlob, 'Rental-Agreement.pdf');

        // ── Blocking credit check BEFORE sending to BoldSign ──
        const isTestMode = boldsignMode === 'test';
        let creditDeductionResult: any = null;
        if (body.tenantId) {
            const { data: deductResult, error: deductError } = await supabase.rpc('deduct_credits', {
                p_tenant_id: body.tenantId,
                p_category: 'esign',
                p_description: `E-sign agreement: ${body.customerName} (Ref: ${body.rentalId.substring(0, 8).toUpperCase()})`,
                p_reference_id: body.rentalId,
                p_reference_type: 'rental',
                p_is_test_mode: isTestMode,
            });

            if (deductError) {
                console.error('Credit deduction RPC error:', deductError.message);
                return NextResponse.json({ ok: false, error: 'Credit check failed', detail: deductError.message }, { status: 500 });
            }

            if (deductResult?.success === false) {
                console.warn('Insufficient credits for esign:', deductResult);
                // Record the failed agreement
                const agreementType = body.agreementType || 'original';
                await supabase.from('rental_agreements').insert({
                    rental_id: body.rentalId,
                    tenant_id: body.tenantId,
                    agreement_type: agreementType,
                    document_status: 'credit_failed',
                    boldsign_mode: boldsignMode,
                    period_start_date: agreementType === 'extension' && body.extensionPreviousEndDate
                        ? body.extensionPreviousEndDate : rental?.start_date || null,
                    period_end_date: agreementType === 'extension' && body.extensionNewEndDate
                        ? body.extensionNewEndDate : rental?.end_date || null,
                });
                if (agreementType === 'original') {
                    await supabase.from('rentals').update({ document_status: 'credit_failed' }).eq('id', body.rentalId);
                }
                return NextResponse.json({ ok: false, error: 'insufficient_credits', balance: deductResult.balance, required: deductResult.required }, { status: 402 });
            }

            creditDeductionResult = deductResult;
            console.log(`Credits deducted: ${deductResult.amount_deducted} (test: ${isTestMode}, balance: ${deductResult.balance_after})`);
        }

        console.log('Sending document to BoldSign...');
        let boldSignResponse: Response | null = null;
        const maxSendRetries = 3;
        for (let sendAttempt = 1; sendAttempt <= maxSendRetries; sendAttempt++) {
            boldSignResponse = await fetch(`${BOLDSIGN_BASE_URL}/v1/document/send`, {
                method: 'POST',
                headers: { 'X-API-KEY': BOLDSIGN_API_KEY },
                body: formData,
            });
            if (boldSignResponse.status === 429 && sendAttempt < maxSendRetries) {
                const waitSec = sendAttempt * 15; // 15s, 30s
                console.warn(`BoldSign rate limited (429), retrying in ${waitSec}s (attempt ${sendAttempt}/${maxSendRetries})...`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
                continue;
            }
            break;
        }

        if (!boldSignResponse!.ok) {
            const errorText = await boldSignResponse!.text();
            console.error('BoldSign error:', boldSignResponse!.status, errorText);
            // Refund credits since BoldSign failed
            if (body.tenantId && creditDeductionResult?.success) {
                try {
                    await supabase.rpc('add_credits', {
                        p_tenant_id: body.tenantId,
                        p_amount: creditDeductionResult.amount_deducted,
                        p_type: 'refund',
                        p_description: `Refund: BoldSign send failed (Ref: ${body.rentalId.substring(0, 8).toUpperCase()})`,
                        p_category: 'esign',
                        p_is_test_mode: isTestMode,
                    });
                    console.log('Credits refunded after BoldSign failure');
                } catch (refundErr) {
                    console.error('Failed to refund credits:', refundErr);
                }
            }
            return NextResponse.json({ ok: false, error: 'Failed to create document', detail: errorText, boldsignStatus: boldSignResponse!.status, boldsignMode, hasApiKey: !!BOLDSIGN_API_KEY, apiKeyPrefix: BOLDSIGN_API_KEY.substring(0, 8) + '...' }, { status: 500 });
        }

        const boldSignResult = await boldSignResponse.json();
        const documentId = boldSignResult.documentId;
        const agreementType = body.agreementType || 'original';
        const now = new Date().toISOString();

        // Insert into rental_agreements table
        console.log('Creating rental_agreements record, type:', agreementType);
        const { data: agreementRow, error: agreementError } = await supabase
            .from('rental_agreements')
            .insert({
                rental_id: body.rentalId,
                tenant_id: body.tenantId,
                agreement_type: agreementType,
                document_id: documentId,
                document_status: 'sent',
                boldsign_mode: boldsignMode,
                envelope_created_at: now,
                envelope_sent_at: now,
                period_start_date: agreementType === 'extension' && body.extensionPreviousEndDate
                    ? body.extensionPreviousEndDate
                    : rental?.start_date || null,
                period_end_date: agreementType === 'extension' && body.extensionNewEndDate
                    ? body.extensionNewEndDate
                    : rental?.end_date || null,
            })
            .select('id')
            .single();

        if (agreementError) {
            console.error('Failed to create rental_agreements row:', agreementError);
        }
        const agreementId = agreementRow?.id || null;

        // For original agreements: also update rentals fields (backward compat)
        if (agreementType === 'original') {
            console.log('Updating rental with document info (original agreement)...');
            await supabase
                .from('rentals')
                .update({
                    docusign_envelope_id: documentId,
                    document_status: 'sent',
                    envelope_created_at: now,
                    envelope_sent_at: now,
                    boldsign_mode: boldsignMode,
                })
                .eq('id', body.rentalId);
        }

        // Trigger auto-refill if needed (non-blocking)
        if (creditDeductionResult?.auto_refill_needed && body.tenantId) {
            fetch(`${supabaseUrl}/functions/v1/manage-credit-wallet`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({ action: 'auto_refill', tenantId: body.tenantId }),
            }).catch((e) => console.warn('Auto-refill trigger error:', e));
        }

        // Build signing redirect URL — no BoldSign API calls needed at email time.
        // When the customer clicks this link, the portal fetches the signing link
        // from BoldSign (1 API call) and redirects them to the signing page.
        const portalOrigin = request.headers.get('origin') || request.nextUrl.origin;
        const signingLink = agreementId
            ? `${portalOrigin}/api/esign/signing-redirect?id=${agreementId}`
            : '';
        if (signingLink) {
            console.log('Using signing redirect URL:', signingLink);
        }

        // Send signing email (we handle emails ourselves since DisableEmails is true)
        let emailSent = false;
        try {
            const refId = body.rentalId.substring(0, 8).toUpperCase();
            const companyName = tenant?.company_name || 'Drive 247';
            const vehicleDesc = [vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'your vehicle';

            const signingEmailResponse = await fetch(`${supabaseUrl}/functions/v1/send-signing-email`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({
                    customerEmail: body.customerEmail,
                    customerName: body.customerName,
                    documentId,
                    companyName,
                    rentalRef: refId,
                    vehicleInfo: vehicleDesc,
                    tenantId: body.tenantId,
                    boldsignMode: boldsignMode,
                    signingLink: signingLink || undefined,
                    agreementId: agreementId || undefined,
                    rentalId: body.rentalId,
                }),
            });
            emailSent = signingEmailResponse.ok;
            if (!emailSent) {
                console.warn('Signing email error:', await signingEmailResponse.text());
            }
            console.log('Signing email:', emailSent ? 'sent' : 'failed');
        } catch (e) {
            console.warn('Signing email error:', e);
        }

        // Send WhatsApp notification
        let whatsAppSent = false;
        const customerPhone = (customer as any)?.phone || '';
        if (customerPhone && documentId) {
            try {
                const companyName = tenant?.company_name || 'Drive 247';
                const refId = body.rentalId.substring(0, 8).toUpperCase();
                const message = `\u{1F4DD} *Rental Agreement Ready to Sign*\n\nHi ${body.customerName},\n\n${companyName} has sent you a rental agreement (Ref: ${refId}) to sign.\n\nPlease check your email from BoldSign and click "Review and Sign" to complete.\n\nIf you have any questions, contact ${companyName}.`;

                const whatsappResponse = await fetch(`${supabaseUrl}/functions/v1/send-signing-whatsapp`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${supabaseServiceKey}`,
                    },
                    body: JSON.stringify({
                        customerPhone: customerPhone,
                        message: message,
                        tenantId: body.tenantId,
                    }),
                });

                whatsAppSent = whatsappResponse.ok;
                if (!whatsAppSent) {
                    console.warn('WhatsApp edge function error:', await whatsappResponse.text());
                }
                console.log('WhatsApp signing notification:', whatsAppSent ? 'sent' : 'failed');
            } catch (e) {
                console.warn('WhatsApp notification error:', e);
            }
        }

        // Create in-app notification for the customer
        try {
            const { data: customerUser } = await supabase
                .from('customer_users')
                .select('id')
                .eq('customer_id', rental.customer_id)
                .eq('tenant_id', body.tenantId)
                .maybeSingle();

            if (customerUser?.id) {
                const companyName = tenant?.company_name || tenant?.app_name || 'Drive 247';
                await supabase
                    .from('customer_notifications')
                    .insert({
                        customer_user_id: customerUser.id,
                        tenant_id: body.tenantId,
                        title: 'Rental Agreement Ready to Sign',
                        message: `${companyName} has sent you a rental agreement to sign. Please check your email and click "Review and Sign" to complete.`,
                        type: 'agreement',
                        link: '/portal/agreements',
                        metadata: { rental_id: body.rentalId, document_id: documentId },
                    });
                console.log('In-app notification created for customer:', customerUser.id);
            } else {
                console.log('No customer_user found for customer_id:', rental.customer_id, '— skipping in-app notification');
            }
        } catch (notifErr) {
            console.warn('Failed to create in-app notification:', notifErr);
        }

        console.log('SUCCESS! Document ID:', documentId, 'Agreement ID:', agreementId);
        return NextResponse.json({ ok: true, envelopeId: documentId, agreementId, emailSent: true, whatsAppSent });

    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
