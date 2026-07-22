"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useSetupReminder } from "@/hooks/use-setup-reminder";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, ImageIcon, Loader2, ShieldCheck, Upload } from "lucide-react";

/**
 * Logo upload limits. The `company-logos` bucket has NO server-side MIME or
 * size restriction, so these checks are the ONLY gate — not decoration.
 */
const LOGO_MIME_TYPES = ["image/png", "image/jpeg"];
const MAX_LOGO_MB = 5;
const MAX_LOGO_BYTES = MAX_LOGO_MB * 1024 * 1024;

/**
 * "Don't show me again" — permanent, so it must OUTLIVE the browser session.
 * localStorage.
 */
const dismissedKey = (tenantId: string) => `setup-reminder-dismissed-${tenantId}`;

/**
 * Closing the dialog only silences it for the CURRENT portal session, so it
 * comes back every time the tenant opens the portal until the tasks are
 * actually done. Deliberately sessionStorage, not a localStorage timestamp: a
 * 24h clock let a tenant close it once and then not see it again for the rest
 * of the day, including across several fresh logins.
 */
const snoozedKey = (tenantId: string) => `setup-reminder-snoozed-${tenantId}`;

interface ReminderTask {
  key: string;
  label: string;
  description: string;
  path: string;
  icon: React.ReactNode;
  /**
   * When true the row uploads a file in place instead of navigating away.
   * The logo is the one task a tenant can finish without leaving this dialog,
   * and it is the one the sales person most often could not do during the
   * onboarding call — so make it a single click here.
   */
  upload?: boolean;
}

interface ReminderFlags {
  /** Which tenant these flags were read for — guards against a stale render after a tenant switch. */
  tenantId: string;
  permanentlyDismissed: boolean;
  dueBySnooze: boolean;
}

/**
 * Recurring, dismissible nudge shown to a subscribed tenant who still has
 * outstanding setup tasks (logo, Stripe Connect, Bonzah insurance).
 *
 * It can never fight the subscription paywall: it requires a *resolved*,
 * currently-active subscription (`isResolved && isSubscribed`) and explicitly
 * bails when `hasExpiredSubscription` is set — the two states the dashboard
 * layout uses to raise the non-dismissible SubscriptionGateDialog are exactly
 * the states in which this dialog stays closed.
 *
 * Closing it (X / outside-click / escape) silences it for the CURRENT portal
 * session only (sessionStorage), so it reappears every time the tenant opens
 * the portal until Bonzah / logo / Stripe Connect are actually done. "Don't
 * show me again" dismisses it permanently (localStorage). Both keys are
 * per-tenant, so switching tenants re-evaluates from that tenant's own state.
 */
