"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Key, Loader2, Mail, ShieldCheck, User } from "lucide-react";

import { useAuth, useAuthStore } from "@/stores/auth-store";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui-v2/avatar";
import { Badge } from "@/components/ui-v2/badge";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Label } from "@/components/ui-v2/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui-v2/sheet";
import { toast } from "@/hooks/use-toast";
import { AvatarCropDialog } from "./avatar-crop-dialog";

/**
 * The v2 profile — photo, display name, email and password, in a sheet that
 * comes down from the TOP of the window.
 *
 * ── WHY A TOP SHEET AND NOT THE CENTRED DIALOG IT REPLACED ────────────────
 * "Profile opens from the top, not the side" (team lead, Sep 20 2026). It was
 * a centred `Dialog`; this is `ui-v2/sheet` with `side="top"`, which is the
 * same Radix primitive family and needed no new component. The menu it opens
 * from is at the BOTTOM-LEFT of the rail, so a panel that arrives from the top
 * also stops the sheet covering the control that opened it.
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
 * ── EMAIL AND PASSWORD: WHAT VERIFIES THEM ────────────────────────────────
 * EMAIL goes through Supabase's own confirmation flow —
 * `auth.updateUser({ email })` sends a link to the new address (and, with
 * Secure email change on, to the old one too) and the address does not change
 * until it is opened. Nothing here writes `auth.users` directly and no edge
 * function was invented for it; the branded template for this already exists
 * (`custom-auth-email`, case `email_change`).
 *
 * `app_users.email` is a SEPARATE copy of that address, and it is what the
 * portal displays. Nothing tells the browser when the link is finally opened,
 * so this panel reconciles on open: if Supabase's own user record disagrees
 * with `app_users`, the row is corrected. That makes the confirmation land in
 * the UI the next time the person opens their profile, rather than never.
 *
 * PASSWORD keeps the direct change and adds the code step ONLY when Supabase
 * asks for it. If the project's "Secure password change" is on and the session
 * is older than 24h, `updateUser({ password })` fails with a reauthentication
 * error; the panel then calls `auth.reauthenticate()`, takes the six-digit
 * code and resubmits with it as the `nonce`.
 *
 * It is not asked for unconditionally, and that is a judgement worth stating:
 * `custom-auth-email` — an existing edge function, which V2_PLAN §7 says not
 * to change — has no `reauthentication` case, so that email falls to its
 * default branch and renders a "Confirm" button rather than the code. Forcing
 * every password change through a code we cannot be sure is delivered would
 * take away a flow that works today. Handling the demand when it comes cannot.
 */
