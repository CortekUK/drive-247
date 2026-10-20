'use client';

/**
 * Every rental agreement raised against the customer's bookings.
 *
 * The page is a LIST, not a signing surface. Signing happens in BoldSign, via
 * the link the operator emails, and this portal has no server route that could
 * mint an embedded signing session — see the "what is not here" note at the top
 * of `use-customer-agreements`. So each row states where the document has got
 * to, tells the customer whose move it is, and hands over the signed PDF once
 * there is one. Nothing here pretends to an ability the app does not have.
 *
 * Laid out as an operator v2 list page, like Bookings:
 *   1. the page header (one-line description; no Refresh, the agreements poll
 *      on their own and the page updates once a document is signed);
 *   2. when something needs signing, the operator's Alert saying so, first,
 *      with "Open" taking the customer to that agreement;
 *   3. the count tiles (only once there is more than one agreement);
 *   4. the list, on the shared operator list kit, agreements that need the
 *      customer's signature first; the whole row opens the agreement.
 * Search and filters live in the top bar, as on Bookings: the field filters the
 * list as you type, and its filter button opens the panel above the table.
 */

import { useMemo, useState } from 'react';
import { FileSignature, PenLine, SearchX } from 'lucide-react-nw';

import { formatDate, formatTimestamp } from '@nw/components/portal/format';
import { formatBookingDates } from '@nw/portal-v2/bookings/format';
import { EmptyState, LoadError, PageHeader, Panel, StatTile } from '@nw/portal-v2/primitives';
import { useCustomer } from '@nw/hooks/use-customer';
import { useCustomerAgreements, type CustomerAgreement } from '@nw/hooks/use-customer-agreements';
import { useCustomerRentals } from '@nw/hooks/use-customer-rentals';
import { cn } from '@nw/lib/utils';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@portal-v2-shared/alert';
import { V2_BUTTON_PRIMARY } from '@portal-v2-shared/button-styles';
import { HEADER_PRIMARY_V2 } from '@portal-v2-shared/header';
import {
  ListBody,
  ListCell,
  ListHead,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
} from '@portal-v2-shared/list-table';
import { V2_LIST_CLASSES, type V2ListTone } from '@portal-v2-shared/list-styles';
import { usePageSearch } from '@portal-v2-shared/page-search-slot';

import { AgreementDialog, agreementTitle } from './agreement-dialog';
import { STATE_CHIP } from './agreement-state';
import {
  AgreementsFilterPanel,
  NO_AGREEMENT_FILTERS,
  applyAgreementFilters,
  countActiveAgreementFilters,
  type AgreementFilters,
} from './agreements-filter-panel';

/** The state chip's tone, in the operator list palette. */
const TONE: Record<string, V2ListTone> = {
  neutral: 'muted',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'brand',
};

/** As on Bookings: every cell one line, columns sized for their longest value at this floor. */
const MIN_WIDTH = 'min-w-[960px]';

function Heads() {
  return (
    <ListTableHeader>
      <ListHead className="w-[11%]">Reference</ListHead>
      <ListHead className="w-[18%]">Agreement</ListHead>
      <ListHead className="w-[19%]">Vehicle</ListHead>
      <ListHead className="w-[21%]">Dates</ListHead>
      <ListHead className="w-[13%]">Signed</ListHead>
      <ListHead className="w-[18%]">Status</ListHead>
    </ListTableHeader>
  );
}

function datesOf(agreement: CustomerAgreement): string | null {
  if (agreement.kind === 'extension') {
    const to = formatDate(agreement.periodEndDate);
    return to ? `Extended to ${to}` : null;
  }
  return agreement.rentalStartDate ? formatBookingDates(agreement.rentalStartDate, agreement.rentalEndDate) : null;
}

/** Sized like the tiles and the table, so the page does not jump on load. */
function AgreementsSkeleton() {
  const rows = useProgressiveRows([0, 1, 2], 'skeleton');
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((tile) => (
          <div
            key={tile}
            className={cn('h-[84px] animate-pulse rounded-2xl bg-v2-muted', tile === 2 && 'col-span-2 sm:col-span-1')}
          />
        ))}
      </div>
      <ListTable rows={{ ...rows, hasMore: false }} minWidth={MIN_WIDTH}>
        <Heads />
        <ListBody>
          {rows.visible.map((row) => (
            <ListRow key={row}>
              {[14, 30, 28, 34, 20, 26].map((width, cell) => (
                <ListCell key={cell}>
                  <span
                    className="inline-block h-3 animate-pulse rounded-full bg-v2-muted"
                    style={{ width: `${width * 4}px`, maxWidth: '100%' }}
                  />
                </ListCell>
              ))}
            </ListRow>
          ))}
        </ListBody>
      </ListTable>
    </div>
  );
}

