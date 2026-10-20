'use client';

/**
 * /portal/agreements: the operator's Agreements tab
 * (apps/portal/src/components/agreements-v2/agreements-page-v2.tsx), for a
 * customer. Taken piece for piece:
 *
 *   - the header: "Agreements", one line under it, and the one labelled
 *     button top right ("+ Book a car", where the operator sends an
 *     agreement), in the operator's heading and primary-button style;
 *   - the overview row: the shared HeroChart with the shared Agreements
 *     metrics (Agreements sent, with Signed as the second line), and the
 *     companion card; the filter panel is the card's back face, turned by the
 *     top bar's filter button (shared overview-flip);
 *   - the table: the shared Agreements table, with the operator's Customer and
 *     Email swapped for the Company and its main email, and Linked to,
 *     Reference, Sent and Status as the operator has them;
 *   - the drawer: the shared agreement drawer, "Rental agreement", the
 *     document on the left, Details and Activity on the right, Download signed
 *     PDF and New tab at its foot. Signing happens in BoldSign from the
 *     emailed link, so nothing here manages signatures.
 *
 * Every number on the page is this customer's own: the rows come from
 * `useCustomerAgreementsList`, scoped to them and the tenant.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FileSignature, Plus, SearchX } from 'lucide-react-nw';

import { EmptyState, LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
import { QuickBookTrigger } from '@nw/site-v2/quick-book/quick-book-dialog';
import { useTenant } from '@nw/contexts/TenantContext';
import {
  fetchCustomerAgreementDocument,
  fetchCustomerAgreementHistory,
  useCustomerAgreementsList,
} from '@nw/hooks/use-customer-agreements-list';
import { cn } from '@nw/lib/utils';
import { AgreementsTable } from '@portal-v2-shared/agreements/table';
import { AgreementViewDialog } from '@portal-v2-shared/agreements/view-dialog';
import { loadAgreementDocument, type AgreementDocumentSource } from '@portal-v2-shared/agreements/document';
import { agreementMetrics, type AgreementListRow } from '@portal-v2-shared/agreements/list';
import { V2_BUTTON_GHOST_SM, V2_BUTTON_PRIMARY } from '@portal-v2-shared/button-styles';
import { FEATURED_ACTION_CLASS, FeaturedCardFace, FeaturedCardShell } from '@portal-v2-shared/featured-card';
import { HEADER_ACTIONS_V2, HEADER_PRIMARY_V2 } from '@portal-v2-shared/header';
import { HERO_CHART_HEIGHT, HeroChart, HeroRow } from '@portal-v2-shared/hero-chart';
import { useProgressiveRows } from '@portal-v2-shared/list-table';
import { V2_LIST_CLASSES } from '@portal-v2-shared/list-styles';
import { RentalsOverviewFlip } from '@portal-v2-shared/overview-flip';
import { usePageSearch } from '@portal-v2-shared/page-search-slot';

import {
  AgreementsFilterPanel,
  NO_AGREEMENT_FILTERS,
  applyAgreementFilters,
  countActiveAgreementFilters,
  type AgreementFilters,
} from './agreements-filter-panel';

/** Why a rental agreement has nothing to show, in a customer's words. */
function unavailableReason(rawStatus: string | null | undefined): string {
  const status = (rawStatus ?? '').toLowerCase();
  if (status === 'credit_failed' || status === 'send_failed' || status === 'failed') {
    return 'This agreement was never sent. The company will send you a new copy to sign.';
  }
  return 'The document is not ready yet. If it was sent a moment ago, try again shortly.';
}

const CUSTOMER_SOURCE: AgreementDocumentSource = {
  fetchIndividualDocument: fetchCustomerAgreementDocument,
  unavailableReason,
};

