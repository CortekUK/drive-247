'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tile, StatusPill, EmptyState, Eyebrow } from '@/components/bento';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Mail,
  Pencil,
  ArrowLeft,
  Loader2,
  Check,
  FileText,
  Search,
  RotateCcw,
} from 'lucide-react';
import { useEmailTemplates } from '@/hooks/use-email-templates';
import { EMAIL_TEMPLATE_TYPES } from '@/lib/email-template-variables';
import { toast } from '@/hooks/use-toast';

export default function EmailTemplatesPage() {
  const router = useRouter();
  const { customTemplates, isLoading, isCustomized, resetTemplateAsync } = useEmailTemplates();
  const [searchQuery, setSearchQuery] = useState('');
  const [showResetAllDialog, setShowResetAllDialog] = useState(false);
  const [isResettingAll, setIsResettingAll] = useState(false);

  const customizedCount = useMemo(() => {
    return EMAIL_TEMPLATE_TYPES.filter(t => isCustomized(t.key)).length;
  }, [customTemplates]);

  const handleResetAll = async () => {
    setIsResettingAll(true);
    try {
      const customizedKeys = EMAIL_TEMPLATE_TYPES
        .filter(t => isCustomized(t.key))
        .map(t => t.key);

      for (const key of customizedKeys) {
        await resetTemplateAsync(key);
      }
      toast({ title: 'All Templates Reset', description: `${customizedKeys.length} email template(s) have been restored to defaults.` });
      setShowResetAllDialog(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to reset templates', variant: 'destructive' });
    } finally {
      setIsResettingAll(false);
    }
  };

  // Filter templates based on search query
  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return EMAIL_TEMPLATE_TYPES;
    const query = searchQuery.toLowerCase();
    return EMAIL_TEMPLATE_TYPES.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query) ||
        t.key.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <div className="h-9 w-56 animate-pulse rounded-md [background:var(--bento-tile-2)]" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-tile [background:var(--bento-tile-2)]" />
        ))}
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/settings')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Email Templates</h1>
            <p className="text-muted-foreground mt-1">
              Customize the emails sent to your customers
            </p>
          </div>
        </div>
        {customizedCount > 0 && (
          <Button
            variant="outline"
            className="text-destructive border-destructive hover:bg-destructive/10"
            onClick={() => setShowResetAllDialog(true)}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset All to Defaults
          </Button>
        )}
      </div>

      {/* Info Card */}
      <Tile variant="inset" pad="default">
        <div className="flex items-start gap-3">
          <Mail className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground">
            Customize each email type to match your brand. Templates not customized will use the default content.
            Use variables like <code className="rounded bg-background px-1 py-0.5 font-mono text-xs text-foreground">{'{{customer_name}}'}</code> to personalize emails.
          </p>
        </div>
      </Tile>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 max-w-md"
        />
      </div>

      {/* Templates List */}
      <div className="grid gap-4">
        {filteredTemplates.length === 0 && (
          <EmptyState
            icon={<Search className="h-5 w-5" />}
            title="No templates found"
            description="No templates match your search. Try a different term."
          />
        )}
        {filteredTemplates.map((templateType) => {
          const customized = isCustomized(templateType.key);
          const customTemplate = customTemplates.find(t => t.template_key === templateType.key);

          return (
            <Tile
              key={templateType.key}
              interactive
              onClick={() => router.push(`/settings/email-templates/${templateType.key}`)}
              className={customized ? 'ring-1 ring-primary/40' : ''}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-tile-sm ${customized ? '[background:var(--bento-primary-weak)] text-[color:var(--bento-primary-weak-fg)]' : '[background:var(--bento-tile-2)] text-muted-foreground'}`}>
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold tracking-tight">{templateType.name}</h3>
                      {customized ? (
                        <StatusPill tone="primary"><Check className="h-3 w-3" /> Customized</StatusPill>
                      ) : (
                        <StatusPill tone="neutral">Default</StatusPill>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{templateType.description}</p>
                  </div>
                </div>
                <Button
                  variant={customized ? 'default' : 'outline'}
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); router.push(`/settings/email-templates/${templateType.key}`); }}
                  className="shrink-0"
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  {customized ? 'Edit' : 'Customize'}
                </Button>
              </div>
              <div className="mt-3 border-t border-border pt-3">
                <Eyebrow>Subject</Eyebrow>
                <p className="mt-0.5 text-sm font-medium text-foreground">
                  {customized && customTemplate ? customTemplate.subject : templateType.defaultSubject}
                </p>
              </div>
            </Tile>
          );
        })}
      </div>

      {/* Reset All Confirmation Dialog */}
      <AlertDialog open={showResetAllDialog} onOpenChange={setShowResetAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset All Email Templates?</AlertDialogTitle>
            <div className="text-sm text-muted-foreground">
              This will remove all your customizations and restore {customizedCount} email template(s) to their default content. This action cannot be undone.
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResettingAll}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetAll} disabled={isResettingAll}>
              {isResettingAll ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                'Reset All to Defaults'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
