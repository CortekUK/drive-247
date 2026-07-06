// Server-side loader for the /privacy and /terms legal pages.
//
// WHY THIS EXISTS: these pages were previously 'use client' and fetched their
// content in the browser, so the server HTML was an empty skeleton. US A2P
// 10DLC / carrier review crawlers (and other non-JS bots) saw a blank page and
// rejected tenants' SMS campaigns with errors 30908 (privacy policy can not be
// verified) and 30882 (terms & conditions issues). Rendering the same content
// on the server puts the real policy text into the HTML the crawler reads.
//
// This module mirrors the fetch strategy of usePageContent() (tenant-specific
// published content first, then global content with tenant_id IS NULL, then the
// in-app default) but runs on the server using the per-request x-tenant-slug
// header — the same pattern as app/sms-opt-in/page.tsx.

import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import {
  defaultPrivacyContent,
  defaultTermsContent,
  type PrivacyPolicyContent,
  type TermsOfServiceContent,
} from '@/hooks/usePageContent';

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hviqoaokxvlancmftwuo.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  '';

type LegalSlug = 'privacy' | 'terms';

// Carrier-required SMS disclosure. If a tenant's custom policy already discusses
// SMS + no-third-party sharing (as RevTek's does) we leave it untouched; this is
// only a safety net for a tenant whose policy omits it, so the server-rendered
// page always carries the clause the messaging reviewer looks for. The no-share
// sentence is Twilio's canonical model sentence — reviewers match on it.
const SMS_DISCLOSURE_SECTION = `
<h2>SMS Text Messaging</h2>
<p>When you opt in by checking the SMS consent box on our booking form, we may send you SMS text messages about your rental — booking confirmations, vehicle pickup and collection details, lockbox codes, e-signing links, trip and return reminders, payment notifications, and customer support. Message frequency varies. Message and data rates may apply. Reply STOP to opt out at any time, or HELP for help.</p>
<p>Consent to receive SMS is not a condition of any rental or purchase. We do not share, sell, or otherwise provide your mobile phone number, mobile information, or SMS consent to any third parties, affiliates, or lead generators for marketing or promotional purposes.</p>`;

// Elements A2P 10DLC campaign vetting requires inside the Terms & Conditions
// SMS section (error 30882 checklist): carrier-liability disclaimer, bolded
// opt-out/help instructions, and an inline Privacy Policy link. Appended only
// when a tenant's terms content lacks them — tenants who already carry the
// elements render unchanged.
const TERMS_SMS_COMPLIANCE_SECTION = `
<p><strong>Reply STOP to opt out of SMS messages at any time, or HELP for help.</strong> Message frequency varies and message and data rates may apply. Carriers are not liable for any delayed or undelivered messages. For details on how mobile information is handled, see our <a href="/privacy">Privacy Policy</a>.</p>`;

function ensureTermsSmsCompliance(html: string): string {
  const t = (html || '').toLowerCase();
  const hasCarrierLine = t.includes('carriers are not liable');
  const hasInlinePrivacyLink = t.includes('href="/privacy"') || t.includes("href='/privacy'");
  if (hasCarrierLine && hasInlinePrivacyLink) return html;
  return `${html || ''}${TERMS_SMS_COMPLIANCE_SECTION}`;
}

function hasSmsDisclosure(html: string | undefined | null): boolean {
  const t = (html || '').toLowerCase();
  const mentionsSms = t.includes('sms') || t.includes('text message');
  const noThirdParty =
    t.includes('third part') ||
    t.includes('not be shared') ||
    t.includes('do not share') ||
    t.includes('not shared');
  return mentionsSms && noThirdParty;
}

function ensureSmsDisclosure(html: string): string {
  return hasSmsDisclosure(html) ? html : `${html || ''}${SMS_DISCLOSURE_SECTION}`;
}

// Fetch the tenant's published CMS sections for a legal page, server-side.
// Returns the section map (e.g. { privacy_content, seo }) or null when nothing
// is published for this tenant or globally.
async function fetchLegalSections(slug: LegalSlug): Promise<Record<string, any> | null> {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

    const headersList = await headers();
    const tenantSlug = headersList.get('x-tenant-slug');
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const selectExpr =
      'id, slug, status, tenant_id, cms_page_sections(section_key, content, is_visible)';

    const fetchPage = (tenantId: string | null) => {
      let query = supabase
        .from('cms_pages')
        .select(selectExpr)
        .eq('slug', slug)
        .eq('status', 'published');
      query = tenantId ? query.eq('tenant_id', tenantId) : query.is('tenant_id', null);
      return query.maybeSingle();
    };

    // The client hook keys off tenant.id; server-side we resolve the id from the
    // per-request slug header first.
    let tenantId: string | null = null;
    if (tenantSlug) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('slug', tenantSlug)
        .maybeSingle();
      tenantId = (tenant as { id?: string } | null)?.id ?? null;
    }

    let page: any = null;
    if (tenantId) {
      page = (await fetchPage(tenantId)).data;
      if (!page) page = (await fetchPage(null)).data; // global fallback (tenant_id IS NULL)
    } else {
      page = (await fetchPage(null)).data;
    }
    if (!page) return null;

    const sections: Record<string, any> = {};
    for (const section of page.cms_page_sections || []) {
      if (section.is_visible) sections[section.section_key] = section.content;
    }
    return sections;
  } catch {
    // Never let a fetch error blank the page — fall back to defaults below.
    return null;
  }
}

export async function getPrivacyPageContent(): Promise<PrivacyPolicyContent> {
  const sections = await fetchLegalSections('privacy');
  const base =
    (sections?.privacy_content as PrivacyPolicyContent) ||
    (defaultPrivacyContent.privacy_content as PrivacyPolicyContent);
  return { ...base, content: ensureSmsDisclosure(base.content) };
}

export async function getTermsPageContent(): Promise<TermsOfServiceContent> {
  const sections = await fetchLegalSections('terms');
  const base =
    (sections?.terms_content as TermsOfServiceContent) ||
    (defaultTermsContent.terms_content as TermsOfServiceContent);
  return { ...base, content: ensureTermsSmsCompliance(base.content) };
}

/**
 * Tenant identity for the compliance pages' server-rendered chrome
 * (LegalPageShell). Resolved from the per-request x-tenant-slug header, same
 * as the content fetches above. Falls back to the platform default when no
 * tenant context exists (e.g. direct hit on the bare domain).
 */
export async function getLegalTenantBranding(): Promise<{
  slug: string | null;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  twilioPhone: string | null;
}> {
  const fallback = {
    slug: null as string | null,
    name: 'Drive 247',
    contactEmail: null as string | null,
    contactPhone: null as string | null,
    twilioPhone: null as string | null,
  };
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return fallback;
    const headersList = await headers();
    const tenantSlug = headersList.get('x-tenant-slug');
    if (!tenantSlug) return fallback;
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await supabase
      .from('tenants')
      .select('slug, app_name, company_name, contact_email, contact_phone, phone, twilio_phone_number')
      .eq('slug', tenantSlug)
      .maybeSingle();
    if (!data) return fallback;
    const t = data as any;
    return {
      slug: t.slug ?? tenantSlug,
      name: t.app_name || t.company_name || fallback.name,
      contactEmail: t.contact_email || null,
      contactPhone: t.contact_phone || t.phone || null,
      twilioPhone: t.twilio_phone_number || null,
    };
  } catch {
    return fallback;
  }
}