export default function PortalAgreementsPage() {
  const { tenant } = useTenant();
  const { rows, isLoading, isError, error, refetch } = useCustomerAgreementsList();

  // The company, as the operator's list names the customer: its name and main email.
  const companyName = tenant?.company_name ?? tenant?.app_name ?? 'Your rental company';
  const companyEmail = tenant?.contact_email ?? null;

  const [term, setTerm] = useState('');
  const [filters, setFilters] = useState<AgreementFilters>(NO_AGREEMENT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewRow, setViewRow] = useState<AgreementListRow | null>(null);

  const shown = useMemo(() => applyAgreementFilters(rows, filters, term), [rows, filters, term]);
  const activeCount = countActiveAgreementFilters(filters);
  const narrowed = activeCount > 0 || term.trim() !== '';
  const noAgreements = !isLoading && !isError && rows.length === 0;
  const progressive = useProgressiveRows(shown, `${term}|${filters.status}|${filters.kind}|${filters.sentFrom?.getTime() ?? ''}|${filters.sentTo?.getTime() ?? ''}`);

  usePageSearch(
    noAgreements
      ? null
      : {
          placeholder: 'Search agreements…',
          value: term,
          onChange: setTerm,
          scopeLabel: 'Agreements',
          resultCount: isLoading ? undefined : shown.length,
          filters: { open: filtersOpen, onOpenChange: setFiltersOpen, activeCount },
        },
  );

  const metrics = useMemo(
    () => agreementMetrics(shown, { sentDescription: `Agreements ${companyName} sent you to sign.` }),
    [shown, companyName],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agreements"
        description="Your agreements for signature, and every one's signed copy."
        actionClassName={HEADER_ACTIONS_V2}
        action={
          <QuickBookTrigger className={cn(V2_BUTTON_PRIMARY, HEADER_PRIMARY_V2, 'flex-1 sm:flex-none')}>
            <Plus aria-hidden />
            Book a car
          </QuickBookTrigger>
        }
      />

      {isError ? (
        <LoadError
          title="We could not load your agreements"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : noAgreements ? (
        <Panel>
          <EmptyState
            icon={FileSignature}
            title="No agreements yet"
            description={`When ${companyName} sends you an agreement to sign, it appears here, and its signed copy stays here afterwards.`}
            action={{ href: '/portal/rentals', label: 'View my rentals' }}
          />
        </Panel>
      ) : (
        <>
          <RentalsOverviewFlip
            flipped={filtersOpen}
            onFlipBack={() => setFiltersOpen(false)}
            front={
              <HeroRow
                chart={
                  isLoading ? (
                    <div className={cn(HERO_CHART_HEIGHT, 'mt-14 w-full animate-pulse rounded-xl bg-v2-muted/60')} aria-hidden />
                  ) : (
                    // The last 12 months, where the operator's opens on 30 days: a
                    // customer is sent a few agreements a year (the canary
                    // customer's five were all sent on Sep 19), so 30 days is
                    // usually an empty window. Every period is still in the picker.
                    <HeroChart metrics={metrics} defaultRange="12m" note={narrowed ? 'Filtered' : undefined} />
                  )
                }
                card={<DocumentsCard />}
              />
            }
            back={<AgreementsFilterPanel filters={filters} onChange={setFilters} onClose={() => setFiltersOpen(false)} />}
          />

          {isLoading ? null : shown.length === 0 ? (
            <Panel>
              <EmptyState
                icon={SearchX}
                title="No agreements match"
                description="Try a different search, or clear the filters to see every agreement."
                action={{
                  label: 'Clear filters',
                  onClick: () => {
                    setFilters(NO_AGREEMENT_FILTERS);
                    setTerm('');
                  },
                }}
              />
            </Panel>
          ) : (
            <section className="flex flex-col gap-3" aria-label="Your agreements">
              <AgreementsTable
                rows={progressive}
                party={{ label: 'Company', name: () => companyName, email: () => companyEmail }}
                onOpen={setViewRow}
              />
              <div className={V2_LIST_CLASSES.footer}>
                <span>
                  {progressive.hasMore
                    ? `Showing ${progressive.visible.length} of ${progressive.total} agreements`
                    : `All ${progressive.total} ${progressive.total === 1 ? 'agreement' : 'agreements'} shown`}
                </span>
                {progressive.hasMore ? (
                  <button type="button" onClick={progressive.showMore} className={cn(V2_BUTTON_GHOST_SM, V2_LIST_CLASSES.showMore)}>
                    Show more
                  </button>
                ) : null}
              </div>
            </section>
          )}
        </>
      )}

      <AgreementViewDialog
        row={viewRow}
        open={!!viewRow}
        onOpenChange={(open) => {
          if (!open) setViewRow(null);
        }}
        loadDocument={(row) => loadAgreementDocument(row, CUSTOMER_SOURCE)}
        fetchHistory={fetchCustomerAgreementHistory}
        party={{ label: 'Company', name: companyName, email: companyEmail }}
        renderHtml={(html) => (
          // An agreement that never reached the signing service exists only as
          // the html that was sent; drawn in a sandboxed frame, no script.
          <iframe title="Agreement" sandbox="" srcDoc={html} className="mx-auto block h-full min-h-[70vh] w-full max-w-[816px] rounded-sm bg-white ring-1 ring-black/10" />
        )}
      />
    </div>
  );
}

/**
 * The companion card, in the slot the operator's "Template Studio" takes:
 * the same shell and face, opening Documents, where the customer's licence,
 * ID and signed copies live.
 */
function DocumentsCard() {
  return (
    <FeaturedCardShell className="lg:min-h-0" aria-label="Your documents">
      <Link href="/portal/documents" className={cn(FEATURED_ACTION_CLASS, 'pb-4')}>
        <FeaturedCardFace title="Your Documents" subtitle="Your licence, ID and every signed copy." />
      </Link>
    </FeaturedCardShell>
  );
}
