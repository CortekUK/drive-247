import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from 'pdf-lib';

// BoldSign configuration
const BOLDSIGN_API_KEY = process.env.BOLDSIGN_API_KEY || '';
const BOLDSIGN_BASE_URL = process.env.BOLDSIGN_BASE_URL || 'https://api.boldsign.com';

// Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

interface ESignRequest {
    rentalId: string;
    customerEmail: string;
    customerName: string;
    tenantId: string;
}

// ============================================================================
// FORMAT HELPERS
// ============================================================================

function formatDate(date: string | Date | null): string {
    if (!date) return 'N/A';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatCurrency(amount: number | null, currencyCode: string = 'GBP'): string {
    const value = amount ?? 0;
    const code = currencyCode?.toUpperCase() || 'GBP';
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

function processTemplate(template: string, rental: any, customer: any, vehicle: any, tenant: any, currencyCode: string = 'GBP', verification?: any): string {
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
        vehicle_allowed_mileage: vehicle?.allowed_mileage?.toString() || '',

        // Rental
        rental_number: rental?.rental_number || rental?.id?.substring(0, 8)?.toUpperCase() || '',
        rental_id: rental?.id || '',
        rental_start_date: formatDate(rental?.start_date),
        rental_end_date: rental?.end_date ? formatDate(rental.end_date) : 'Ongoing',
        rental_days: (() => {
            if (rental?.start_date && rental?.end_date) {
                const diff = Math.ceil((new Date(rental.end_date).getTime() - new Date(rental.start_date).getTime()) / (1000 * 60 * 60 * 24));
                return diff > 0 ? diff.toString() : '1';
            }
            return '';
        })(),
        monthly_amount: formatCurrency(rental?.monthly_amount, currencyCode),
        rental_amount: formatCurrency(rental?.monthly_amount, currencyCode),
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
    };

    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), value);
    }
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

