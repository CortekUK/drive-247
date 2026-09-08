'use client';

/**
 * Legal Pages — author the platform Terms of Service and Privacy Policy.
 *
 * What a super admin publishes here is what drive-247.com/terms and
 * drive-247.com/privacy serve. Nothing is published until Publish is ticked and
 * saved, so a document can be staged over several sittings without the public
 * site showing half of it.
 *
 * THESE ARE NOT A TENANT'S RENTAL TERMS. Every tenant's booking site serves its
 * own terms at {tenant}.drive-247.com/terms from `cms_pages` — the contract
 * between a renter and an operator, currently under A2P 10DLC carrier review.
 * They are a different document with a different audience and a different legal
 * meaning, and they are stored in a different table on purpose. Editing here
 * cannot touch them. See ops/platform_legal_documents.sql.
 *
 * ROUTING: creating this directory is the whole routing step. `(protected)`
 * already does auth and the sales-agent confinement, and there is no route
 * table in this app.
 *
 * The table may not exist yet — `ops/platform_legal_documents.sql` is applied by
 * hand — so a missing-table read is reported as a setup instruction rather than
 * as a failure, and the public pages keep serving their compiled documents
 * until a row is published.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Loader2, Save, Scale } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import {
  DEFAULT_PRIVACY_BODY_MD,
  DEFAULT_PRIVACY_EFFECTIVE_DATE,
  DEFAULT_PRIVACY_TITLE,
  DEFAULT_TERMS_BODY_MD,
  DEFAULT_TERMS_EFFECTIVE_DATE,
  DEFAULT_TERMS_TITLE,
  DEFAULT_TERMS_VERSION,
} from '@/lib/legal/default-documents';

type Slug = 'terms' | 'privacy';

const SLUGS: { slug: Slug; label: string; publicPath: string }[] = [
  { slug: 'terms', label: 'Terms of Service', publicPath: '/terms' },
  { slug: 'privacy', label: 'Privacy Policy', publicPath: '/privacy' },
];

/**
 * The version string `create-subscription-checkout` stamps into
 * `tenants.platform_tos_version` when an operator subscribes.
 *
 * Hardcoded here, with the file named, ON PURPOSE. The real constant lives in
 * `supabase/functions/_shared/platform-tos.ts`, which is imported by four edge
 * functions — V2_PLAN §7 is explicit that editing a shared helper is editing
 * every function that imports it, so this page does not reach into it and does
 * not try to keep it in sync.
 *
 * What it does instead is make the drift VISIBLE. Publishing a new Terms
 * version while checkout still records the old one is not a bug this page can
 * fix, but it is one the person publishing needs to know they have created —
 * consent records would point at a version nobody can now read.
 */
const STAMPED_TOS_VERSION = '2026-02-platform-tou'; // supabase/functions/_shared/platform-tos.ts:57

interface LegalDoc {
  id: string | null;
  slug: Slug;
  version: string;
  title: string;
  body_md: string;
  effective_date: string;
  is_published: boolean;
}

/**
 * The starting point for a document nobody has authored yet: what the public
 * site is serving right now, as markdown.
 *
 * NOT an empty form. A blank textarea on a page called "Terms of Service"
 * invites someone to write a legal document from scratch while a reviewed one
 * is already live — and whatever they wrote would replace it wholesale on
 * publish. Prefilled, the first edit is an edit.
 *
 * `is_published` stays FALSE regardless. Loading the current text is a
 * convenience; putting it live is a decision, and it stays a deliberate one.
 */
function emptyDoc(slug: Slug): LegalDoc {
  const terms = slug === 'terms';
  return {
    id: null,
    slug,
    version: terms ? DEFAULT_TERMS_VERSION : '',
    title: terms ? DEFAULT_TERMS_TITLE : DEFAULT_PRIVACY_TITLE,
    body_md: terms ? DEFAULT_TERMS_BODY_MD : DEFAULT_PRIVACY_BODY_MD,
    effective_date: terms ? DEFAULT_TERMS_EFFECTIVE_DATE : DEFAULT_PRIVACY_EFFECTIVE_DATE,
    is_published: false,
  };
}

