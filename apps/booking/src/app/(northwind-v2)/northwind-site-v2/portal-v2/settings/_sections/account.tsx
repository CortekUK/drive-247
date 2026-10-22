'use client';

/**
 * Settings → Account: the customer's profile and how they sign in, on one
 * page (owner, Oct 21 2026 — My profile folded in; pages, not dialogs).
 *
 *   - Photo. The avatar is the control; it goes to `customer-photos`, squared
 *     and scaled to 256px in the browser first (a centre crop — the avatar is
 *     a 32px circle). The old file goes once the new one is saved.
 *   - Display name. Saved to the customer's row, scoped by id AND tenant.
 *   - Email address, with its verified state. Change it with a code to the
 *     new address; an unverified address is verified with a code to it.
 *   - Password. Changed with the operator's flow (account-flows.tsx). For an
 *     account made with Google there is no email sign-in yet: setting a
 *     password here also adds one (the `customer-email-login` function), so
 *     the customer can sign in with their email and password from then on.
 *   - Google. Disconnect it — only once the email sign-in exists, because
 *     Supabase will not remove an account's last way in — or connect one.
 *
 * Unlinking and linking need "manual linking" on the auth project; it was
 * switched on for this on Oct 21 2026.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2 } from 'lucide-react-nw';

import { GoogleMark } from '@nw/auth-v2/google-sign-in';
import { Input } from '@nw/components/ui/input';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { supabase } from '@nw/integrations/supabase/client';
import { cn } from '@nw/lib/utils';

import {
  CodeInput,
  EmailChangeForm,
  PasswordChangeForm,
  useAccountUser,
  useIdentities,
} from '../_components/account-flows';
import { PV_BUTTON_DANGER, PV_BUTTON_OUTLINE_SM, PV_BUTTON_SM, PV_INPUT } from '../_components/pv-kit';
import { ReadOnlyValue, RowHint, SettingsPageHeader, SettingsRow, StatusPill } from '../_components/settings-ui';

/** A centred square of the image, 256px, as a PNG. */
async function squarePng(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That image could not be read.'));
      img.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('That image could not be read.');
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('That image could not be read.'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Tone = 'success' | 'danger' | 'info';

function Banner({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[13px] leading-relaxed',
        tone === 'success' && 'bg-pv-success-light text-pv-success',
        tone === 'danger' && 'bg-pv-danger-light text-pv-danger',
        tone === 'info' && 'bg-pv-tint text-pv-fg',
      )}
    >
      <p className="flex-1">{children}</p>
    </div>
  );
}

