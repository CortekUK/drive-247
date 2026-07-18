'use client';

import React, { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Mail, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  useEmailNotificationPrefs,
  EMAIL_NOTIFICATION_CATEGORIES,
  type EmailNotificationCategory,
} from '@/hooks/use-email-notification-prefs';

/**
 * OPERATOR/ADMIN email notification settings card.
 *
 * Controls ONLY operator/admin emails (master switch, recipient address, and
 * per-category toggles). Customer emails and the always-on in-app bell are
 * untouched — every category carries an "In-app: Always on" badge to make that
 * explicit.
 */

const CATEGORY_META: Record<
  EmailNotificationCategory,
  { label: string; description: string }
> = {
  bookings: {
    label: 'Bookings',
    description: 'New bookings, approvals, cancellations and pending requests',
  },
  payments: {
    label: 'Payments',
    description: 'Failed payments and payment issues',
  },
  insurance: {
    label: 'Insurance',
    description: 'Insurance policy and coverage updates',
  },
  returns: {
    label: 'Returns & Late',
    description: 'Return-due reminders, late returns and completions',
  },
  verification: {
    label: 'Verification',
    description: 'Identity and document verification results',
  },
  fines: {
    label: 'Fines',
    description: 'Fines and penalty charges recorded',
  },
};

interface EmailNotificationSettingsProps {
  canEdit?: boolean;
}

export function EmailNotificationSettings({
  canEdit = true,
}: EmailNotificationSettingsProps) {
  const {
    prefs,
    isLoading,
    setMasterEnabled,
    setRecipientEmail,
    setCategoryEnabled,
  } = useEmailNotificationPrefs();

  // Local, editable copy of the recipient email (saved on blur).
  const [recipientDraft, setRecipientDraft] = useState('');

  useEffect(() => {
    if (prefs) {
      setRecipientDraft(prefs.recipientEmail ?? '');
    }
  }, [prefs?.recipientEmail]);

  const masterEnabled = prefs?.masterEnabled ?? false;
  const contactEmail = prefs?.contactEmail ?? '';
  const controlsDisabled = !canEdit || isLoading;

  const handleMasterToggle = (checked: boolean) => {
    setMasterEnabled.mutate(checked, {
      onError: (err: unknown) => {
        toast({
          title: 'Failed to update',
          description:
            err instanceof Error ? err.message : 'Could not update email notifications.',
          variant: 'destructive',
        });
      },
    });
  };

  const handleRecipientBlur = () => {
    const trimmed = recipientDraft.trim();
    if (trimmed === (prefs?.recipientEmail ?? '').trim()) return;
    setRecipientEmail.mutate(trimmed, {
      onSuccess: () => {
        toast({
          title: 'Recipient updated',
          description: trimmed
            ? `Notifications will be sent to ${trimmed}.`
            : 'Reverted to your booking site contact email.',
        });
      },
      onError: (err: unknown) => {
        toast({
          title: 'Failed to update',
          description:
            err instanceof Error ? err.message : 'Could not update the recipient email.',
          variant: 'destructive',
        });
        // Restore the previously saved value on failure.
        setRecipientDraft(prefs?.recipientEmail ?? '');
      },
    });
  };

  const handleCategoryToggle = (
    category: EmailNotificationCategory,
    checked: boolean
  ) => {
    setCategoryEnabled.mutate(
      { category, enabled: checked },
      {
        onError: (err: unknown) => {
          toast({
            title: 'Failed to update',
            description:
              err instanceof Error ? err.message : 'Could not update this category.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          Email notifications
        </CardTitle>
        <CardDescription>
          Choose which operator alerts are also sent by email, and where they go.
          The in-app bell stays on for every category.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading email preferences...</span>
          </div>
        ) : (
          <>
            {/* Master switch */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg">
              <div className="space-y-1 min-w-0 flex-1">
                <h4 className="font-medium">Email notifications</h4>
                <p className="text-sm text-muted-foreground">
                  Master switch for all operator email alerts. When off, no
                  category emails are sent.
                </p>
              </div>
              <Switch
                checked={masterEnabled}
                onCheckedChange={handleMasterToggle}
                disabled={controlsDisabled || setMasterEnabled.isPending}
                className="flex-shrink-0"
                aria-label="Toggle email notifications"
              />
            </div>

            {/* Recipient email */}
            <div className="space-y-2 p-4 border rounded-lg">
              <Label htmlFor="notification-recipient-email">
                Send notifications to
              </Label>
              <Input
                id="notification-recipient-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={recipientDraft}
                placeholder={contactEmail || 'you@example.com'}
                onChange={(e) => setRecipientDraft(e.target.value)}
                onBlur={handleRecipientBlur}
                disabled={controlsDisabled || setRecipientEmail.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Defaults to your booking site contact email
              </p>
            </div>

            {/* Per-category switches */}
            <div className="space-y-4">
              {EMAIL_NOTIFICATION_CATEGORIES.map((category) => {
                const meta = CATEGORY_META[category];
                return (
                  <div
                    key={category}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium">{meta.label}</h4>
                        <Badge
                          variant="secondary"
                          className="text-xs whitespace-nowrap"
                        >
                          In-app: Always on
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {meta.description}
                      </p>
                    </div>
                    <Switch
                      checked={prefs?.categories[category] ?? false}
                      onCheckedChange={(checked) =>
                        handleCategoryToggle(category, checked)
                      }
                      disabled={
                        controlsDisabled ||
                        !masterEnabled ||
                        setCategoryEnabled.isPending
                      }
                      className="flex-shrink-0"
                      aria-label={`Toggle ${meta.label} email notifications`}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default EmailNotificationSettings;