export default function LegalPagesAdmin() {
  const [active, setActive] = useState<Slug>('terms');
  const [docs, setDocs] = useState<Record<Slug, LegalDoc>>({
    terms: emptyDoc('terms'),
    privacy: emptyDoc('privacy'),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error' | 'setup'; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('platform_legal_documents')
      .select('id,slug,version,title,body_md,effective_date,is_published')
      .order('updated_at', { ascending: false });

    if (error) {
      // A missing table is a setup step, not a failure. Saying which it is
      // saves the next person from debugging RLS on a table that is not there.
      const missing =
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        /could not find the table|does not exist/i.test(error.message);
      setNotice({
        tone: missing ? 'setup' : 'error',
        text: missing
          ? 'The platform_legal_documents table has not been created yet — apply ops/platform_legal_documents.sql, then reload. The editor below is prefilled with the documents drive-247.com is serving right now, so you can read and edit them, but nothing can be saved until the table exists.'
          : `Could not load the documents: ${error.message}`,
      });
      setLoading(false);
      return;
    }

    const next: Record<Slug, LegalDoc> = { terms: emptyDoc('terms'), privacy: emptyDoc('privacy') };
    for (const row of data ?? []) {
      const slug = row.slug as Slug;
      if (slug !== 'terms' && slug !== 'privacy') continue;
      // Ordered newest-first, so the first row for a slug wins and any older
      // drafts are left alone rather than being silently overwritten.
      if (next[slug].id) continue;
      next[slug] = {
        id: row.id,
        slug,
        version: row.version ?? '',
        title: row.title ?? '',
        body_md: row.body_md ?? '',
        effective_date: row.effective_date ?? '',
        is_published: !!row.is_published,
      };
    }
    setDocs(next);
    setNotice(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const doc = docs[active];
  const patch = (fields: Partial<LegalDoc>) =>
    setDocs((prev) => ({ ...prev, [active]: { ...prev[active], ...fields } }));

  const save = async () => {
    if (!doc.version.trim() || !doc.title.trim() || !doc.body_md.trim()) {
      setNotice({
        tone: 'error',
        text: 'Title, version and body are all required before this can be saved.',
      });
      return;
    }

    setSaving(true);
    setNotice(null);

    const payload = {
      slug: doc.slug,
      version: doc.version.trim(),
      title: doc.title.trim(),
      body_md: doc.body_md,
      effective_date: doc.effective_date.trim() || null,
      is_published: doc.is_published,
      updated_at: new Date().toISOString(),
    };

    const { error } = doc.id
      ? await supabase.from('platform_legal_documents').update(payload).eq('id', doc.id)
      : await supabase.from('platform_legal_documents').insert(payload);

    setSaving(false);

    if (error) {
      // The partial unique index refuses a second published row per slug. That
      // is the guard doing its job, so it gets a sentence rather than a code.
      const duplicate = error.code === '23505';
      setNotice({
        tone: 'error',
        text: duplicate
          ? 'Another published version of this document already exists. Unpublish it first — only one version of each document can be live at a time.'
          : `Could not save: ${error.message}`,
      });
      return;
    }

    setNotice({
      tone: 'ok',
      text: doc.is_published
        ? 'Saved and published. The public page updates within the hour, or immediately on the next deploy.'
        : 'Saved as a draft. The public page is unchanged until this is published.',
    });
    void load();
  };

  const versionDrift =
    active === 'terms' &&
    doc.is_published &&
    doc.version.trim() !== '' &&
    doc.version.trim() !== STAMPED_TOS_VERSION;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Scale className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">Legal Pages</h1>
          <p className="text-sm text-muted-foreground">
            The Terms and Privacy Policy served at drive-247.com. Not tenant rental terms.
          </p>
        </div>
      </header>

      <div className="flex gap-2">
        {SLUGS.map((s) => (
          <button
            key={s.slug}
            type="button"
            onClick={() => setActive(s.slug)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              active === s.slug
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {s.label}
            {docs[s.slug].is_published && (
              <span className="ml-2 text-[10px] uppercase opacity-70">live</span>
            )}
          </button>
        ))}
      </div>

      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${
            notice.tone === 'error'
              ? 'bg-destructive/10 text-destructive'
              : notice.tone === 'setup'
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {notice.text}
        </p>
      )}

      {versionDrift && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            This version is <strong>{doc.version}</strong>, but checkout records{' '}
            <strong>{STAMPED_TOS_VERSION}</strong> against every new signup. Consent records
            will point at a version that is no longer the one being served. Update
            <code className="mx-1 rounded bg-black/10 px-1">
              supabase/functions/_shared/platform-tos.ts
            </code>
            and redeploy the subscription edge functions to bring them back in step.
          </span>
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      ) : (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="sm:col-span-2 block text-sm">
              <span className="mb-1.5 block font-medium">Title</span>
              <input
                value={doc.title}
                onChange={(e) => patch({ title: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">Version</span>
              <input
                value={doc.version}
                onChange={(e) => patch({ version: e.target.value })}
                placeholder="2026-02-platform-tou"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">
              Effective date <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <input
              value={doc.effective_date}
              onChange={(e) => patch({ effective_date: e.target.value })}
              placeholder="1 March 2026"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">
              Body{' '}
              <span className="font-normal text-muted-foreground">
                — Markdown. Headings, lists, links and tables all render.
              </span>
            </span>
            <textarea
              value={doc.body_md}
              onChange={(e) => patch({ body_md: e.target.value })}
              rows={22}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] leading-relaxed"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => patch({ is_published: !doc.is_published })}
              className="flex items-center gap-2 text-sm font-medium"
            >
              {doc.is_published ? (
                <Eye className="size-4 text-emerald-600" />
              ) : (
                <EyeOff className="size-4 text-muted-foreground" />
              )}
              {doc.is_published ? 'Published — live on the public site' : 'Draft — not public'}
            </button>

            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