export function AccountSettings() {
  const { tenant } = useTenant();
  const { user } = useAccountUser();
  const { identities, error: identitiesError, reload } = useIdentities();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { customer, customerId, displayName, initials, refresh } = useCustomer();
  const photo = customer?.profile_photo_url ?? null;
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Seeded from the row, and re-seeded when the row changes under an untouched field.
  const savedName = customer?.name ?? '';
  const lastSavedName = useRef(savedName);
  useEffect(() => {
    setName((current) => (current === '' || current === lastSavedName.current ? savedName : current));
    lastSavedName.current = savedName;
  }, [savedName]);

  const afterWrite = async () => {
    await refresh();
    await queryClient.invalidateQueries({ queryKey: ['customer-settings'] });
  };

  const pickPhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) return setNotice({ tone: 'danger', message: 'Please choose an image file.' });
    if (file.size > 5 * 1024 * 1024) return setNotice({ tone: 'danger', message: 'The image must be smaller than 5 MB.' });
    if (!customerId || !tenant?.id) return;
    setUploading(true);
    setNotice(null);
    try {
      const blob = await squarePng(file);
      const path = `${customerId}-${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage.from('customer-photos').upload(path, blob, { contentType: 'image/png' });
      if (uploadError) throw uploadError;
      const {
        data: { publicUrl },
      } = supabase.storage.from('customer-photos').getPublicUrl(path);
      const { error: updateError } = await supabase
        .from('customers')
        .update({ profile_photo_url: publicUrl })
        .eq('id', customerId)
        .eq('tenant_id', tenant.id);
      if (updateError) throw updateError;
      // The old photo goes once the new one is saved, never before.
      const old = photo?.split('/customer-photos/')[1];
      if (old) await supabase.storage.from('customer-photos').remove([decodeURIComponent(old)]);
      await afterWrite();
      setNotice({ tone: 'success', message: 'Photo updated.' });
    } catch (cause) {
      setNotice({ tone: 'danger', message: cause instanceof Error ? cause.message : 'We could not upload your photo.' });
    } finally {
      setUploading(false);
    }
  };

  const saveName = async () => {
    const next = name.trim();
    if (!next || !customerId || !tenant?.id) return;
    setSavingName(true);
    setNotice(null);
    try {
      const { data, error } = await supabase
        .from('customers')
        .update({ name: next })
        .eq('id', customerId)
        .eq('tenant_id', tenant.id)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Your name was not saved — we could not find your account on this site.');
      lastSavedName.current = next;
      await afterWrite();
      setNotice({ tone: 'success', message: "Name updated. That's how you'll appear from now on." });
    } catch (cause) {
      setNotice({ tone: 'danger', message: cause instanceof Error ? cause.message : 'We could not update your name.' });
    } finally {
      setSavingName(false);
    }
  };

  const [notice, setNotice] = useState<{ tone: Tone; message: string } | null>(null);
  const [open, setOpen] = useState<'email' | 'password' | 'verify' | 'disconnect' | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifySent, setVerifySent] = useState(false);

  useEffect(() => {
    void reload();
  }, [reload, user?.id]);

  // Back from Google after "Connect Google".
  useEffect(() => {
    if (searchParams?.get('linked') === 'google') {
      setNotice({ tone: 'success', message: 'Your Google account is connected. You can sign in with it from now on.' });
    }
  }, [searchParams]);

  const email = user?.email ?? '';
  const verified = user?.email_confirmed_at != null;
  const emailIdentity = identities?.find((identity) => identity.provider === 'email') ?? null;
  const googleIdentity = identities?.find((identity) => identity.provider === 'google') ?? null;
  const loaded = identities !== null;

  /** Adds the email sign-in to a Google-only account (customer-email-login). */
  const addEmailSignIn = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('customer-email-login', { body: { tenant_id: tenant?.id } });
    if (error || !data?.ok) {
      throw new Error((data as { error?: string } | null)?.error ?? 'Your email sign-in could not be added. Please try again.');
    }
    await supabase.auth.refreshSession();
    await reload();
  }, [reload, tenant?.id]);

  const sendVerifyCode = async () => {
    setBusy(true);
    setNotice(null);
    try {
      // An unverified address cannot take Supabase's own code (it would send
      // a sign-up mail, which the auth email hook drops), so this is the
      // sign-up verification code the customer site already uses.
      const { error } = await supabase.functions.invoke('send-verification-otp', {
        body: { email, tenant_id: tenant?.id ?? null, type: 'email_verification' },
      });
      if (error) throw error;
      setVerifyCode('');
      setVerifySent(true);
    } catch (cause) {
      setNotice({ tone: 'danger', message: cause instanceof Error ? cause.message : 'We could not send the code.' });
    } finally {
      setBusy(false);
    }
  };

  const confirmVerifyCode = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-otp', {
        body: { email, code: verifyCode.trim(), tenant_id: tenant?.id ?? null },
      });
      if (error || (data as { verified?: boolean } | null)?.verified !== true) {
        throw new Error("That code didn't work. Check it, or send a new one.");
      }
      await supabase.auth.refreshSession();
      setOpen(null);
      setVerifySent(false);
      setNotice({ tone: 'success', message: `${email} is verified.` });
    } catch (cause) {
      setNotice({ tone: 'danger', message: cause instanceof Error ? cause.message : 'We could not verify your email.' });
    } finally {
      setBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    if (!googleIdentity) return;
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.unlinkIdentity(googleIdentity.raw as Parameters<typeof supabase.auth.unlinkIdentity>[0]);
      if (error) throw error;
      await supabase.auth.refreshSession();
      await reload();
      setOpen(null);
      setNotice({ tone: 'success', message: `Google is disconnected. You now sign in with ${email} and your password.` });
    } catch (cause) {
      setNotice({ tone: 'danger', message: cause instanceof Error ? cause.message : 'We could not disconnect Google.' });
    } finally {
      setBusy(false);
    }
  };

  const connectGoogle = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/portal/settings?section=account&linked=google`,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) throw error;
      // The browser leaves for Google here.
    } catch (cause) {
      setNotice({ tone: 'danger', message: cause instanceof Error ? cause.message : 'We could not connect Google.' });
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <SettingsPageHeader title="Account" description="Your photo and name, and how you sign in." />

      {notice ? <Banner tone={notice.tone}>{notice.message}</Banner> : null}
      {identitiesError ? <Banner tone="danger">We could not read your sign-in methods: {identitiesError}</Banner> : null}

      <div>
        <SettingsRow label="Photo" description="Shown on your account. JPG or PNG, up to 5 MB.">
          <div className="flex items-center gap-4">
            {/* The avatar is the control: hover shows a camera. */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change photo"
              className="group relative size-16 shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-pv-ring focus-visible:ring-offset-2 disabled:cursor-wait"
            >
              <span className="flex size-16 items-center justify-center overflow-hidden rounded-full bg-pv-primary/10 text-base font-semibold text-pv-primary ring-2 ring-pv-border/50">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt={displayName ?? 'You'} className="size-full object-cover" />
                ) : (
                  initials ?? '·'
                )}
              </span>
              <span
                className={cn(
                  'absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white [transition:opacity_200ms_ease-in] group-hover:[transition:opacity_200ms_ease-out] motion-reduce:transition-none',
                  uploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                )}
              >
                {uploading ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
              </span>
            </button>
            <button type="button" className={PV_BUTTON_OUTLINE_SM} onClick={() => fileRef.current?.click()} disabled={uploading}>
              {photo ? 'Change photo' : 'Upload photo'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void pickPhoto(file);
                event.target.value = '';
              }}
            />
          </div>
        </SettingsRow>

        <SettingsRow label="Display name" description="How you appear across your account." htmlFor="account-name">
          <form
            className="flex max-w-md gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
          >
            <Input
              id="account-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              placeholder="Your name"
              className={PV_INPUT}
            />
            <button
              type="submit"
              className={cn(PV_BUTTON_SM, 'h-11 px-4')}
              disabled={!name.trim() || name.trim() === savedName || savingName}
            >
              {savingName ? <Loader2 aria-hidden className="animate-spin" /> : null}
              {savingName ? 'Saving…' : 'Save'}
            </button>
          </form>
        </SettingsRow>

        <SettingsRow label="Email address" description="Where every booking confirmation is sent, and the address you sign in with.">
          <ReadOnlyValue
            value={email || '—'}
            badge={verified ? <StatusPill tone="positive">Verified</StatusPill> : <StatusPill tone="notice">Not verified</StatusPill>}
            action={
              open === 'email' ? undefined : (
                <span className="flex gap-2">
                  {!verified ? (
                    <button type="button" className={PV_BUTTON_SM} onClick={() => setOpen('verify')} disabled={!email}>
                      Verify
                    </button>
                  ) : null}
                  <button type="button" className={PV_BUTTON_OUTLINE_SM} onClick={() => setOpen('email')} disabled={!email}>
                    Change
                  </button>
                </span>
              )
            }
          />
          {open === 'email' ? (
            <div className="mt-3 max-w-xl">
              <EmailChangeForm
                onCancel={() => setOpen(null)}
                onDone={(confirmed) => {
                  setOpen(null);
                  setNotice({ tone: 'success', message: `Email updated. You now sign in with ${confirmed}.` });
                }}
              />
            </div>
          ) : null}
          {open === 'verify' ? (
            <div className="mt-3 max-w-xl space-y-3 rounded-2xl border border-pv-border bg-pv-card p-4">
              {verifySent ? (
                <>
                  <p className="text-[13px] font-medium text-pv-fg">Code sent to {email}</p>
                  <CodeInput id="verify-code" value={verifyCode} onChange={setVerifyCode} disabled={busy} autoFocus />
                </>
              ) : (
                <p className="text-[13px] text-pv-muted-fg">We will send a six-digit code to {email}. Enter it here to verify the address.</p>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className={PV_BUTTON_OUTLINE_SM} onClick={() => setOpen(null)} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={PV_BUTTON_SM}
                  disabled={busy || (verifySent && verifyCode.length < 6)}
                  onClick={() => void (verifySent ? confirmVerifyCode() : sendVerifyCode())}
                >
                  {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
                  {verifySent ? 'Verify email' : 'Send code'}
                </button>
              </div>
            </div>
          ) : null}
        </SettingsRow>

        <SettingsRow
          label="Password"
          description={
            loaded && !emailIdentity
              ? 'You sign in with Google. Set a password to sign in with your email as well.'
              : 'Changing it signs you in with the new password from next time.'
          }
        >
          {open === 'password' ? (
            <div className="max-w-2xl">
              <PasswordChangeForm
                submitLabel={loaded && !emailIdentity ? 'Set password' : 'Update password'}
                onCancel={() => setOpen(null)}
                onDone={async () => {
                  if (!emailIdentity) await addEmailSignIn();
                  setOpen(null);
                  setNotice({
                    tone: 'success',
                    message: emailIdentity
                      ? 'Password updated. Your new password is live.'
                      : `Password set. You can now sign in with ${email} and your password.`,
                  });
                }}
              />
            </div>
          ) : (
            <ReadOnlyValue
              value={
                loaded && !emailIdentity ? (
                  <span className="text-pv-muted-fg">Not set</span>
                ) : (
                  <span aria-label="Password hidden" className="tracking-[0.3em] text-pv-muted-fg">
                    ••••••••
                  </span>
                )
              }
              action={
                <button type="button" className={PV_BUTTON_OUTLINE_SM} onClick={() => setOpen('password')} disabled={!email}>
                  {loaded && !emailIdentity ? 'Set a password' : 'Change'}
                </button>
              }
            />
          )}
        </SettingsRow>

        <SettingsRow
          label="Google account"
          description={
            googleIdentity
              ? 'You can sign in with Google. Disconnect it to sign in with your email and password only.'
              : 'Connect a Google account to sign in with one click.'
          }
        >
          {!loaded ? (
            <ReadOnlyValue value={<span className="text-pv-muted-fg">Checking…</span>} />
          ) : googleIdentity ? (
            <>
              <ReadOnlyValue
                value={
                  <span className="inline-flex items-center gap-2">
                    <GoogleMark className="size-4 shrink-0" />
                    {googleIdentity.email ?? 'Connected'}
                  </span>
                }
                badge={<StatusPill tone="positive">Connected</StatusPill>}
                action={
                  open === 'disconnect' ? undefined : (
                    <button
                      type="button"
                      className={PV_BUTTON_OUTLINE_SM}
                      onClick={() => setOpen('disconnect')}
                      disabled={!emailIdentity || busy}
                    >
                      Disconnect
                    </button>
                  )
                }
              />
              {!emailIdentity ? (
                <RowHint tone="warning">
                  Set a password first, so you can still sign in with {email || 'your email'} once Google is disconnected.
                </RowHint>
              ) : null}
              {open === 'disconnect' ? (
                <div className="mt-3 max-w-xl space-y-3 rounded-2xl border border-pv-border bg-pv-card p-4">
                  <p className="text-[13px] leading-relaxed text-pv-fg">
                    Disconnect Google? From now on you sign in with <span className="font-medium">{email}</span> and your password.
                    Signing in with Google again later reconnects it.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button type="button" className={PV_BUTTON_OUTLINE_SM} onClick={() => setOpen(null)} disabled={busy}>
                      Cancel
                    </button>
                    <button type="button" className={cn(PV_BUTTON_DANGER, 'h-8')} onClick={() => void disconnectGoogle()} disabled={busy}>
                      {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
                      Disconnect Google
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <ReadOnlyValue
              value={<span className="text-pv-muted-fg">Not connected</span>}
              action={
                <button type="button" className={PV_BUTTON_OUTLINE_SM} onClick={() => void connectGoogle()} disabled={busy}>
                  <GoogleMark className="size-4 shrink-0" />
                  Connect Google
                </button>
              }
            />
          )}
        </SettingsRow>
      </div>
    </div>
  );
}
