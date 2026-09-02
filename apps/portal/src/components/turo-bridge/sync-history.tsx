/**
 * Screen 5 — Sync history, with honest progress.
 *
 * A PARTIAL RUN MUST LOOK PARTIAL. That is the requirement, and it is harder
 * than it sounds because every instinct in dashboard design pushes the other
 * way: a progress bar wants a denominator, a status column wants a green tick,
 * and a feed that says "total: 8" while returning three records will happily
 * fill both.
 *
 * So every number on this screen comes from `describeJobProgress()`, which
 * takes its denominator from `turo_sync_jobs.progress_denominator` — a
 * GENERATED ALWAYS column Postgres computes and refuses to let any client
 * write, service_role included — and consults `feed_reported_total` for
 * nothing. Green appears only for a run the database itself called complete.
 */
"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CircleSlash,
  FileWarning,
  Layers,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  describeDegradedReason,
  describeHeartbeat,
  describeJobProgress,
  useTuroSyncJobPages,
  useTuroSyncJobs,
  type TuroSyncJob,
} from "@/hooks/use-turo-sync-jobs";
import {
  CoverageReadout,
  EmptyState,
  LoadFailed,
  MonoId,
  Notice,
  SchemaMissing,
  SectionTitle,
  SourceBadge,
  Unknown,
  fmtDateTime,
} from "./shared";

