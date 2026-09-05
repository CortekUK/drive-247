/**
 * Screen 1 — Synced reservations.
 *
 * Every trip the extension has pulled off Turo, filterable by reconciliation
 * state, showing plainly what is merely STAGED (we know about it; it blocks
 * nothing) versus PROMOTED (a real Drive247 booking now exists for it).
 *
 * The distinction is the whole screen. A staged trip is knowledge; a promoted
 * trip is a car taken off sale. An operator who cannot tell the two apart
 * either double-sells a car or leaves it idle, and both cost money.
 *
 * Data comes from `useTuroStagedReservations()`. Every value is read through
 * that hook's tolerant readers, which can each answer "I don't know" — so a
 * Turo field rename or an unapplied migration shows up as a visible gap rather
 * than as a confident default.
 */
"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Car,
  ExternalLink,
  FileWarning,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format-utils";
import {
  TURO_SYNC_STATES,
  TURO_SYNC_STATE_LABEL,
  readHold,
  readSyncState,
  readTuroTripStatus,
  readTuroVehicleId,
  readUnmappedKeys,
  readVehiclePlate,
  useTuroStagedReservations,
  type TuroBridgeRow,
  type TuroSyncState,
} from "@/hooks/use-turo-bridge";
import {
  MonoId,
  Notice,
  SectionTitle,
  SourceBadge,
  SyncStateText,
  TripWindow,
  Unknown,
  fmtDateTime,
} from "./shared";

const COLUMNS = 8;

type StateFilter = TuroSyncState | "all";