export function SetupReminderDialog() {
  const router = useRouter();
  const { tenant, refetchTenant } = useTenant();
  const queryClient = useQueryClient();
  const { isSubscribed, hasExpiredSubscription, isResolved } =
    useTenantSubscription();
  const { needsLogo, needsStripe, needsBonzah, allDone, isReady } =
    useSetupReminder();

  const tenantId = tenant?.id ?? null;

  // Null until the localStorage read for the *current* tenant has run, so
  // nothing renders before then — avoids an SSR/hydration mismatch, an open
  // flash, and showing tenant B the dialog using tenant A's flags.
  const [flags, setFlags] = useState<ReminderFlags | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !tenantId) {
      setFlags(null);
      return;
    }
    // sessionStorage: cleared when the tab/session ends, so opening the portal
    // again re-shows the reminder. Only "Don't show me again" (localStorage)
    // and actually completing the tasks stop it for good.
    setFlags({
      tenantId,
      permanentlyDismissed:
        localStorage.getItem(dismissedKey(tenantId)) === "true",
      dueBySnooze: sessionStorage.getItem(snoozedKey(tenantId)) !== "true",
    });
  }, [tenantId]);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  /**
   * Upload a logo without leaving the dialog.
   *
   * Writes `tenants.logo_url`, which is exactly what `useSetupReminder` reads
   * for `needsLogo`, so a successful upload makes this row disappear on its
   * own — and closes the dialog entirely once it was the last outstanding task.
   */
  const handleLogoUpload = async (file: File | null) => {
    const clearInput = () => {
      // Reset so re-picking the SAME file after a failure still fires onChange.
      if (logoInputRef.current) logoInputRef.current.value = "";
    };
    if (!file || !tenantId) return;

    if (!LOGO_MIME_TYPES.includes(file.type)) {
      toast({
        title: "Unsupported file",
        description: "Your logo must be a PNG, JPG or JPEG image.",
        variant: "destructive",
      });
      clearInput();
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast({
        title: "File too large",
        description: `Your logo must be ${MAX_LOGO_MB}MB or smaller.`,
        variant: "destructive",
      });
      clearInput();
      return;
    }

    setUploadingLogo(true);
    try {
      const ext = file.type === "image/png" ? "png" : "jpg";
      // Namespaced by tenant so two tenants uploading "logo.png" cannot collide
      // in this shared bucket.
      const path = `tenant-${tenantId}/logo-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("company-logos")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("company-logos").getPublicUrl(path);

      // Mirror the sync in use-tenant-branding.ts: the login page reads
      // auth_logo_url first, the sidebar and booking's header read
      // dark_logo_url, and nothing else in the product ever writes them — so
      // updating logo_url alone leaves those surfaces on the OLD image forever.
      // Only follow columns that were still tracking logo_url (or unset), so a
      // deliberately different dark-mode logo survives.
      const { data: current, error: currentError } = await supabase
        .from("tenants")
        .select("logo_url, dark_logo_url, auth_logo_url")
        .eq("id", tenantId)
        .single();

      const logoPatch: Record<string, string | null> = { logo_url: data.publicUrl };
      // Only sync when we actually read the row. On a failed SELECT every
      // column would look unset and we'd overwrite a deliberate dark logo.
      if (!currentError && current) {
        const tracksLogo = (value: string | null | undefined) =>
          !value || value === current.logo_url;
        // dark_logo_url is CLEARED (readers fall back to logo_url, so one
        // source of truth and no future drift); auth_logo_url is COPIED because
        // the login page branches its layout on whether it is set. See the
        // fuller explanation in use-tenant-branding.ts.
        if (tracksLogo(current.dark_logo_url)) logoPatch.dark_logo_url = null;
        if (tracksLogo(current.auth_logo_url)) logoPatch.auth_logo_url = data.publicUrl;
      }

      // .select() is load-bearing: without it PostgREST answers 204 for an
      // UPDATE that matched ZERO rows, so an RLS refusal (tenants_update_own_or_super
      // filters rather than errors) would leave dbError null and we'd cheerfully
      // toast "Logo uploaded" while logo_url never changed.
      const { data: updated, error: dbError } = await supabase
        .from("tenants")
        .update(logoPatch)
        .eq("id", tenantId)
        .select("id");
      if (dbError) throw dbError;
      if (!updated || updated.length === 0) {
        throw new Error(
          "You don't have permission to update this account's logo. Please ask an admin."
        );
      }

      // Refresh both the reminder's own state and the branding the rest of the
      // portal renders, so the new logo appears immediately. Note refetchTenant()
      // does NOT carry logo_url (portal's TenantContext never selects it) — the
      // tenant-branding invalidation below is what actually repaints the sidebar.
      await refetchTenant();
      queryClient.invalidateQueries({ queryKey: ["setup-reminder", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenant-branding", tenantId] });

      toast({
        title: "Logo uploaded",
        description: "It's now live on your booking site and customer emails.",
      });
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err?.message || "Could not upload your logo. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingLogo(false);
      clearInput();
    }
  };

  // Only surface the tasks that are still outstanding.
  const tasks: ReminderTask[] = [];
  if (needsBonzah) {
    tasks.push({
      key: "bonzah",
      label: "Bonzah insurance",
      description: "Offer collision & liability cover to your customers.",
      path: "/settings?tab=insurance",
      icon: (
        <>
          <img
            src="/bonzah-logo.svg"
            alt="Bonzah"
            className="max-h-5 max-w-full object-contain dark:hidden"
          />
          <img
            src="/bonzah-logo-dark.svg"
            alt="Bonzah"
            className="hidden max-h-5 max-w-full object-contain dark:block"
          />
        </>
      ),
    });
  }
  if (needsLogo) {
    tasks.push({
      key: "logo",
      label: "Upload your logo",
      description: "PNG, JPG or JPEG — brands your site and emails.",
      path: "/settings?tab=branding",
      icon: <ImageIcon className="h-5 w-5 text-muted-foreground" />,
      upload: true,
    });
  }
  if (needsStripe) {
    tasks.push({
      key: "stripe",
      label: "Connect Stripe",
      description: "Accept live payments from your customers.",
      path: "/settings?tab=payments",
      // Real Stripe wordmark rather than a generic card glyph — the row reads as
      // "connect THIS service", matching the Bonzah row above. Sized with
      // max-h/max-w + object-contain (not `h-5 w-auto`) so a wide wordmark
      // letterboxes inside the 36px box instead of overflowing the row.
      icon: (
        <>
          <img
            src="/stripe-wordmark.svg"
            alt="Stripe"
            className="max-h-5 max-w-full object-contain dark:hidden"
          />
          <img
            src="/stripe-wordmark-dark.svg"
            alt="Stripe"
            className="hidden max-h-5 max-w-full object-contain dark:block"
          />
        </>
      ),
    });
  }

  const open =
    // Paywall interlock — never render alongside SubscriptionGateDialog.
    isResolved &&
    isSubscribed &&
    !hasExpiredSubscription &&
    // Setup state must be positively known; an errored query must not nag.
    isReady &&
    !allDone &&
    tasks.length > 0 &&
    !!flags &&
    flags.tenantId === tenantId &&
    !flags.permanentlyDismissed &&
    flags.dueBySnooze;

  // sessionStorage, so it silences the reminder for THIS portal session only —
  // next time the tenant opens the portal it shows again, until the tasks are
  // done or they explicitly pick "Don't show me again".
  const snoozeAndClose = () => {
    if (typeof window !== "undefined" && tenantId) {
      sessionStorage.setItem(snoozedKey(tenantId), "true");
    }
    setFlags((prev) => (prev ? { ...prev, dueBySnooze: false } : prev));
  };

  const dismissForever = () => {
    if (typeof window !== "undefined" && tenantId) {
      localStorage.setItem(dismissedKey(tenantId), "true");
    }
    setFlags((prev) => (prev ? { ...prev, permanentlyDismissed: true } : prev));
  };

  const handleSetup = (path: string) => {
    snoozeAndClose();
    router.push(path);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // X / outside-click / escape → silence for this session only.
        if (!next) snoozeAndClose();
      }}
    >
      {/* max-h + overflow-y is not cosmetic: with all three tasks outstanding the
          dialog is ~428px tall, which overflows a landscape phone (375px). Radix
          centers via translate and locks body scroll, so the overflow clips BOTH
          ends — taking the close button and "Don't show me again" with it and
          leaving the tenant unable to dismiss the dialog at all. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <DialogTitle>Finish setting up your portal</DialogTitle>
          <DialogDescription>
            A few quick steps to get you fully live. Pick up where you left off.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={logoInputRef}
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          className="hidden"
          onChange={(e) => void handleLogoUpload(e.target.files?.[0] ?? null)}
        />

        {/* min-w-0 is required, not cosmetic: DialogContent is `display: grid`,
            and a grid item defaults to `min-width: auto`, so this list would
            refuse to shrink below its content width and spill outside the
            dialog instead of letting the description truncate. */}
        <div className="min-w-0 space-y-2.5">
          {tasks.map((task) => (
            <div
              key={task.key}
              className="flex min-w-0 items-center gap-3 rounded-lg border bg-muted/30 px-3 py-3"
            >
              {/* overflow-hidden matters: the Bonzah asset is a 343x108
                  wordmark, so an unconstrained `h-5 w-auto` renders ~64px wide
                  inside this 36px box and pushed the whole row past the dialog
                  edge. The img is object-contain + max-w-full so it scales to
                  fit instead. */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background">
                {task.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{task.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {task.description}
                </p>
              </div>
              {task.upload ? (
                // Finish this one in place — no navigation, no losing the
                // dialog. The row vanishes by itself once logo_url is set.
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={uploadingLogo}
                  onClick={() => logoInputRef.current?.click()}
                >
                  {uploadingLogo ? (
                    <>
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      Uploading
                    </>
                  ) : (
                    <>
                      <Upload className="mr-1 h-3.5 w-3.5" />
                      Upload
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="shrink-0"
                  onClick={() => handleSetup(task.path)}
                >
                  Set up
                  <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <DialogFooter className="sm:justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground opacity-60 hover:opacity-100"
            onClick={dismissForever}
          >
            Don&apos;t show me again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