export default function PortalAgreementsPage() {
  const { email } = useCustomer();
  const { agreements, summary, isLoading, isError, error, refetch } = useCustomerAgreements();
  // The same cached query the hook already reads — free here, and it lets the
  // empty state tell a customer with no bookings something different from one
  // whose operator simply has not raised a document yet.
  const { summary: rentalSummary } = useCustomerRentals('all');

  const [openId, setOpenId] = useState<string | null>(null);
  // Looked up by id on every render, so a background poll that moves the
  // agreement on (signed, PDF filed) shows up inside an open dialog too.
  const open = openId ? (agreements.find((row) => row.id === openId) ?? null) : null;

  const [term, setTerm] = useState('');
  const [filters, setFilters] = useState<AgreementFilters>(NO_AGREEMENT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // What needs the customer first, then the rest in the order they came.
  const ordered = useMemo(
    () => [...agreements.filter((row) => row.needsSignature), ...agreements.filter((row) => !row.needsSignature)],
    [agreements],
  );
  const shown = useMemo(() => applyAgreementFilters(ordered, filters, term), [ordered, filters, term]);
  const activeCount = countActiveAgreementFilters(filters);
  const narrowed = activeCount > 0 || term.trim() !== '';
  const rows = useProgressiveRows(shown, `${term}|${filters.state}|${filters.kind}`);

  usePageSearch({
    placeholder: 'Search agreements…',
    value: term,
    onChange: setTerm,
    scopeLabel: 'Agreements',
    resultCount: isLoading ? undefined : shown.length,
    filters: { open: filtersOpen, onOpenChange: setFiltersOpen, activeCount },
  });

  const hasBookings = rentalSummary.total > 0;
  const awaiting = ordered.filter((row) => row.needsSignature);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Agreements" description="Your rental agreements and signed copies" />

      {isError ? (
        <LoadError
          title="We could not load your agreements"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : isLoading ? (
        <AgreementsSkeleton />
      ) : agreements.length === 0 ? (
        <Panel>
          <EmptyState
            icon={FileSignature}
            title={hasBookings ? 'Nothing to sign right now' : 'No agreements yet'}
            description={
              hasBookings
                ? 'None of your bookings has an agreement raised against it yet. If you have just booked, give it a few minutes — it will appear here, and we will email you when it is ready to sign.'
                : 'When you book a car, the rental agreement you need to sign appears here — and your signed copy stays here afterwards.'
            }
            action={
              hasBookings
                ? { href: '/portal/bookings', label: 'View my bookings' }
                : { href: '/booking', label: 'Browse the fleet' }
            }
          />
        </Panel>
      ) : (
        <>
          {/* The one thing to do on this page, when there is one: first. */}
          {awaiting.length > 0 ? (
            <Alert>
              <PenLine aria-hidden />
              <AlertTitle>
                {awaiting.length === 1
                  ? 'One agreement needs your signature'
                  : `${awaiting.length} agreements need your signature`}
              </AlertTitle>
              <AlertDescription>
                We emailed you a signing link{email ? ` at ${email}` : ''}. This page updates once you have signed.
              </AlertDescription>
              <AlertAction>
                <button
                  type="button"
                  onClick={() => setOpenId(awaiting[0].id)}
                  className={cn(V2_BUTTON_PRIMARY, HEADER_PRIMARY_V2)}
                >
                  Open
                </button>
              </AlertAction>
            </Alert>
          ) : null}

          {/* Only worth its space once there is more than one row: "1, 0, 1"
              restates the single row beneath it in three tiles. */}
          {agreements.length > 1 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile label="Agreements" value={summary.total} />
              <StatTile label="Signed" value={summary.signed} />
              <div className="col-span-2 sm:col-span-1">
                <StatTile
                  label="Awaiting you"
                  value={summary.awaiting}
                  caption={summary.awaiting > 0 ? 'Needs your signature' : 'All up to date'}
                />
              </div>
            </div>
          ) : null}

          {filtersOpen ? (
            <AgreementsFilterPanel filters={filters} onChange={setFilters} onClose={() => setFiltersOpen(false)} />
          ) : null}

          <section className="flex flex-col gap-3">
            {shown.length === 0 ? (
              <Panel>
                <EmptyState
                  icon={SearchX}
                  title="No agreements match"
                  description="Try a different search, or clear the filters to see every agreement."
                />
              </Panel>
            ) : (
              <>
                <ListTable rows={rows} fillViewport minWidth={MIN_WIDTH}>
                  <Heads />
                  <ListBody>
                    {rows.visible.map((agreement) => (
                      <AgreementRow key={agreement.id} agreement={agreement} onOpen={() => setOpenId(agreement.id)} />
                    ))}
                  </ListBody>
                </ListTable>
                <p className={V2_LIST_CLASSES.footer}>
                  {narrowed
                    ? `${shown.length} of ${agreements.length} agreements shown`
                    : `All ${agreements.length} ${agreements.length === 1 ? 'agreement' : 'agreements'} shown`}
                </p>
              </>
            )}
          </section>
        </>
      )}

      <AgreementDialog
        agreement={open}
        email={email}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
      />
    </div>
  );
}

/** One agreement, one line per cell, as on Bookings. The whole row opens it; the reference is a real button for the keyboard. */
function AgreementRow({ agreement, onOpen }: { agreement: CustomerAgreement; onOpen: () => void }) {
  const chip = STATE_CHIP[agreement.state];
  const title = agreementTitle(agreement);
  return (
    <ListRow onOpen={onOpen}>
      <ListCell>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          aria-label={`Open ${title} ${agreement.rentalReference ?? ''}`.trim()}
          className={cn(V2_LIST_CLASSES.identifier, 'truncate text-left hover:underline')}
        >
          {agreement.rentalReference ?? '—'}
        </button>
      </ListCell>
      <ListCell className={cn(V2_LIST_CLASSES.text, 'truncate')}>{title}</ListCell>
      <ListCell className={cn(V2_LIST_CLASSES.text, 'truncate')}>{agreement.vehicleLabel ?? '—'}</ListCell>
      <ListCell className={cn(V2_LIST_CLASSES.text, 'truncate')}>{datesOf(agreement) ?? '—'}</ListCell>
      <ListCell className={cn(V2_LIST_CLASSES.text, 'truncate tabular-nums')}>
        {formatTimestamp(agreement.completedAt) ?? <span className="text-v2-muted-fg">—</span>}
      </ListCell>
      <ListCell className="truncate" title={chip.label}>
        <ListStatusText tone={TONE[chip.tone]}>{chip.label}</ListStatusText>
      </ListCell>
    </ListRow>
  );
}
