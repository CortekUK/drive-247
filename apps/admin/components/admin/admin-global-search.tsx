'use client';

/**
 * ⌘K for Super Admin, in the window Northwind's `global-search-v2.tsx` draws:
 * the brand wash behind a lighter veil, a bare input with a primary glass,
 * uppercase group captions, rows that light up in the sidebar's own highlight
 * with a ↵ on the chosen one.
 *
 * It searches what a super admin looks for: rental companies (by name, slug or
 * email) and the pages of this app. Northwind's right-hand Trax column is not
 * here — Super Admin has no Trax.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, CornerDownLeft, Loader2, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { SIDEBAR_HIGHLIGHT_ACTIVE } from '@/components/ui/sidebar';
import { useAdminNav } from '@/components/admin/admin-nav';

type Result = {
  key: string;
  title: string;
  subtitle: string;
  href: string;
};

type Group = { key: string; title: string; items: Result[] };

type TenantHit = {
  id: string;
  company_name: string | null;
  slug: string | null;
  contact_email: string | null;
};

/** PostgREST `or` filters are comma-separated; a comma or bracket in the term would break the list. */
function sanitize(term: string) {
  return term.replace(/[,()*%]/g, ' ').trim();
}

export function AdminGlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const nav = useAdminNav();
  const [query, setQuery] = useState('');
  const [tenants, setTenants] = useState<TenantHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(-1);
  const requestId = useRef(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTenants([]);
      setSelected(-1);
    }
  }, [open]);

  // Rental companies, debounced. Sales agents do not search tenants.
  useEffect(() => {
    const term = sanitize(query);
    if (!open || nav.salesOnly || term.length < 2) {
      setTenants([]);
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const like = `%${term}%`;
      const { data } = await supabase
        .from('tenants')
        .select('id, company_name, slug, contact_email')
        .or(`company_name.ilike.${like},slug.ilike.${like},contact_email.ilike.${like}`)
        .order('company_name', { ascending: true })
        .limit(8);
      if (id !== requestId.current) return;
      setTenants((data as TenantHit[] | null) ?? []);
      setLoading(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open, nav.salesOnly]);

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const pages = nav.all
      .filter((item) => !q || item.name.toLowerCase().includes(q))
      .map<Result>((item) => ({ key: item.href, title: item.name, subtitle: item.href.replace('/admin/', '/'), href: item.href }));
    const companies = tenants.map<Result>((t) => ({
      key: t.id,
      title: t.company_name || t.slug || 'Unnamed company',
      subtitle: [t.slug, t.contact_email].filter(Boolean).join(' · '),
      href: `/admin/rentals/${t.id}`,
    }));
    return [
      ...(companies.length ? [{ key: 'companies', title: 'Rental companies', items: companies }] : []),
      ...(pages.length ? [{ key: 'pages', title: q ? 'Pages' : 'Go to', items: pages }] : []),
    ];
  }, [query, tenants, nav.all]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const go = useCallback(
    (result: Result) => {
      onOpenChange(false);
      router.push(result.href);
    },
    [onOpenChange, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = flat[selected] ?? flat[0];
      if (pick) go(pick);
    }
  };

  const hasQuery = query.trim().length > 0;
  let rowIndex = -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] gap-0 overflow-hidden border-border/70 p-0 shadow-lg">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search rental companies and pages. Use the up and down arrows to move, Enter to open.
        </DialogDescription>
        <div className="flex h-[480px] bg-gradient-to-br from-primary/20 via-primary/10 to-primary/25">
          <div className="flex w-full min-w-0 flex-col bg-background/60 pb-1.5" onKeyDown={onKeyDown}>
            <div className="flex items-center gap-2 border-b px-4 py-3 pr-12">
              <Search className="h-4 w-4 shrink-0 text-primary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(-1);
                }}
                placeholder={nav.salesOnly ? 'Search pages…' : 'Search rental companies, pages…'}
                aria-label="Search"
                className="h-8 w-full min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:font-semibold placeholder:text-foreground/80"
              />
              {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
            </div>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-2 pb-1">
              {!loading && hasQuery && flat.length === 0 && (
                <div className="space-y-2 p-10 text-center">
                  <p className="text-sm font-semibold">No results</p>
                  <p className="text-xs text-muted-foreground">
                    Nothing matches <span className="font-medium text-foreground">&quot;{query}&quot;</span>. Try a company
                    name, its slug or an email.
                  </p>
                </div>
              )}
              {groups.map((group) => (
                <div key={group.key} className="mb-2 last:mb-0">
                  <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                    {group.title}
                  </div>
                  {group.items.map((item) => {
                    rowIndex += 1;
                    const index = rowIndex;
                    const isSelected = index === selected;
                    const Icon = group.key === 'companies' ? Building2 : nav.all.find((n) => n.href === item.href)?.icon;
                    return (
                      <button
                        key={`${group.key}-${item.key}`}
                        type="button"
                        onMouseEnter={() => setSelected(index)}
                        onClick={() => go(item)}
                        className={`group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                          isSelected ? SIDEBAR_HIGHLIGHT_ACTIVE : ''
                        }`}
                      >
                        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-[13px] font-medium ${isSelected ? '' : 'text-foreground'}`}>
                            {item.title}
                          </span>
                          {item.subtitle && (
                            <span className="block truncate text-[11px] text-muted-foreground">{item.subtitle}</span>
                          )}
                        </span>
                        {isSelected && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