export function ProfileSheetV2({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { appUser, updatePassword } = useAuth();

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [email, setEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);

  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  /** Set once Supabase has demanded reauthentication and a code has been sent. */
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");

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
    setEmailSentTo(null);
    setShowPassword(false);
    setNewPassword("");
    setConfirmPassword("");
    setCodeSent(false);
    setCode("");
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

        const { error: writeError } = await (supabase as any)
          .from("app_users")
          .update({ email: authEmail })
          .eq("id", appUser.id);
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

  const saveEmail = async () => {
    const next = email.trim();
    if (!next || next.toLowerCase() === (appUser?.email ?? "").toLowerCase()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      toast({ title: "Error", description: "That doesn't look like an email address", variant: "destructive" });
      return;
    }

    setSavingEmail(true);
    try {
      // Supabase's own confirmation flow. The address does not change until
      // the link in that email is opened, so nothing is written here.
      const { error } = await supabase.auth.updateUser({ email: next });
      if (error) throw error;
      setEmailSentTo(next);
      toast({
        title: "Check your inbox",
        description: `We've sent a confirmation link to ${next}.`,
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

  /** Does this error mean "prove it's you first"? */
  const needsReauth = (error: any) => {
    const code = String(error?.code ?? "");
    const message = String(error?.message ?? "").toLowerCase();
    return (
      code === "reauthentication_needed" ||
      code === "reauth_nonce_missing" ||
      message.includes("reauthentication")
    );
  };

  const savePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (newPassword.length < 12) {
      toast({
        title: "Error",
        description: "Password must be at least 12 characters long",
        variant: "destructive",
      });
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      toast({
        title: "Error",
        description: "Password must contain uppercase, lowercase, and numeric characters",
        variant: "destructive",
      });
      return;
    }

    setSavingPassword(true);
    try {
      if (codeSent) {
        // The verified path: the code Supabase emailed is the nonce.
        const { error } = await supabase.auth.updateUser({
          password: newPassword,
          nonce: code.trim(),
        });
        if (error) throw error;

        if (appUser?.id) {
          await (supabase as any)
            .from("app_users")
            .update({ must_change_password: false })
            .eq("id", appUser.id);
          useAuthStore.setState({ appUser: { ...appUser, must_change_password: false } });
        }
      } else {
        const { error } = await updatePassword(newPassword);
        if (error) {
          if (needsReauth(error)) {
            // Ask Supabase to email the six-digit code, then let the person
            // finish. Nothing has changed yet.
            const { error: sendError } = await supabase.auth.reauthenticate();
            if (sendError) throw sendError;
            setCodeSent(true);
            toast({
              title: "One more step",
              description: "We've emailed you a six-digit code to confirm it's you.",
            });
            return;
          }
          throw error;
        }
      }

      toast({ title: "Password updated", description: "Your new password is live." });
      setShowPassword(false);
      setNewPassword("");
      setConfirmPassword("");
      setCodeSent(false);
      setCode("");
    } catch (error: any) {
      toast({
        title: "Couldn't update your password",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingPassword(false);
    }
  };

  if (!appUser) return null;

  const emailChanged = email.trim().toLowerCase() !== (appUser.email ?? "").toLowerCase();

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* From the top. `max-h` + `overflow-y-auto` so a small laptop screen
            still reaches the password section rather than clipping it. */}
        <SheetContent
          side="top"
          className="max-h-[92vh] overflow-y-auto rounded-b-3xl"
          data-testid="profile-sheet"
        >
          <SheetHeader className="pb-2">
            <SheetTitle>Your profile</SheetTitle>
            <SheetDescription>
              Your photo, your name, and how you sign in.
            </SheetDescription>
          </SheetHeader>

          <div className="mx-auto grid w-full max-w-3xl gap-6 px-6 pb-8">
            {/* Photo + name */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-4">
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Camera className="mr-2 h-4 w-4" />
                      Change photo
                    </>
                  )}
                </Button>
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-name">
                <User className="mr-1.5 inline h-3.5 w-3.5 text-muted-foreground" />
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
                <Mail className="mr-1.5 inline h-3.5 w-3.5 text-muted-foreground" />
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
                  disabled={!emailChanged || savingEmail}
                >
                  {savingEmail ? "Sending…" : "Confirm change"}
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {emailSentTo ? (
                  <span className="text-foreground">
                    <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
                    Open the link we sent to {emailSentTo} to finish. Until then you
                    sign in with your current address.
                  </span>
                ) : (
                  "Changing this sends a confirmation link to the new address. Your email only changes once you open it."
                )}
              </p>
            </div>

            {/* Password */}
            {!appUser.is_super_admin && (
              <div className="space-y-2">
                <Label>
                  <Key className="mr-1.5 inline h-3.5 w-3.5 text-muted-foreground" />
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
                  <div className="space-y-3 rounded-xl border border-border p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="new-password">New password</Label>
                        <Input
                          id="new-password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="At least 12 characters"
                          minLength={12}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="confirm-password">Confirm password</Label>
                        <Input
                          id="confirm-password"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Type it again"
                          minLength={12}
                        />
                      </div>
                    </div>

                    {codeSent && (
                      <div className="space-y-1.5">
                        <Label htmlFor="reauth-code">Six-digit code</Label>
                        <Input
                          id="reauth-code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          placeholder="123456"
                        />
                        <p className="text-[12px] text-muted-foreground">
                          We emailed this to {appUser.email} to confirm it&apos;s you.
                        </p>
                      </div>
                    )}

                    <p className="text-[12px] text-muted-foreground">
                      At least 12 characters, with an uppercase letter, a lowercase
                      letter and a number.
                      {appUser.must_change_password && (
                        <span className="ml-1 font-medium text-destructive">
                          A password change is required before continuing.
                        </span>
                      )}
                    </p>

                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowPassword(false);
                          setNewPassword("");
                          setConfirmPassword("");
                          setCodeSent(false);
                          setCode("");
                        }}
                        disabled={savingPassword}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={savePassword}
                        disabled={
                          !newPassword ||
                          !confirmPassword ||
                          savingPassword ||
                          (codeSent && code.trim().length < 6)
                        }
                      >
                        {savingPassword
                          ? "Updating…"
                          : codeSent
                            ? "Confirm and update"
                            : "Update password"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AvatarCropDialog
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