export function ReservationsScreen({
  currency,
  onGoToMapping,
}: {
  currency: string;
  onGoToMapping: () => void;
}) {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [detail, setDetail] = useState<TuroBridgeRow | null>(null);

  const {
    rows,
    allRows,
    counts,
    foundationApplied,
    filterUnavailable,
    filterUnavailableReason,
    isLoading,
  } = useTuroStagedReservations({ syncState: stateFilter, search });

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Synced reservations"
        description="Everything the extension has read from your Turo host account. A trip here is knowledge, not a booking — it only takes a car off sale once you import it."
      />

      {/*
        Turo renaming a field is not a crash; it is a quiet degradation, and
        this is where it becomes visible. The unmapped keys are the whole
        "never guess silently" rule made into something an operator can act on.
      */}
      {counts.withUnmappedKeys > 0 && (
        <Notice tone="warn">
          <span className="font-medium text-foreground">
            {counts.withUnmappedKeys} {counts.withUnmappedKeys === 1 ? "trip has" : "trips have"}{" "}
            fields we did not recognise.
          </span>{" "}
          Turo may have renamed something. The trips still landed and nothing was guessed — open a
          row to see exactly which keys were unfamiliar.
        </Notice>
      )}

      {!foundationApplied && allRows.length > 0 && (
        <Notice tone="warn">
          The <span className="font-medium text-foreground">Status</span> column is showing you
          Turo&apos;s own status for each trip. Drive247 has not classified any of these trips
          yet — that part of Turo Sync is not set up on this account — so nothing here tells you
          whether a trip is ready to import or needs a decision from you. It is not the same as
          &ldquo;nothing to do&rdquo;.
        </Notice>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by trip ID, guest, vehicle, plate or status..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground mr-1" />
          <FilterChip
            label="All"
            count={counts.total}
            active={stateFilter === "all"}
            onClick={() => setStateFilter("all")}
          />
          {TURO_SYNC_STATES.map((s) => (
            <FilterChip
              key={s}
              label={TURO_SYNC_STATE_LABEL[s]}
              count={counts.byState[s]}
              active={stateFilter === s}
              onClick={() => setStateFilter(s)}
              disabled={!foundationApplied}
            />
          ))}
          {counts.unknownState > 0 && (
            <span
              className="rounded-md border border-dashed border-[#e0e7ff] px-2.5 py-1 text-xs text-muted-foreground dark:border-border"
              title="Drive247 has not classified these trips, so they cannot be filtered by status."
            >
              Not classified
              <span className="ml-1.5 tabular-nums opacity-70">{counts.unknownState}</span>
            </span>
          )}
        </div>
      </div>

      {/*
        A filter that cannot be evaluated returns an EMPTY list, not an
        unfiltered one. Showing every row under a filtered heading is the same
        class of lie as a progress bar reading 8/8 on a truncated read, so the
        hook refuses and the screen explains the refusal.
      */}
      {filterUnavailable && <Notice tone="warn">{filterUnavailableReason}</Notice>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
                <TableHead>Trip</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Guest</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Turo total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>In Drive247</TableHead>
                <TableHead>Synced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={COLUMNS}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLUMNS} className="text-center py-12">
                    <p className="text-muted-foreground text-sm">
                      {allRows.length === 0
                        ? "No trips have been synced yet."
                        : filterUnavailable
                          ? "This filter cannot be used until Drive247 finishes setting up Turo Sync on this account."
                          : "No trips match this filter."}
                    </p>
                    {allRows.length > 0 && stateFilter !== "all" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2"
                        onClick={() => setStateFilter("all")}
                      >
                        Show all {allRows.length}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <ReservationRow
                    key={r.id}
                    row={r}
                    currency={currency}
                    foundationApplied={foundationApplied}
                    onOpen={() => setDetail(r)}
                    onGoToMapping={onGoToMapping}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ReservationDetailDialog row={detail} currency={currency} onClose={() => setDetail(null)} />
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  disabled,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={
        disabled
          ? "Drive247 has not classified these trips yet, so there is no status to filter by. That part of Turo Sync is not set up on this account."
          : undefined
      }
      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? "border-[#6366f1] bg-[#eef2ff] text-[#4338ca] dark:border-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-300"
          : "border-[#f1f5f9] text-muted-foreground hover:border-[#e0e7ff] dark:border-border"
      }`}
    >
      {label}
      <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function ReservationRow({
  row,
  currency,
  foundationApplied,
  onOpen,
  onGoToMapping,
}: {
  row: TuroBridgeRow;
  currency: string;
  /** False while the reconciliation columns are absent — see the Status cell. */
  foundationApplied: boolean;
  onOpen: () => void;
  onGoToMapping: () => void;
}) {
  const stateReading = readSyncState(row);
  const plate = readVehiclePlate(row);
  const tripStatus = readTuroTripStatus(row);
  const unmapped = readUnmappedKeys(row);
  const hold = readHold(row);
  const amount = row.total_amount == null ? null : Number(row.total_amount);

  return (
    <TableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell className="font-medium align-top">
        <div className="flex items-center gap-2">
          <span>{row.reservation_id}</span>
          {unmapped.keys.length > 0 && (
            <FileWarning
              className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400"
              aria-label={`${unmapped.keys.length} unrecognised fields`}
            />
          )}
        </div>
        {row.superseded_by_reservation_id && (
          <div className="text-xs text-muted-foreground mt-0.5">
            replaced by {row.superseded_by_reservation_id}
          </div>
        )}
      </TableCell>

      <TableCell className="align-top">
        <div className="flex items-start gap-2">
          <Car className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="truncate max-w-[220px]">
              {row.vehicle_label ?? <Unknown why="Turo gave no vehicle label for this trip" />}
            </div>
            {plate.value && (
              <div className="text-xs text-muted-foreground font-mono">{plate.value}</div>
            )}
          </div>
        </div>
      </TableCell>

      <TableCell className="align-top text-sm text-foreground/80">
        {row.guest_name ?? <Unknown why="Turo gave no guest name" />}
      </TableCell>

      <TableCell className="align-top">
        <TripWindow startsAt={row.starts_at} endsAt={row.ends_at} />
        {/*
          "completed" is not terminal: guests extend up to 24h after a trip ends
          and Turo auto-accepts, so a finished trip stays held for 48h.
        */}
        {hold.active && hold.holdUntil && (
          <div className="text-xs text-[#2563eb] dark:text-blue-400 mt-0.5">
            held until {fmtDateTime(hold.holdUntil)}
          </div>
        )}
      </TableCell>

      <TableCell className="align-top text-right tabular-nums">
        {amount != null && Number.isFinite(amount) ? (
          <>
            {formatCurrency(amount, row.currency || currency)}
            {/* Said once per row so nobody reconciles this against Drive247 income. */}
            <div className="text-[11px] text-muted-foreground">collected by Turo</div>
          </>
        ) : (
          <Unknown why="Turo did not give a trip total" />
        )}
      </TableCell>

      {/*
        STATUS, and which of the two statuses leads.

        There are two different facts competing for this cell: what Turo says
        about the trip ("Booked", "Cancelled"), and what Drive247 has decided
        about it ("Ready to import", "Possibly cancelled"). Normally the Drive247
        reading leads, because that is the one the operator acts on here.

        But while the reconciliation columns are absent, EVERY row's Drive247
        reading is "Not classified" — so on a 40-row table the leading line of
        the Status column is forty identical italics, and the one fact that
        actually varies is buried at 11px underneath it. That is a column
        carrying no information at the size it is read at.

        So while `foundationApplied` is false the two swap: Turo's own status
        leads, verbatim, and "Not classified by Drive247 yet" drops to the
        subline. The header stays "Status" in both modes — it is the same
        question, answered by whoever can currently answer it. Nothing is
        hidden and nothing is invented; only the reading order changes.
      */}
      <TableCell className="align-top">
        {!foundationApplied ? (
          <>
            {tripStatus.value ? (
              <span className="text-sm font-medium text-foreground">{tripStatus.value}</span>
            ) : (
              <Unknown why="Turo's own trip status did not survive the read, and Drive247 has not classified this trip yet." />
            )}
            <div
              className="text-xs text-muted-foreground mt-0.5 italic"
              title="Drive247 has not classified this trip yet — that part of Turo Sync is not set up on this account."
            >
              Not classified by Drive247 yet
            </div>
          </>
        ) : (
          <>
            <SyncStateText reading={stateReading} />
            {tripStatus.value && (
              <div className="text-xs text-muted-foreground mt-0.5">
                Turo says: {tripStatus.value}
              </div>
            )}
          </>
        )}
        {stateReading.state === "pending_match" && (
          <button
            type="button"
            className="mt-1 text-xs font-medium text-[#6366f1] hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onGoToMapping();
            }}
          >
            Map the vehicle →
          </button>
        )}
      </TableCell>

      {/*
        Staged versus promoted, stated as a fact about our own database rather
        than as a colour. "Not blocking anything yet" is the sentence that stops
        an operator assuming a synced trip has already reserved the car.
      */}
      <TableCell className="align-top text-sm">
        {row.promoted_rental_id ? (
          <div>
            <span className="text-[#16a34a] dark:text-green-400 font-medium">
              Booking created
            </span>
            <div className="text-xs text-muted-foreground mt-0.5">
              {row.promoted_at ? fmtDateTime(row.promoted_at) : "—"}
            </div>
          </div>
        ) : row.source === "fixture" ? (
          <span className="text-muted-foreground">Demo — never imported</span>
        ) : (
          <span className="text-muted-foreground">Not blocking anything yet</span>
        )}
      </TableCell>

      <TableCell className="align-top text-sm text-muted-foreground whitespace-nowrap">
        <div className="flex items-center gap-2">
          <span>{fmtDateTime(row.synced_at)}</span>
          <SourceBadge source={row.source} />
        </div>
        {row.status === "failed" && (
          <div className="text-xs text-[#dc2626] dark:text-red-400 mt-0.5">sync failed</div>
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * Row detail.
 *
 * The interesting half is the bottom: the keys no extractor claimed, and
 * `field_confidence` (which wire key produced each column, or "unconfirmed").
 * Between them they let an operator — or us, over a support call — see exactly
 * what Turo sent and what we made of it, without anybody having to guess.
 */
function ReservationDetailDialog({
  row,
  currency,
  onClose,
}: {
  row: TuroBridgeRow | null;
  currency: string;
  onClose: () => void;
}) {
  if (!row) return null;

  const unmapped = readUnmappedKeys(row);
  const unmappedValues = (row.unmapped ?? {}) as Record<string, unknown>;
  const confidence = (row.field_confidence ?? {}) as Record<string, unknown>;
  const confidenceKeys = Object.keys(confidence);
  const plate = readVehiclePlate(row);
  const turoVehicleId = readTuroVehicleId(row);
  const tripStatus = readTuroTripStatus(row);
  const hold = readHold(row);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Turo trip {row.reservation_id}
            <SourceBadge source={row.source} />
          </DialogTitle>
          <DialogDescription>
            Read-only. Nothing on this screen writes to Turo, and nothing here has changed a
            Drive247 booking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <DetailGrid
            items={[
              [
                "Drive247 status",
                <SyncStateText key="s" reading={readSyncState(row)} />,
              ],
              [
                "Turo trip status",
                tripStatus.value ? (
                  <span key="ts">
                    {tripStatus.value}
                    <span className="block text-xs text-muted-foreground">
                      read from {tripStatus.matchedKey}
                    </span>
                  </span>
                ) : (
                  <Unknown key="u" why="Turo's own trip status did not survive the read" />
                ),
              ],
              ["Guest", row.guest_name ?? <Unknown key="g" />],
              ["Vehicle label", row.vehicle_label ?? <Unknown key="v" />],
              [
                "Plate",
                plate.value ? (
                  <span key="p">
                    <span className="font-mono">{plate.value}</span>
                    <span className="block text-xs text-muted-foreground">
                      read from {plate.matchedKey}
                    </span>
                  </span>
                ) : (
                  <Unknown key="p2" why="No plate survived the read — the only safe join key is missing" />
                ),
              ],
              ["Turo vehicle id", turoVehicleId.value ?? <Unknown key="tv" />],
              ["Dates", <TripWindow key="d" startsAt={row.starts_at} endsAt={row.ends_at} />],
              [
                "Turo total",
                row.total_amount == null ? (
                  <Unknown key="t" />
                ) : (
                  `${formatCurrency(Number(row.total_amount), row.currency || currency)} (collected by Turo)`
                ),
              ],
              [
                "Held until",
                hold.holdUntil ? (
                  <span key="h">
                    {fmtDateTime(hold.holdUntil)}
                    <span className="block text-xs text-muted-foreground">
                      {hold.computed
                        ? "Calculated as 48h past the trip end — the database has not stored one yet."
                        : "Stored on the row."}{" "}
                      Guests can extend after a trip finishes and Turo auto-accepts.
                    </span>
                  </span>
                ) : (
                  <Unknown key="h2" why="No end date, so no hold can be calculated" />
                ),
              ],
              [
                "Times seen",
                row.seen_count != null ? String(row.seen_count) : <Unknown key="sc" />,
              ],
              [
                "Last seen",
                row.last_seen_at ? fmtDateTime(row.last_seen_at) : <Unknown key="ls" />,
              ],
            ]}
          />

          {row.state_reason && (
            <Notice tone="info">
              <span className="font-medium text-foreground">Why this state: </span>
              {row.state_reason}
            </Notice>
          )}

          {/* THE "never guess silently" panel. */}
          <div>
            <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              Fields we did not recognise
            </h4>
            {unmapped.source === "absent" ? (
              <p className="text-sm text-muted-foreground">
                Not recorded on this row. Unrecognised keys are not being tracked yet, so this
                says nothing about whether there were any.
              </p>
            ) : unmapped.keys.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                None — every key Turo sent was one we know.
              </p>
            ) : (
              <div className="rounded-md border border-[#f1f5f9] dark:border-border overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {unmapped.keys.map((k) => (
                      <tr
                        key={k}
                        className="border-b border-[#f1f5f9] dark:border-border last:border-0"
                      >
                        <td className="px-3 py-2 font-mono text-xs text-foreground align-top w-1/3">
                          {k}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground font-mono break-all">
                          {safeJson(unmappedValues[k])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {confidenceKeys.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">
                Where each value came from
              </h4>
              <div className="rounded-md border border-[#f1f5f9] dark:border-border overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {confidenceKeys.map((k) => (
                      <tr
                        key={k}
                        className="border-b border-[#f1f5f9] dark:border-border last:border-0"
                      >
                        <td className="px-3 py-2 text-xs text-foreground align-top w-1/3">{k}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground font-mono break-all">
                          {safeJson(confidence[k])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <details className="rounded-md border border-[#f1f5f9] dark:border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground select-none">
              Raw Turo record
            </summary>
            <pre className="px-3 pb-3 text-[11px] leading-relaxed font-mono overflow-x-auto text-muted-foreground">
              {safeJson(row.raw)}
            </pre>
          </details>

          <div className="flex items-center justify-between pt-1">
            <MonoId value={row.id} chars={12} />
            {row.promoted_rental_id && (
              <a
                href={`/rentals/${row.promoted_rental_id}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#6366f1] hover:underline"
              >
                Open the Drive247 booking
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailGrid({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      {items.map(([label, value], i) => (
        <div key={i} className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-sm text-foreground mt-0.5 break-words">{value}</div>
        </div>
      ))}
    </div>
  );
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}
