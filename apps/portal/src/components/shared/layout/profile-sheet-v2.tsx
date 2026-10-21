"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Key, Loader2, ShieldCheck } from "lucide-react";

import { useAuth, useAuthStore } from "@/stores/auth-store";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui-v2/avatar";
import { Badge } from "@/components/ui-v2/badge";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { CodeInput } from "@/components/ui-v2/code-input";
import { Label } from "@/components/ui-v2/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { toast } from "@/hooks/use-toast";
import { AvatarCropDialogV2 } from "./avatar-crop-dialog-v2";
import { PasswordChangePanelV2 } from "./password-change-panel-v2";

/**
 * The v2 profile — photo, display name, email and password, in a centred
 * dialog.
 *
 * ── A DIALOG, NOT A SHEET ─────────────────────────────────────────────────
 * It was briefly a full-width sheet from the top (Sep 20 2026). That stretched
 * a four-field form across the whole window, so it is back to a centred
 * `ui-v2/dialog` (Ghulam, Oct 16 2026): pop-ups in v2 are dialogs.
 *
 * ── WHY IT IS ITS OWN FILE ────────────────────────────────────────────────
 * It lived inside `user-menu-v2.tsx`, which was carrying a dropdown, a profile
 * dialog, a password dialog and an avatar cropper in one 600-line component.
 * Adding email and password verification to that would have made the menu a
 * file nobody wants to open. The menu now owns the menu; this owns the
 * profile.
 *
 * ── THE NAME BUG THIS FIXES ───────────────────────────────────────────────
 * Reported as "it still says Super Admin after saving a name", and it was
 * real. The old Save wrote `tenants.admin_name` — the ORGANISATION's admin
 * contact — while every place that shows a person's name (the sidebar row, the
 * menu header, this panel) reads `app_users.name`. So the write succeeded, the
 * toast said so, and nothing on screen changed.
 *
 * It is now written where it is read: `app_users.name`, scoped to the signed-
 * in user's own row, with the auth store updated in the same breath so the
 * sidebar and menu repaint immediately rather than at the next sign-in.
 *
 * `tenants.admin_name` is still written, but ONLY for a head admin who is not
 * a super admin, and for a different reason: the dashboard greeting reads
 * `tenant.admin_name || appUser.name`, so leaving it behind would have fixed
 * the sidebar and left the greeting stale. It is deliberately NOT written by
 * anyone else — an ops user renaming themselves must not rename the operator's
 * admin contact, and a super admin looking at a tenant must not rename theirs
 * at all.
 *
 * ── EMAIL AND PASSWORD: SIX-DIGIT CODES, CHECKED BY SUPABASE ─────────────
 * Every confirmation here is a code typed into this dialog, never a link
 * (Ghulam, Oct 16 2026). The codes are Supabase's own OTPs; `custom-auth-email`
 * only formats them — a `redirect_to` carrying `otp=1` asks it for a code
 * instead of a button.
 *
 * EMAIL — `auth.updateUser({ email })` emails ONE code, to the NEW address,
 * and the address changes once it is checked with
 * `verifyOtp({ type: "email_change", email: <new address>, token })`.
 * "Secure email change" (a code to the old address as well) was switched off
 * in Supabase on purpose (Ghulam, Oct 16 2026): an operator whose old inbox
 * is gone could otherwise never move their account. Turning it back on means
 * restoring the second code box here.
 *
 * PASSWORD — proven with a sign-in code to the account's own address
 * (`signInWithOtp`, `shouldCreateUser: false`), checked with
 * `verifyOtp({ type: "email" })`, and only then `updateUser({ password })`.
 * Supabase's own reauthentication nonce was not used: with "Secure password
 * change" it is only enforced for sessions older than 24h, so a code asked for
 * every time would go unchecked most of the time. This one is always checked.
 * It also works for someone who signed up with Google and has no password yet.
 *
 * `app_users.email` is a SEPARATE copy of the auth address, and it is what the
 * portal displays. It is written the moment the change completes here, and the
 * panel still reconciles on open in case a change finished somewhere else.
 */
