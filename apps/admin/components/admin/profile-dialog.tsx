"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Key, Loader2, ShieldCheck } from "lucide-react";

import { useAuthStore } from "@/store/authStore";
import { supabase } from "@/lib/supabase";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodeInput } from "@/components/ui/code-input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { AvatarCropDialog } from "./avatar-crop-dialog";

/**
 * Your profile — photo, display name, email and password — opened from the
 * account menu's Profile. Northwind's ProfileSheetV2
 * (apps/portal/src/components/shared/layout/profile-sheet-v2.tsx), ported line
 * for line; read its header for the why of every step. The differences:
 *
 *  - It reads and writes `useAuthStore().user` (this app's store), so the
 *    sidebar row and the menu repaint the moment a save lands.
 *  - No `tenants.admin_name` sync: nobody here is a tenant's head admin.
 *  - No "password change required" flag: this app never sets one.
 *
 * Every write is to the signed-in user's own `app_users` row, by its id. The
 * password section shows for everyone, super admins included: a new password
 * is proven with a six-digit code to the account's own address, then set, and
 * Manage Admins' stored copy follows (platform_team_set_my_password).
 */
export function ProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const appUser = useAuthStore((s) => s.user);

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [email, setEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  /** The address a change was requested to; set once its code is out. */
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [newEmailCode, setNewEmailCode] = useState("");
  const [verifyingEmail, setVerifyingEmail] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  /** Set once the confirmation code has gone to the account's address. */
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
    resetEmailChange();
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

        // The verified address, copied by the server — app_users.email is not
        // a column a user may write (migration 20261016170000).
        const { error: writeError } = await (supabase as any).rpc("sync_my_app_user_email");
        if (writeError || cancelled) return;

        useAuthStore.setState({ user: { ...appUser, email: authEmail } });
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
      toast.error("Error", { description: "Please upload an image file" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Error", { description: "Image must be less than 5MB" });
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
        useAuthStore.setState({ user: { ...appUser, avatar_url: publicUrl } });

        toast.success("Photo updated", { description: "Looking good." });
        setShowCrop(false);
        setCropSrc(null);
      } catch (error: any) {
        console.error("Avatar upload error:", error);
        toast.error("Error", { description: error?.message || "Failed to upload photo" });
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
      toast.error("Error", { description: "Name cannot be empty" });
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

      useAuthStore.setState({ user: { ...appUser, name: next } });

      toast.success("Name updated", { description: "That's how you'll appear from now on." });
    } catch (error: any) {
      toast.error("Error", { description: error?.message || "Failed to update name" });
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
      toast.error("Error", { description: "That doesn't look like an email address" });
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
      toast.success("Check your new inbox", { description: `I've sent a six-digit code to ${next}.` });
    } catch (error: any) {
      toast.error("Couldn't change your email", { description: error?.message || "Please try again." });
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
      useAuthStore.setState({ user: { ...appUser, email: confirmed } });
      setEmail(confirmed);
      resetEmailChange();
      toast.success("Email updated", { description: `You now sign in with ${confirmed}.` });
    } catch (error: any) {
      toast.error("Couldn't confirm your email", { description: error?.message || "Please try again." });
    } finally {
      setVerifyingEmail(false);
    }
  };

  /** The address the account signs in with — where the password code goes. */
  const authEmail = async () => {
    const { data } = await supabase.auth.getUser();
    return data?.user?.email ?? appUser?.email ?? "";
  };

  const passwordProblem = (): string | null => {
    if (newPassword !== confirmPassword) return "Passwords do not match";
    if (newPassword.length < 12) return "Password must be at least 12 characters long";
    if (newPassword.length > 72) return "Password must be at most 72 characters long";
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return "Password must contain uppercase, lowercase, and numeric characters";
    }
    return null;
  };

  /** Step one: check the new password, then email the code. Nothing changes yet. */
  const sendPasswordCode = async () => {
    const problem = passwordProblem();
    if (problem) {
      toast.error("Error", { description: problem });
      return;
    }
    setSavingPassword(true);
    try {
      const address = await authEmail();
      const { error } = await supabase.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: false, emailRedirectTo: codeRedirect() },
      });
      if (error) throw error;
      setCodeSent(true);
      toast.success("Check your inbox", { description: `I've sent a six-digit code to ${address}.` });
    } catch (error: any) {
      toast.error("Couldn't send the code", { description: error?.message || "Please try again." });
    } finally {
      setSavingPassword(false);
    }
  };

  /** Step two: check the code, then set the password. */
  const savePassword = async () => {
    const problem = passwordProblem();
    if (problem) {
      toast.error("Error", { description: problem });
      return;
    }
    setSavingPassword(true);
    try {
      const { error: codeError } = await supabase.auth.verifyOtp({
        type: "email",
        email: await authEmail(),
        token: code.trim(),
      });
      if (codeError) throw new Error(`That code didn't work. ${codeError.message}`);

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      // Manage Admins keeps its own copy of a team member's password; bring it
      // along so that page never shows the old one. A no-op for anyone who was
      // not added there. The sign-in password has already changed either way.
      const { error: copyError } = await (supabase as any).rpc("platform_team_set_my_password", {
        p_password: newPassword,
      });
      if (copyError) console.error("Manage Admins password copy not updated:", copyError);

      toast.success("Password updated", { description: "Your new password is live." });
      setShowPassword(false);
      setNewPassword("");
      setConfirmPassword("");
      setCodeSent(false);
      setCode("");
    } catch (error: any) {
      toast.error("Couldn't update your password", { description: error?.message || "Please try again." });
    } finally {
      setSavingPassword(false);
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

            {/* Password — for everyone here, super admins included (the
                portal hides it from super admins; this dashboard is theirs). */}
            {(
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
                        <CodeInput
                          id="reauth-code"
                          value={code}
                          onChange={setCode}
                          disabled={savingPassword}
                          autoFocus
                        />
                        <p className="text-[12px] text-muted-foreground">
                          I emailed this to {appUser.email} to confirm it&apos;s you.{" "}
                          <button
                            type="button"
                            className="font-medium text-foreground underline-offset-2 hover:underline"
                            onClick={sendPasswordCode}
                            disabled={savingPassword}
                          >
                            Send a new code
                          </button>
                        </p>
                      </div>
                    )}

                    <p className="text-[12px] text-muted-foreground">
                      At least 12 characters, with an uppercase letter, a lowercase
                      letter and a number.
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
                        onClick={codeSent ? savePassword : sendPasswordCode}
                        disabled={
                          !newPassword ||
                          !confirmPassword ||
                          savingPassword ||
                          (codeSent && code.trim().length < 6)
                        }
                      >
                        {savingPassword
                          ? codeSent
                            ? "Updating…"
                            : "Sending code…"
                          : codeSent
                            ? "Confirm and update"
                            : "Send code"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
