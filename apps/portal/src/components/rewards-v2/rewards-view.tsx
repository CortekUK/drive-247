"use client";

/**
 * Rewards — the operator's Creator Rewards page (v2 only; the route gates it).
 *
 * Post a video about Drive247, paste the link here, and Drive247 reviews it.
 * Approved → a discount on the next Drive247 invoice. Rejected → the reviewer's
 * message shows on the submission below (and in the notification bell).
 *
 * Every limit shown here is also enforced by `submit_creator_reward()`; the
 * client-side checks only save a round trip and explain the disabled button.
 */

import { useMemo, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Gift,
  Link2,
  Loader2,
  MessageSquareWarning,
  Send,
  Sparkles,
  Video,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui-v2/badge";
import { Button } from "@/components/ui-v2/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui-v2/card";
import { Input } from "@/components/ui-v2/input";
import { Label } from "@/components/ui-v2/label";
import { Skeleton } from "@/components/ui-v2/skeleton";
import { Textarea } from "@/components/ui-v2/textarea";
import { SettingsLoadError } from "@/components/settings-v2/section-states";
import {
  CREATOR_PLATFORMS,
  useCreatorRewardSettings,
  useCreatorRewardSubmissions,
  useSubmitCreatorReward,
  type CreatorRewardSubmission,
} from "@/hooks/use-creator-rewards";

const LINK = "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]";

/** Mirrors `creator_reward_platform()` — only to explain a bad link early. */
function platformOf(url: string): string | null {
  const m = /^https:\/\/([^/?#:]+)/i.exec(url.trim());
  if (!m) return null;
  const host = m[1].toLowerCase().replace(/^(www\.|m\.|mobile\.)/, "");
  if (["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"].includes(host)) return "tiktok";
  if (host === "instagram.com") return "instagram";
  if (["youtube.com", "youtu.be"].includes(host)) return "youtube";
  if (["facebook.com", "fb.watch", "fb.com"].includes(host)) return "facebook";
  if (["x.com", "twitter.com"].includes(host)) return "x";
  if (host === "linkedin.com") return "linkedin";
  return null;
}

function monthStart(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function rewardLabel(type: "free_month" | "percent" | null, percent: number | null) {
  if (type === "free_month") return "a free month";
  if (type === "percent") return `${percent}% off`;
  return "a reward";
}

export function RewardsView() {
  const settingsQ = useCreatorRewardSettings();
  const subsQ = useCreatorRewardSubmissions();
  const submit = useSubmitCreatorReward();

  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const settings = settingsQ.data;
  const subs = useMemo(() => subsQ.data ?? [], [subsQ.data]);

  const since = monthStart();
  const usedThisMonth = subs.filter((s) => s.created_at >= since).length;
  const pending = subs.filter((s) => s.status === "pending").length;
  const earned = subs.filter((s) => s.status === "approved").length;

  // One reward per account: once one video is approved, the form closes.
  const blockedReason = !settings
    ? null
    : earned > 0
      ? "You've already received your creator reward — it's one per account. Thank you for sharing Drive247!"
      : !settings.enabled
      ? "The programme is paused right now. Please check back soon."
      : usedThisMonth >= settings.monthly_submission_limit
        ? `You've used all ${settings.monthly_submission_limit} submission${settings.monthly_submission_limit === 1 ? "" : "s"} for this month. You can submit again next month.`
        : pending >= settings.max_pending_per_tenant
          ? "You'll be able to submit another link once your pending video is reviewed."
          : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const value = url.trim();
    if (!/^https:\/\//i.test(value)) {
      setFormError("Paste the full link to your post, starting with https://");
      return;
    }
    const platform = platformOf(value);
    if (!platform || (settings && !settings.allowed_platforms.includes(platform))) {
      setFormError(
        `That link isn't from a supported platform. We accept ${(settings?.allowed_platforms ?? [])
          .map((p) => CREATOR_PLATFORMS[p] ?? p)
          .join(", ")}.`,
      );
      return;
    }
    try {
      await submit.mutateAsync({ url: value, note: note.trim() || undefined });
      setUrl("");
      setNote("");
      toast.success("Video submitted", { description: "We'll review it and let you know here." });
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  if (settingsQ.error || subsQ.error) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <SettingsLoadError
          thing="your rewards"
          error={(settingsQ.error ?? subsQ.error) as Error}
          onRetry={() => {
            void settingsQ.refetch();
            void subsQ.refetch();
          }}
        />
      </div>
    );
  }

  const loading = settingsQ.isLoading || subsQ.isLoading;
  const defaultReward = settings ? rewardLabel(settings.default_reward_type, settings.default_reward_percent) : "";
  const rules = (settings?.rules ?? "").split("\n").map((r) => r.trim()).filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-6 px-1 pb-6 md:pt-[23.25px]">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight">Rewards</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Make a video about Drive247, share the link, and earn money off your subscription.
        </p>
      </div>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className={cn("h-4 w-4", LINK)} />
            Creator Rewards Programme
          </CardTitle>
          <CardDescription>
            {loading ? (
              <Skeleton className="h-4 w-64" />
            ) : (
              <>
                An approved video usually earns <strong className="text-foreground">{defaultReward}</strong> on your next
                Drive247 invoice. One reward per account.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: Video, title: "Post a video", body: "Share your experience with Drive247 on a public account." },
              { icon: Link2, title: "Submit the link", body: "Paste the link to your post below." },
              { icon: Gift, title: "Get rewarded", body: "Once approved, the discount comes off your next invoice." },
            ].map((step, i) => (
              <li key={step.title} className="rounded-2xl bg-muted/50 p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold">
                    {i + 1}
                  </span>
                  <step.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="mt-3 text-sm font-medium">{step.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Submit */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submit a video</CardTitle>
            <CardDescription>
              {settings
                ? `${usedThisMonth} of ${settings.monthly_submission_limit} submission${settings.monthly_submission_limit === 1 ? "" : "s"} used this month`
                : " "}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reward-url">Link to your post</Label>
                <Input
                  id="reward-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://www.tiktok.com/@yourbusiness/video/…"
                  value={url}
                  disabled={!!blockedReason || submit.isPending}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setFormError(null);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reward-note">Anything we should know? (optional)</Label>
                <Textarea
                  id="reward-note"
                  rows={3}
                  maxLength={500}
                  placeholder="e.g. Posted on our business TikTok"
                  value={note}
                  disabled={!!blockedReason || submit.isPending}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {formError && (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              )}
              {blockedReason && <p className="text-sm text-muted-foreground">{blockedReason}</p>}

              <Button type="submit" disabled={!url.trim() || !!blockedReason || submit.isPending || loading}>
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Submit for review
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Rules */}
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-base">Rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            ) : (
              <ul className="space-y-2 text-sm text-muted-foreground">
                {rules.map((r) => (
                  <li key={r} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
            {settings && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Accepted platforms</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {settings.allowed_platforms.map((p) => (
                    <Badge key={p} variant="secondary">
                      {CREATOR_PLATFORMS[p] ?? p}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Submissions */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium tracking-tight text-muted-foreground">Your submissions</h2>
          {earned > 0 && (
            <span className="text-xs text-muted-foreground">
              {earned} reward{earned === 1 ? "" : "s"} earned
            </span>
          )}
        </div>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        ) : subs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card px-6 py-10 text-center ring-1 ring-foreground/5 dark:ring-foreground/10">
            <Video className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">No videos submitted yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              When you submit a link it shows up here, along with its review status and any message from our team.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {subs.map((s) => (
              <SubmissionRow key={s.id} s={s} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: CreatorRewardSubmission["status"] }) {
  if (status === "approved")
    return (
      <Badge variant="success">
        <CheckCircle2 /> Approved
      </Badge>
    );
  if (status === "rejected")
    return (
      <Badge variant="destructive">
        <XCircle /> Rejected
      </Badge>
    );
  return (
    <Badge className="bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
      <Clock /> Pending review
    </Badge>
  );
}

function SubmissionRow({ s }: { s: CreatorRewardSubmission }) {
  return (
    <li className="rounded-2xl bg-card p-4 ring-1 ring-foreground/5 dark:ring-foreground/10 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{CREATOR_PLATFORMS[s.platform] ?? s.platform}</Badge>
            <span>Submitted {formatDate(s.created_at)}</span>
          </div>
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={cn("mt-2 inline-flex max-w-full items-center gap-1 text-sm hover:underline", LINK)}
          >
            <span className="truncate">{s.url.replace(/^https:\/\/(www\.)?/, "")}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
          {s.note && <p className="mt-1 text-xs text-muted-foreground">“{s.note}”</p>}
        </div>
        <StatusPill status={s.status} />
      </div>

      {s.status === "pending" && (
        <p className="mt-3 text-xs text-muted-foreground">Our team is reviewing your video. We'll update this as soon as it's done.</p>
      )}

      {s.status === "approved" && (
        <div className="mt-4 rounded-xl bg-green-600/10 p-3 text-sm dark:bg-green-500/15">
          <p className="flex items-center gap-2 font-medium text-green-800 dark:text-green-300">
            <Gift className="h-4 w-4" />
            You earned {rewardLabel(s.reward_type, s.reward_percent)}
            {s.reward_type === "free_month" ? "" : " your next invoice"}
          </p>
          <p className="mt-1 text-xs text-green-800/80 dark:text-green-300/80">
            {s.reward_status === "applied"
              ? "It will come off your next Drive247 invoice automatically."
              : "We'll apply it to your next Drive247 invoice."}
          </p>
          {s.admin_message && <p className="mt-2 whitespace-pre-wrap text-foreground">{s.admin_message}</p>}
        </div>
      )}

      {s.status === "rejected" && (
        <div className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm dark:bg-destructive/20">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <MessageSquareWarning className="h-4 w-4" />
            Message from the Drive247 team
          </p>
          <p className="mt-1 whitespace-pre-wrap text-foreground">
            {s.admin_message || "This submission couldn't be approved."}
          </p>
          {s.reviewed_at && <p className="mt-2 text-xs text-muted-foreground">Reviewed {formatDate(s.reviewed_at)}</p>}
        </div>
      )}
    </li>
  );
}
