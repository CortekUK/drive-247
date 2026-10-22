'use client';

/**
 * /portal/agreements: the operator's Agreements tab
 * (apps/portal/src/components/agreements-v2/agreements-page-v2.tsx), for a
 * customer. Taken piece for piece:
 *
 *   - the header: "Agreements" and one line under it, in the operator's
 *     heading style. No graph and no "+ Book a car" (owner, Oct 21 2026:
 *     booking lives in the rail only);
 *   - the filter panel: opened by the top bar's filter button, it sits
 *     above the table while open;
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
import { FileSignature, SearchX } from 'lucide-react-nw';

import { EmptyState, LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
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
import {
  AGREEMENT_LINK_LABEL,
  AGREEMENT_STATUS_LABEL,
  AGREEMENT_STATUS_TONE,
  agreementReference,
  formatAgreementSentAt,
  type AgreementListRow,
} from '@portal-v2-shared/agreements/list';
import { V2_BUTTON_GHOST_SM } from '@portal-v2-shared/button-styles';
import { useProgressiveRows } from '@portal-v2-shared/list-table';
import { V2_LIST_CLASSES, V2_LIST_TONES } from '@portal-v2-shared/list-styles';
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Agreements" description="Your agreements for signature, and every one's signed copy." />

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
          {filtersOpen ? (
            <AgreementsFilterPanel filters={filters} onChange={setFilters} onClose={() => setFiltersOpen(false)} />
          ) : null}

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
              {/* Phone: a list, not a table squeezed sideways — every row says
                  the same company, so a row is its reference, status and date. */}
              <AgreementsPhoneList rows={progressive.visible} onOpen={setViewRow} />
              <div className="max-md:hidden">
                <AgreementsTable
                  rows={progressive}
                  party={{ label: 'Company', name: () => companyName, email: () => companyEmail, emailLabel: 'Company email' }}
                  onOpen={setViewRow}
                />
              </div>
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
        party={{ label: 'Company', name: companyName, email: companyEmail, emailLabel: 'Company email' }}
        renderHtml={(html) => (
          // An agreement that never reached the signing service exists only as
          // the html that was sent; drawn in a sandboxed frame, no script.
          <iframe title="Agreement" sandbox="" srcDoc={html} className="mx-auto block h-full min-h-[70vh] w-full max-w-[816px] rounded-sm bg-white ring-1 ring-black/10" />
        )}
      />
    </div>
  );
}

function AgreementsPhoneList<T extends AgreementListRow>({ rows, onOpen }: { rows: readonly T[]; onOpen: (row: T) => void }) {
  const now = new Date();
  return (
    <ul className="divide-y divide-pv-border overflow-hidden rounded-2xl border border-pv-border bg-pv-card md:hidden">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            onClick={() => onOpen(row)}
            className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 active:bg-pv-hover motion-reduce:transition-none"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-pv-fg">{agreementReference(row) ?? 'Agreement'}</span>
              <span className="mt-0.5 block truncate text-[13px] text-pv-muted-fg">
                {AGREEMENT_LINK_LABEL[row.kind]} · Sent {formatAgreementSentAt(row.sentAt, now)}
              </span>
            </span>
            <span className={cn('shrink-0 text-[13px] font-medium', V2_LIST_TONES[AGREEMENT_STATUS_TONE[row.status]])}>
              {AGREEMENT_STATUS_LABEL[row.status]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