interface TextRun { text: string; bold: boolean; }
interface TableRow { cells: string[]; isHeader: boolean; }
interface PdfBlock {
    type: 'h1' | 'h2' | 'h3' | 'paragraph' | 'table' | 'bullet-list' | 'ordered-list' | 'hr';
    runs?: TextRun[];
    rows?: TableRow[];
    items?: string[];
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

function parseInlineRuns(html: string): TextRun[] {
    const runs: TextRun[] = [];
    let remaining = html;

    while (remaining.length > 0) {
        const boldMatch = remaining.match(/<(strong|b)>([\s\S]*?)<\/\1>/i);
        if (boldMatch && boldMatch.index !== undefined) {
            if (boldMatch.index > 0) {
                const text = stripTags(remaining.substring(0, boldMatch.index));
                if (text) runs.push({ text, bold: false });
            }
            const boldText = stripTags(boldMatch[2]);
            if (boldText) runs.push({ text: boldText, bold: true });
            remaining = remaining.substring(boldMatch.index + boldMatch[0].length);
        } else {
            const text = stripTags(remaining);
            if (text) runs.push({ text, bold: false });
            break;
        }
    }

    return runs.length > 0 ? runs : [{ text: '', bold: false }];
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

function parseListItems(listHtml: string): string[] {
    const items: string[] = [];
    const itemRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    while ((match = itemRegex.exec(listHtml)) !== null) {
        const text = stripTags(match[1]);
        if (text) items.push(text);
    }
    return items;
}

function parseHtmlToBlocks(html: string): PdfBlock[] {
    const blocks: PdfBlock[] = [];
    let cleaned = removeEmptyFields(html).replace(/\r\n/g, '\n');

    // Replace block-level elements with indexed markers to preserve document order
    let idx = 0;
    const blockMap = new Map<string, { tag: string; content: string }>();

    const replaceBlock = (tag: string) => (match: string, content: string) => {
        const key = `\n\x00BLOCK_${idx++}\x00\n`;
        blockMap.set(key.trim(), { tag, content: content || '' });
        return key;
    };

    // Order matters: tables first (they contain <td>/<th>/<p> which shouldn't be matched separately)
    cleaned = cleaned.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, replaceBlock('table'));
    cleaned = cleaned.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, replaceBlock('h1'));
    cleaned = cleaned.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, replaceBlock('h2'));
    cleaned = cleaned.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, replaceBlock('h3'));
    cleaned = cleaned.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, replaceBlock('ul'));
    cleaned = cleaned.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, replaceBlock('ol'));
    cleaned = cleaned.replace(/<hr\s*\/?>/gi, () => {
        const key = `\n\x00BLOCK_${idx++}\x00\n`;
        blockMap.set(key.trim(), { tag: 'hr', content: '' });
        return key;
    });
    cleaned = cleaned.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, replaceBlock('p'));

    // Split by lines and process in document order
    const parts = cleaned.split('\n').map(p => p.trim()).filter(Boolean);

    for (const part of parts) {
        const block = blockMap.get(part);
        if (block) {
            switch (block.tag) {
                case 'hr':
                    blocks.push({ type: 'hr' });
                    break;
                case 'h1':
                    blocks.push({ type: 'h1', runs: parseInlineRuns(block.content) });
                    break;
                case 'h2':
                    blocks.push({ type: 'h2', runs: parseInlineRuns(block.content) });
                    break;
                case 'h3':
                    blocks.push({ type: 'h3', runs: parseInlineRuns(block.content) });
                    break;
                case 'p': {
                    const runs = parseInlineRuns(block.content);
                    if (runs.some(r => r.text.trim())) {
                        blocks.push({ type: 'paragraph', runs });
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
                blocks.push({ type: 'paragraph', runs: [{ text, bold: false }] });
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
}

function newPage(ctx: PdfCtx) {
    ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
    ctx.y = PAGE_H - MARGIN;
}

function ensureSpace(ctx: PdfCtx, needed: number) {
    if (ctx.y - needed < MARGIN) newPage(ctx);
}

/** Draw text, rendering e-sign tags in white (invisible but BoldSign-detectable) */
function drawText(ctx: PdfCtx, text: string, x: number, fontSize: number, useFont: PDFFont) {
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
            xPos += useFont.widthOfTextAtSize(seg, fontSize);
        }
    } else {
        ctx.page.drawText(text, { x, y: ctx.y, size: fontSize, font: useFont, color: rgb(0, 0, 0) });
    }
}

/** Word-wrap and draw a sequence of text runs */
function drawWrappedRuns(ctx: PdfCtx, runs: TextRun[], fontSize: number, lineHeight: number, forceBold: boolean, indent: number = 0) {
    const maxW = CONTENT_W - indent;
    const startX = MARGIN + indent;
    let xPos = startX;

    for (const run of runs) {
        const f = (run.bold || forceBold) ? ctx.boldFont : ctx.font;
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

            drawText(ctx, word, xPos, fontSize, f);
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
                drawWrappedRuns(ctx, block.runs || [], S.h1, LH.h1, true);
                ctx.y -= 4;
                break;
            }
            case 'h2': {
                ensureSpace(ctx, S.h2 + 14);
                ctx.y -= 12;
                drawWrappedRuns(ctx, block.runs || [], S.h2, LH.h2, true);
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
                drawWrappedRuns(ctx, block.runs || [], S.h3, LH.h3, true);
                ctx.y -= 2;
                break;
            }
            case 'paragraph': {
                ensureSpace(ctx, LH.body);
                drawWrappedRuns(ctx, block.runs || [], S.body, LH.body, false);
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
                    drawWrappedRuns(ctx, [{ text: item, bold: false }], S.body, LH.body, false, 8 + bulletW);
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

function generateDefaultAgreement(rental: any, customer: any, vehicle: any, tenant: any, currencyCode: string = 'GBP'): string {
    const companyName = tenant?.company_name || 'Drive 247';
    const line = (label: string, value: string | null | undefined) => value ? `${label}: ${value}` : '';
    const lines = (...parts: string[]) => parts.filter(Boolean).join('\n');

    return `
RENTAL AGREEMENT
${'='.repeat(70)}

Date: ${formatDate(new Date())}
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
    line('Start Date', formatDate(rental?.start_date)),
    line('End Date', rental?.end_date ? formatDate(rental.end_date) : 'Ongoing'),
    line('Amount', formatCurrency(rental?.monthly_amount, currencyCode))
)}

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
    { type: 'paragraph', runs: [{ text: 'Platform Disclaimer', bold: true }] },
    {
        type: 'paragraph',
        runs: [{
            text: 'The parties acknowledge that Drive247 is a software platform operated by Cortek Systems Ltd, which provides technology services solely to facilitate booking, documentation, and administrative processes for vehicle rental companies. Drive247 and Cortek Systems Ltd are not a party to this Rental Agreement and do not own, lease, manage, insure, or control any vehicles listed on the platform.',
            bold: false,
        }],
    },
    {
        type: 'paragraph',
        runs: [{
            text: 'All contractual obligations, responsibilities, and liabilities relating to the rental transaction, including vehicle condition, insurance coverage, payment collection, disputes, and claims, exist solely between the Rental Company and the Renter. Drive247 and Cortek Systems Ltd shall have no liability for any losses, damages, claims, disputes, or obligations arising from or relating to this rental transaction.',
            bold: false,
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

        if (!BOLDSIGN_API_KEY) {
            return NextResponse.json({ ok: false, error: 'BoldSign not configured' }, { status: 500 });
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
                .select('company_name, contact_email, contact_phone, phone, address, admin_name, admin_email, currency_code, logo_url, boldsign_brand_id')
                .eq('id', body.tenantId)
                .single();
            tenant = tenantData;
        }

        // ── Generate PDF ──
        const currencyCode = tenant?.currency_code || 'GBP';
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const ctx: PdfCtx = { doc: pdfDoc, page: pdfDoc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN, font, boldFont };

        let hasCustomTemplate = false;
        let processedHtml = '';

        if (body.tenantId) {
            const { data: templateData } = await supabase
                .from('agreement_templates')
                .select('template_content')
                .eq('tenant_id', body.tenantId)
                .eq('is_active', true)
                .single();

            if (templateData?.template_content) {
                console.log('Using admin template (structured HTML → PDF)');
                hasCustomTemplate = true;
                processedHtml = removeEmptyFields(
                    processTemplate(templateData.template_content, rental, customer, vehicle, tenant, currencyCode, verification)
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
            let textContent = generateDefaultAgreement(rental, customer, vehicle, tenant, currencyCode);

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

        // ── BoldSign brand ──
        let brandId = tenant?.boldsign_brand_id || '';
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
                    await supabase
                        .from('tenants')
                        .update({ boldsign_brand_id: brandId })
                        .eq('id', body.tenantId);
                    console.log('Created BoldSign brand:', brandId);
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
        formData.append('DisableEmails', 'false');

        const fileBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        formData.append('Files', fileBlob, 'Rental-Agreement.pdf');

        console.log('Sending document to BoldSign...');
        const boldSignResponse = await fetch(`${BOLDSIGN_BASE_URL}/v1/document/send`, {
            method: 'POST',
            headers: { 'X-API-KEY': BOLDSIGN_API_KEY },
            body: formData,
        });

        if (!boldSignResponse.ok) {
            const errorText = await boldSignResponse.text();
            console.error('BoldSign error:', boldSignResponse.status, errorText);
            return NextResponse.json({ ok: false, error: 'Failed to create document', detail: errorText }, { status: 500 });
        }

        const boldSignResult = await boldSignResponse.json();
        const documentId = boldSignResult.documentId;

        // Update rental with BoldSign document info
        console.log('Updating rental with document info...');
        await supabase
            .from('rentals')
            .update({
                docusign_envelope_id: documentId,
                document_status: 'sent',
                envelope_created_at: new Date().toISOString(),
                envelope_sent_at: new Date().toISOString(),
            })
            .eq('id', body.rentalId);

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

        console.log('SUCCESS! Document ID:', documentId);
        return NextResponse.json({ ok: true, envelopeId: documentId, emailSent: true, whatsAppSent });

    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
