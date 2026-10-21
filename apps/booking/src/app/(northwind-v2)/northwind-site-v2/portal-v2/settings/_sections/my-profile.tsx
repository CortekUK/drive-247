'use client';

/**
 * My profile — the operator's "Your profile" (profile-sheet-v2.tsx) for a
 * customer, opened from its tile on the Settings index as the operator opens
 * theirs from the account menu: a centred dialog with the photo, the display
 * name, the email (changed with a code) and the password (changed with a
 * code), top to bottom, in the operator's order and words.
 *
 * Writes are the customer's own row, scoped by id AND tenant. The photo goes
 * to `customer-photos` (public, as v1's settings page uses it), squared and
 * scaled to 256px in the browser first — the operator crops in a dialog; a
 * centre square is what that dialog starts on, and a customer's avatar is a
 * 32px circle.
 */

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, KeyRound, Loader2 } from 'lucide-react-nw';

import { Input } from '@nw/components/ui/input';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { supabase } from '@nw/integrations/supabase/client';
import { cn } from '@nw/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@portal-v2-shared/dialog';

import { EmailChangeForm, PasswordChangeForm, useAccountUser } from '../_components/account-flows';
import { PV_BUTTON_OUTLINE, PV_BUTTON, PV_INPUT } from '../_components/pv-kit';
import { RowHint } from '../_components/settings-ui';

const LABEL = 'text-[14px] font-medium text-pv-fg';

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

export function MyProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { customer, customerId, displayName, initials, refresh } = useCustomer();
  const { user } = useAccountUser();
  const tenantId = tenant?.id ?? null;
  const photo = customer?.profile_photo_url ?? null;

  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Seed every time it opens, and clear what the last visit left behind.
  useEffect(() => {
    if (!open) return;
    setName(customer?.name ?? '');
    setShowEmail(false);
    setShowPassword(false);
    setStatus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const afterWrite = async () => {
    await refresh();
    await queryClient.invalidateQueries({ queryKey: ['customer-settings'] });
  };

  const pickFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return setStatus({ tone: 'danger', text: 'Please choose an image file.' });
    if (file.size > 5 * 1024 * 1024) return setStatus({ tone: 'danger', text: 'The image must be smaller than 5 MB.' });
    if (!customerId || !tenantId) return;
    setUploading(true);
    setStatus(null);
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
        .eq('tenant_id', tenantId);
      if (updateError) throw updateError;
      // The old photo goes once the new one is saved, never before.
      const old = photo?.split('/customer-photos/')[1];
      if (old) await supabase.storage.from('customer-photos').remove([decodeURIComponent(old)]);
      await afterWrite();
      setStatus({ tone: 'success', text: 'Photo updated. Looking good.' });
    } catch (cause) {
      setStatus({ tone: 'danger', text: cause instanceof Error ? cause.message : 'We could not upload your photo.' });
    } finally {
      setUploading(false);
    }
  };

  const saveName = async () => {
    const next = name.trim();
    if (!next || !customerId || !tenantId) return;
    setSavingName(true);
    setStatus(null);
    try {
      const { error } = await supabase.from('customers').update({ name: next }).eq('id', customerId).eq('tenant_id', tenantId);
      if (error) throw error;
      await afterWrite();
      setStatus({ tone: 'success', text: "Name updated. That's how you'll appear from now on." });
    } catch (cause) {
      setStatus({ tone: 'danger', text: cause instanceof Error ? cause.message : 'We could not update your name.' });
    } finally {
      setSavingName(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold tracking-tight text-pv-fg">Your profile</DialogTitle>
          <DialogDescription>Your photo, your name, and how you sign in.</DialogDescription>
        </DialogHeader>

        <div className="grid w-full gap-6">
          {status ? <RowHint tone={status.tone}>{status.text}</RowHint> : null}

          {/* Photo — the avatar itself is the control: hover shows a camera. */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change photo"
              className="group relative size-16 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-pv-ring focus-visible:ring-offset-2 disabled:cursor-wait"
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
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void pickFile(file);
                event.target.value = '';
              }}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="profile-name" className={LABEL}>
              Display name
            </label>
            <div className="flex gap-2">
              <Input
                id="profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter your name"
                className={PV_INPUT}
              />
              <button
                type="button"
                className={PV_BUTTON}
                onClick={() => void saveName()}
                disabled={!name.trim() || name.trim() === (customer?.name ?? '') || savingName}
              >
                {savingName ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className={LABEL}>Email</p>
            {showEmail ? (
              <EmailChangeForm
                onCancel={() => setShowEmail(false)}
                onDone={(confirmed) => {
                  setShowEmail(false);
                  setStatus({ tone: 'success', text: `Email updated. You now sign in with ${confirmed}.` });
                }}
              />
            ) : (
              <div className="flex gap-2">
                <Input value={user?.email ?? ''} readOnly aria-label="Email" className={cn(PV_INPUT, 'text-pv-muted-fg')} />
                <button type="button" className={PV_BUTTON_OUTLINE} onClick={() => setShowEmail(true)}>
                  Change
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className={LABEL}>Password</p>
            {showPassword ? (
              <PasswordChangeForm
                onCancel={() => setShowPassword(false)}
                onDone={() => {
                  setShowPassword(false);
                  setStatus({ tone: 'success', text: 'Password updated. Your new password is live.' });
                }}
              />
            ) : (
              <button type="button" className={cn(PV_BUTTON_OUTLINE, 'w-full justify-start')} onClick={() => setShowPassword(true)}>
                <KeyRound aria-hidden />
                Change password
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