export function ProfileSheetV2({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { appUser } = useAuth();

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [email, setEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  /** The address a change was requested to; set once its code is out. */
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [newEmailCode, setNewEmailCode] = useState("");
  const [verifyingEmail, setVerifyingEmail] = useState(false);

  const [showPassword, setShowPassword] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [showCrop, setShowCrop] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Seed from the row every time the panel opens, and clear whatever the last
  // visit left behind — a half-typed password especially.
  useEffect(() => {
    if (!open) return;
    setName(appUser?.name ?? "");
    setEmail(appUser?.email ?? "");
    resetEmailChange();
    setShowPassword(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Bring `app_users.email` back in line with the address Supabase Auth
   * actually holds — see the header. Runs on open, silently: a failure here
   * must not stop someone editing their name.
   */
  useEffect(() => {
    if (!open || !appUser?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        const authEmail = data?.user?.email;
        if (error || !authEmail || cancelled) return;
        if (authEmail.toLowerCase() === (appUser.email ?? "").toLowerCase()) return;

        // The verified address, copied by the server — app_users.email is not
        // a column a user may write (migration 20261016170000).
        const { error: writeError } = await (supabase as any).rpc("sync_my_app_user_email");
        if (writeError || cancelled) return;

        useAuthStore.setState({
          appUser: { ...appUser, email: authEmail },
        });
        setEmail(authEmail);
      } catch {
        /* offline, or auth unavailable — the panel still works. */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appUser?.id]);

  const initials = (appUser?.name || appUser?.email || "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const pickFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Error", description: "Please upload an image file", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Error", description: "Image must be less than 5MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(reader.result as string);
      setShowCrop(true);
    };
    reader.readAsDataURL(file);
  };

  const uploadCropped = useCallback(
    async (blob: Blob) => {
      if (!appUser?.id) return;
      setUploading(true);
      try {
        const filePath = `avatars/${appUser.id}-${Date.now()}.png`;

        const { error: uploadError } = await supabase.storage
          .from("cms-media")
          .upload(filePath, blob, { upsert: true, contentType: "image/png" });
        if (uploadError) throw uploadError;

        const {
          data: { publicUrl },
        } = supabase.storage.from("cms-media").getPublicUrl(filePath);

        // Scoped by the row's own primary key, which belongs to the signed-in
        // user — this writes to nobody else's profile.
        const { error: updateError } = await (supabase as any)
          .from("app_users")
          .update({ avatar_url: publicUrl })
          .eq("id", appUser.id);
        if (updateError) throw updateError;

        // `useAuth` is a selector wrapper, not the store — `useAuth.setState`
        // is undefined at runtime and threw here on every avatar upload. The
        // store itself carries setState, and this is what makes the new photo
        // appear in the sidebar and the menu without a reload.
        useAuthStore.setState({ appUser: { ...appUser, avatar_url: publicUrl } });

        toast({ title: "Photo updated", description: "Looking good." });
        setShowCrop(false);
        setCropSrc(null);
      } catch (error: any) {
        console.error("Avatar upload error:", error);
        toast({
          title: "Error",
          description: error?.message || "Failed to upload photo",
          variant: "destructive",
        });
      } finally {
        setUploading(false);
      }
    },
    [appUser]
  );

  const saveName = async () => {
    const next = name.trim();
    if (!appUser?.id) return;
    if (!next) {
      toast({ title: "Error", description: "Name cannot be empty", variant: "destructive" });
      return;
    }

    setSavingName(true);
    try {
      // Where the name is READ from — see the header. Scoped to this user's
      // own row by its primary key.
      const { error } = await (supabase as any)
        .from("app_users")
        .update({ name: next })
        .eq("id", appUser.id);
      if (error) throw error;

      useAuthStore.setState({ appUser: { ...appUser, name: next } });

      // The dashboard greeting reads `tenant.admin_name || appUser.name`, so
      // the org's admin contact follows for the person who IS that contact,
      // and for nobody else.
      if (appUser.role === "head_admin" && !appUser.is_super_admin && appUser.tenant_id) {
        const { error: tenantError } = await (supabase as any)
          .from("tenants")
          .update({ admin_name: next })
          .eq("id", appUser.tenant_id);
        if (tenantError) console.error("admin_name sync failed:", tenantError);
      }

      toast({ title: "Name updated", description: "That's how you'll appear from now on." });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to update name",
        variant: "destructive",
      });
    } finally {
      setSavingName(false);
    }
  };

  /** `?otp=1` asks custom-auth-email for a code instead of a link. */
  const codeRedirect = () => `${window.location.origin}/?otp=1`;

  function resetEmailChange() {
    setEmailSentTo(null);
    setNewEmailCode("");
  }

  const saveEmail = async () => {
    const next = email.trim();
    if (!next || next.toLowerCase() === (appUser?.email ?? "").toLowerCase()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      toast({ title: "Error", description: "That doesn't look like an email address", variant: "destructive" });
      return;
    }

    setSavingEmail(true);
    try {
      // Supabase emails a code to the new address. Nothing changes until it
      // is checked below.
      const { error } = await supabase.auth.updateUser(
        { email: next },
        { emailRedirectTo: codeRedirect() },
      );
      if (error) throw error;
      setNewEmailCode("");
      setEmailSentTo(next);
      toast({
        title: "Check your new inbox",
        description: `I've sent a six-digit code to ${next}.`,
      });
    } catch (error: any) {
      toast({
        title: "Couldn't change your email",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingEmail(false);
    }
  };

  const verifyEmailChange = async () => {
    if (!emailSentTo || !appUser?.id) return;
    setVerifyingEmail(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        type: "email_change",
        email: emailSentTo,
        token: newEmailCode.trim(),
      });
      if (error) throw new Error(`That code didn't work. ${error.message}`);

      // The code passed: the auth address has moved. Bring the portal's own
      // copy along now rather than at the next open.
      const { data } = await supabase.auth.getUser();
      const confirmed = data?.user?.email ?? emailSentTo;
      await (supabase as any).rpc("sync_my_app_user_email");
      useAuthStore.setState({ appUser: { ...appUser, email: confirmed } });
      setEmail(confirmed);
      resetEmailChange();
      toast({ title: "Email updated", description: `You now sign in with ${confirmed}.` });
    } catch (error: any) {
      toast({
        title: "Couldn't confirm your email",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setVerifyingEmail(false);
    }
  };

  /** The address the account signs in with — where the password code goes. */
  const authEmail = async () => {
    const { data } = await supabase.auth.getUser();
    return data?.user?.email ?? appUser?.email ?? "";
  };

  /** Step one: email the code to the account's address. Nothing changes yet. */
  const sendPasswordCode = async (): Promise<string | null> => {
    try {
      const address = await authEmail();
      const { error } = await supabase.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: false, emailRedirectTo: codeRedirect() },
      });
      if (error) throw error;
      return null;
    } catch (error: any) {
      return error?.message || "I couldn't send the code. Please try again.";
    }
  };

  /** Step two: check the code, then set the password. */
  const savePassword = async (password: string, code: string): Promise<string | null> => {
    try {
      const { error: codeError } = await supabase.auth.verifyOtp({
        type: "email",
        email: await authEmail(),
        token: code,
      });
      if (codeError) return "That code didn't work. Check it, or send a new one.";

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      if (appUser?.id) {
        await (supabase as any)
          .from("app_users")
          .update({ must_change_password: false })
          .eq("id", appUser.id);
        useAuthStore.setState({ appUser: { ...appUser, must_change_password: false } });
      }

      toast({ title: "Password updated", description: "Your new password is live." });
      setShowPassword(false);
      return null;
    } catch (error: any) {
      return error?.message || "I couldn't update your password. Please try again.";
    }
  };

  if (!appUser) return null;

  const emailChanged = email.trim().toLowerCase() !== (appUser.email ?? "").toLowerCase();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* `max-h` + `overflow-y-auto` so a small laptop screen still reaches
            the password section rather than clipping it. */}
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
          data-testid="profile-sheet"
        >
          <DialogHeader>
            <DialogTitle>Your profile</DialogTitle>
            <DialogDescription>
              Your photo, your name, and how you sign in.
            </DialogDescription>
          </DialogHeader>

          <div className="grid w-full gap-6">
            {/* Photo — the avatar itself is the control: hover shows a camera,
                click picks a file. No separate "Change photo" button. */}
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                aria-label="Change photo"
                className="group relative h-16 w-16 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait"
              >
                <Avatar className="h-16 w-16 overflow-hidden rounded-full ring-2 ring-border/50">
                  <AvatarImage
                    src={appUser.avatar_url || undefined}
                    alt={appUser.name || "User"}
                    className="object-cover"
                  />
                  <AvatarFallback className="bg-primary/10 text-base font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={
                    "absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white " +
                    "[transition:opacity_200ms_ease-in] group-hover:[transition:opacity_200ms_ease-out] motion-reduce:transition-none " +
                    (uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")
                  }
                >
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) pickFile(file);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-name">
                Display name
              </Label>
              <div className="flex gap-2">
                <Input
                  id="profile-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                />
                <Button
                  onClick={saveName}
                  disabled={!name.trim() || name.trim() === (appUser.name ?? "") || savingName}
                >
                  {savingName ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="profile-email">
                Email
              </Label>
              <div className="flex gap-2">
                <Input
                  id="profile-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
                <Button
                  variant="outline"
                  onClick={saveEmail}
                  disabled={!emailChanged || savingEmail || !!emailSentTo}
                >
                  {savingEmail ? "Sending…" : "Confirm change"}
                </Button>
              </div>
              {emailSentTo ? (
                <div className="space-y-3 rounded-xl border border-border p-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="code-new-email">Code sent to {emailSentTo}</Label>
                    <CodeInput
                      id="code-new-email"
                      value={newEmailCode}
                      onChange={setNewEmailCode}
                      disabled={verifyingEmail}
                      autoFocus
                    />
                    <p className="text-[12px] text-muted-foreground">
                      <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
                      Until you enter it, you sign in with {appUser.email}.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        resetEmailChange();
                        setEmail(appUser.email ?? "");
                      }}
                      disabled={verifyingEmail}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={verifyEmailChange}
                      disabled={verifyingEmail || newEmailCode.length < 6}
                    >
                      {verifyingEmail ? "Checking…" : "Confirm email"}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  Changing this sends a six-digit code to the new address. Your email
                  only changes once you enter it.
                </p>
              )}
            </div>

            {/* Password */}
            {!appUser.is_super_admin && (
              <div className="space-y-2">
                <Label>
                  Password
                </Label>
                {!showPassword ? (
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => setShowPassword(true)}
                  >
                    <Key className="mr-2 h-4 w-4" />
                    Change password
                    {appUser.must_change_password && (
                      <Badge variant="destructive" className="ml-auto px-1.5 py-0 text-[10px]">
                        Required
                      </Badge>
                    )}
                  </Button>
                ) : (
                  <PasswordChangePanelV2
                    email={appUser.email ?? ""}
                    required={appUser.must_change_password}
                    onSendCode={sendPasswordCode}
                    onSave={savePassword}
                    onCancel={() => setShowPassword(false)}
                  />
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AvatarCropDialogV2
        open={showCrop}
        onOpenChange={(next) => {
          setShowCrop(next);
          if (!next) setCropSrc(null);
        }}
        imageSrc={cropSrc}
        onCropComplete={uploadCropped}
        isUploading={uploading}
      />
    </>
  );
}