export function SyncHistoryScreen() {
  const jobsQuery = useTuroSyncJobs({ limit: 50 });
  const [detail, setDetail] = useState<TuroSyncJob | null>(null);

  const jobs = jobsQuery.rows;

  const lastAuthoritative = useMemo(
    // observed_complete AND is_authoritative, matching turo_release_block()'s
    // own test (03-foundation-schema.sql:1337). A run whose shape is clean but
    // which parsed zero trips is not evidence about anything.
    () => jobs.find((j) => j.observed_complete === true && j.is_authoritative === true) ?? null,
    [jobs],
  );
  const partialCount = jobs.filter(
    (j) => j.state !== "running" && j.completeness !== "complete",
  ).length;

  if (jobsQuery.schemaMissing) {
    return <SchemaMissing what="Sync history" message={jobsQuery.schemaMissingMessage} />;
  }
  if (jobsQuery.isError) {
    return (
      <LoadFailed
        what="Sync history"
        error={jobsQuery.error}
        onRetry={() => void jobsQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Sync history"
        description="Every attempt to read your Turo calendar, and how much of it each one actually got through."
      />

      {/*
        The single most useful line on the screen. "When did we last get a
        complete picture?" is the question that decides whether anything on the
        other four screens can be trusted, and it deserves to be answered
        without the operator having to read a table.
      */}
      {jobs.length > 0 && (
        <Notice tone={lastAuthoritative ? "info" : "warn"}>
          {lastAuthoritative ? (
            <>
              <span className="font-medium text-foreground">
                Last complete read: {fmtDateTime(lastAuthoritative.finished_at)}
              </span>{" "}
              — that run reached the end of the Turo feed with no errors, so the trips it saw are
              the whole picture for the dates it covered.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">
                No run has ever read your Turo calendar all the way through.
              </span>{" "}
              Every sync so far stopped early or hit a problem, so trips may exist that we have
              never seen. Nothing can be released as cancelled until one run gets through
              cleanly.
            </>
          )}
        </Notice>
      )}

      {partialCount > 0 && (
        <Notice tone="warn">
          {partialCount} of the {jobs.length} runs below were partial. A partial run still adds
          every trip it saw — reading less is never a reason to forget something — but it can
          never be used to prove a trip is gone.
        </Notice>
      )}

      {jobs.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />}
          title="No sync runs recorded"
          body="Open the Drive247 Turo Bridge extension while signed in to turo.com as a host and start a sync. Each attempt is recorded here, whether it succeeds or not."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
                  <TableHead>Started</TableHead>
                  <TableHead>What it read</TableHead>
                  <TableHead className="min-w-[280px]">How much it got</TableHead>
                  <TableHead>Dates covered</TableHead>
                  <TableHead>Can it prove a trip is gone?</TableHead>
                  <TableHead className="text-right">Pages</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id} className="cursor-pointer" onClick={() => setDetail(j)}>
                    <TableCell className="align-top whitespace-nowrap">
                      <div className="text-sm">{fmtDateTime(j.started_at)}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <MonoId value={j.id} />
                        <SourceBadge source={j.source} />
                      </div>
                    </TableCell>

                    <TableCell className="align-top text-sm">
                      <div className="capitalize">{String(j.job_kind).replace(/_/g, " ")}</div>
                      <StateText job={j} />
                    </TableCell>

                    <TableCell className="align-top">
                      <CoverageReadout job={j} />
                    </TableCell>

                    <TableCell className="align-top text-sm">
                      {j.window_start && j.window_end ? (
                        <>
                          <div className="whitespace-nowrap">{fmtDateTime(j.window_start)}</div>
                          <div className="whitespace-nowrap text-muted-foreground">
                            to {fmtDateTime(j.window_end)}
                          </div>
                        </>
                      ) : (
                        <Unknown why="The run did not record which dates it covered, so it proves nothing about any particular trip." />
                      )}
                    </TableCell>

                    {/*
                      `is_authoritative` is generated by Postgres from the raw
                      observations. No client can set it, which is precisely why
                      it is safe to render as a flat yes/no rather than a hint.
                    */}
                    <TableCell className="align-top">
                      {j.is_authoritative ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#16a34a] dark:text-green-400">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                          <CircleSlash className="h-3.5 w-3.5" />
                          No
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="align-top text-right tabular-nums text-sm">
                      {j.pages_fetched}
                      {(j.http_error_count > 0 || j.parse_failure_count > 0) && (
                        <div className="text-xs text-[#d97706] dark:text-orange-400">
                          {j.http_error_count > 0 && `${j.http_error_count} failed`}
                          {j.http_error_count > 0 && j.parse_failure_count > 0 && " · "}
                          {j.parse_failure_count > 0 && `${j.parse_failure_count} unreadable`}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <JobDetailDialog job={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function StateText({ job }: { job: TuroSyncJob }) {
  const heartbeat = describeHeartbeat(job);
  if (job.state === "running") {
    return (
      <span
        className={`text-xs ${
          heartbeat.suspectedStale
            ? "text-[#d97706] dark:text-orange-400"
            : "text-[#2563eb] dark:text-blue-400"
        }`}
        title={heartbeat.note ?? undefined}
      >
        {heartbeat.suspectedStale ? "running — gone quiet" : "running"}
      </span>
    );
  }
  if (job.state === "succeeded") {
    return (
      <span className="text-xs text-muted-foreground">
        finished {job.finished_at ? fmtDateTime(job.finished_at) : ""}
      </span>
    );
  }
  if (job.state === "abandoned") {
    return (
      <span className="text-xs text-[#d97706] dark:text-orange-400">
        abandoned — stopped reporting
      </span>
    );
  }
  return <span className="text-xs text-[#dc2626] dark:text-red-400">failed</span>;
}

/**
 * Per-run detail, including the page-by-page receipts.
 *
 * `byte_count` sitting next to `record_count` is the whole reason this dialog
 * exists: a bot filter's "HTTP 200, valid JSON, zero records" and an honestly
 * empty page are the same two numbers at a glance, but not the same body — so
 * showing both makes the difference visible instead of theoretical.
 * `observed_keys` is the other half: it names the top-level keys Turo actually
 * sent, so a field rename is diagnosable without ever storing guest data.
 */
function JobDetailDialog({ job, onClose }: { job: TuroSyncJob | null; onClose: () => void }) {
  const pages = useTuroSyncJobPages(job?.id);

  if (!job) return null;

  const progress = describeJobProgress(job);
  const degraded = describeDegradedReason(job.degraded_reason);
  const heartbeat = describeHeartbeat(job);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Sync run · {String(job.job_kind).replace(/_/g, " ")}
            <SourceBadge source={job.source} />
          </DialogTitle>
          <DialogDescription>
            Started {fmtDateTime(job.started_at)}
            {job.finished_at ? `, finished ${fmtDateTime(job.finished_at)}` : ", still running"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-md border border-[#f1f5f9] dark:border-border p-4">
            <CoverageReadout job={job} />
          </div>

          {!job.is_authoritative && (
            <Notice tone="warn">
              <span className="font-medium text-foreground">
                This run cannot be used as evidence that a trip has gone.
              </span>{" "}
              {degraded ?? progress.caveat}
            </Notice>
          )}

          {heartbeat.note && <Notice tone="warn">{heartbeat.note}</Notice>}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Metric label="Trips seen" value={String(job.records_seen)} />
            <Metric label="Trips stored" value={String(job.records_ingested)} />
            <Metric
              label="Requests failed"
              value={String(job.http_error_count)}
              tone={job.http_error_count > 0 ? "warn" : "default"}
            />
            <Metric
              label="Unreadable trips"
              value={String(job.parse_failure_count)}
              tone={job.parse_failure_count > 0 ? "warn" : "default"}
            />
          </div>

          {job.feed_reported_total !== null && (
            <p className="text-xs text-muted-foreground">
              Turo&apos;s response claimed a total of {job.feed_reported_total}. That number came
              from the same response as the trips, so it is recorded but never used to decide
              whether the read was finished.
            </p>
          )}

          <div>
            <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              Vehicles this run actually looked at
            </h4>
            {job.observed_turo_vehicle_ids && job.observed_turo_vehicle_ids.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {job.observed_turo_vehicle_ids.map((id) => (
                  <span
                    key={id}
                    className="rounded border border-[#f1f5f9] dark:border-border px-2 py-0.5 font-mono text-xs text-muted-foreground"
                  >
                    {id}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                None recorded. A run that cannot say which cars it looked at can never prove a
                trip on any of them has ended.
              </p>
            )}
          </div>

          <div>
            <h4 className="text-sm font-medium text-foreground mb-2">Page by page</h4>
            {pages.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : pages.schemaMissing ? (
              <p className="text-sm text-muted-foreground">
                Per-page detail is not available on this database yet.
              </p>
            ) : pages.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No page records for this run.</p>
            ) : (
              <div className="rounded-md border border-[#f1f5f9] dark:border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#eef2ff] dark:bg-muted text-left">
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Path</th>
                      <th className="px-3 py-2 font-medium text-right">HTTP</th>
                      <th className="px-3 py-2 font-medium text-right">Bytes</th>
                      <th className="px-3 py-2 font-medium text-right">Trips</th>
                      <th className="px-3 py-2 font-medium">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.rows.map((p) => {
                      // A 200 that parsed fine but carried nothing is the exact
                      // signature this whole design is defensive about, so it is
                      // called out on the row rather than left to be spotted.
                      const suspiciousEmpty =
                        p.http_status === 200 && (p.record_count ?? 0) === 0;
                      return (
                        <tr key={p.id} className="border-t border-[#f1f5f9] dark:border-border">
                          <td className="px-3 py-2 tabular-nums">{p.seq}</td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground break-all">
                            {p.url_path ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {p.http_status ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {p.byte_count ?? "—"}
                          </td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${
                              suspiciousEmpty ? "text-[#d97706] dark:text-orange-400" : ""
                            }`}
                          >
                            {p.record_count ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {p.degraded_reason ? (
                              <span className="text-[#d97706] dark:text-orange-400 inline-flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {describeDegradedReason(p.degraded_reason)}
                              </span>
                            ) : suspiciousEmpty ? (
                              <span className="text-[#d97706] dark:text-orange-400 inline-flex items-center gap-1">
                                <FileWarning className="h-3 w-3" />
                                answered OK with nothing in it
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {job.notes && (
            <div>
              <h4 className="text-sm font-medium text-foreground mb-1">Notes</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{job.notes}</p>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <MonoId value={job.id} chars={16} />
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-medium tabular-nums mt-0.5 ${
          tone === "warn" ? "text-[#d97706] dark:text-orange-400" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
