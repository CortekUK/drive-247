'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft,
  Save,
  Loader2,
  Eye,
  Edit3,
  RotateCcw,
} from 'lucide-react';
import { useEmailTemplates, useEmailTemplate } from '@/hooks/use-email-templates';
import { getDefaultEmailTemplate } from '@/lib/default-email-templates';
import {
  getEmailSampleData,
  replaceEmailVariables,
  getEmailTemplateType,
} from '@/lib/email-template-variables';
import { getSampleData as getAgreementSampleData } from '@/lib/template-variables';
import { toast } from '@/hooks/use-toast';
import { TipTapEditor } from '@/components/settings/tiptap-editor';
import { useTenant } from '@/contexts/TenantContext';
import { useV2 } from '@/lib/v2-context';
import { useUnsavedChangesWarning } from '@/hooks/use-unsaved-changes-warning';
import { UnsavedChangesDialog } from '@/components/shared/unsaved-changes-dialog';

export default function EditEmailTemplatePage() {
  const router = useRouter();
  const params = useParams();
  const templateKey = params?.key as string;
  const { tenant } = useTenant();
  // v2 chrome (northwind only; fails closed to v1). Used only to put this page's
  // header on the sidebar switch's row at md; every other tenant renders the
  // classes it did before. Above the early returns, as every hook must be.
  const v2Chrome = useV2('chrome');

  const {
    saveTemplateAsync,
    isSaving,
    resetTemplateAsync,
    isResetting,
  } = useEmailTemplates();

  const {
    customTemplate,
    defaultTemplate,
    isCustomized,
    isLoading,
  } = useEmailTemplate(templateKey);

  const templateType = getEmailTemplateType(templateKey);

  // Always get the default template directly as a fallback
  const fallbackDefault = getDefaultEmailTemplate(templateKey);

  const [subject, setSubject] = useState('');
  const [templateContent, setTemplateContent] = useState('');
  const [originalSubject, setOriginalSubject] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);

  const hasChanges = loaded && (subject !== originalSubject || templateContent !== originalContent);

  // Get sample data — merge agreement variables (full 43) with email-specific ones
  const sampleData = {
    ...getAgreementSampleData(),
    ...getEmailSampleData(),
    // Use actual tenant info for company variables
    company_name: (tenant as any)?.company_name || 'Your Company Name',
    company_email: (tenant as any)?.contact_email || 'contact@yourcompany.com',
    company_phone: (tenant as any)?.phone || '+1 800 000 0000',
  };

  // Load template data - always prefer custom, then default from hook, then fallback default
  useEffect(() => {
    if (!loaded && !isLoading) {
      if (customTemplate) {
        // Load custom template
        setSubject(customTemplate.subject);
        setTemplateContent(customTemplate.template_content);
        setOriginalSubject(customTemplate.subject);
        setOriginalContent(customTemplate.template_content);
      } else {
        // Load default template (from hook or fallback)
        const defaultToUse = defaultTemplate || fallbackDefault;
        if (defaultToUse) {
          setSubject(defaultToUse.subject);
          setTemplateContent(defaultToUse.content);
          setOriginalSubject(defaultToUse.subject);
          setOriginalContent(defaultToUse.content);
        }
      }
      setLoaded(true);
    }
  }, [customTemplate, defaultTemplate, fallbackDefault, isLoading, loaded]);

  // Save content without navigation (for unsaved changes warning)
  const saveContent = async (): Promise<boolean> => {
    if (!subject.trim()) {
      toast({ title: 'Error', description: 'Please enter an email subject', variant: 'destructive' });
      return false;
    }
    if (!templateContent.trim()) {
      toast({ title: 'Error', description: 'Please enter template content', variant: 'destructive' });
      return false;
    }
    try {
      await saveTemplateAsync({
        template_key: templateKey,
        template_name: templateType?.name || templateKey,
        subject: subject,
        template_content: templateContent,
      });
      setOriginalSubject(subject);
      setOriginalContent(templateContent);
      return true;
    } catch {
      return false;
    }
  };

  const {
    isDialogOpen,
    confirmLeave,
    saveAndLeave,
    cancelLeave,
    isSaving: isSavingNav,
  } = useUnsavedChangesWarning({ hasChanges, onSave: saveContent });

  const handleSave = async () => {
    const success = await saveContent();
    if (success) {
      router.push('/settings/email-templates');
    }
  };

  const handleReset = async () => {
    try {
      await resetTemplateAsync(templateKey);
      // Reset form to defaults
      const defaultToUse = defaultTemplate || fallbackDefault;
      if (defaultToUse) {
        setSubject(defaultToUse.subject);
        setTemplateContent(defaultToUse.content);
      }
      setShowResetDialog(false);
    } catch (error) {
      // Error handled by hook
    }
  };

  const previewContent = replaceEmailVariables(templateContent, sampleData);
  const previewSubject = replaceEmailVariables(subject, sampleData);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!templateType) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <p className="text-muted-foreground">Template type not found</p>
      </div>
    );
  }

  // v2, md and up (switch row alignment): <main> starts at y=50. 14px of top
  // padding here plus a 14px header top (16 in v1) puts the header's top edge on
  // the top bar's bottom (64) and centres the 28px title line at 64 + 14 + 14 =
  // 92, the sidebar switch's row. The height is re-derived for that start: the
  // viewport less 50 above and main's 16px bottom padding, so 100vh - 66px with
  // the padding inside. The old 100vh - 4rem ran 32px past the viewport under
  // the v2 top bar. v1 keeps both class strings byte for byte.
  return (
    <div className={`h-[calc(100vh-4rem)] flex flex-col${v2Chrome ? ' md:h-[calc(100vh-66px)] md:pt-[14px]' : ''}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-6 py-4 border-b bg-background${v2Chrome ? ' md:pt-[14px]' : ''}`}>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/settings/email-templates')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              {templateType.name}
              {isCustomized && (
                <Badge variant="outline" className="text-xs">Customized</Badge>
              )}
              {hasChanges && (
                <Badge variant="secondary" className="text-xs">Unsaved changes</Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {templateType.description}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isCustomized && (
            <Button
              variant="outline"
              onClick={() => setShowResetDialog(true)}
              disabled={isResetting}
            >
              {isResetting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Reset to Default
            </Button>
          )}
          <Button variant="outline" onClick={() => router.push('/settings/email-templates')}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Template
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Subject Line */}
      <div className="px-6 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-4">
          <Label htmlFor="subject" className="text-sm font-medium whitespace-nowrap">
            Subject Line
          </Label>
          <Input
            id="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g., Booking Confirmed - {{rental_number}}"
            className="max-w-xl"
          />
        </div>
      </div>

      {/* Editor and Preview - Side by Side */}
      <div className="flex-1 grid grid-cols-2 min-h-0 overflow-hidden">
        {/* Editor */}
        <div className="flex flex-col border-r overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2">
            <Edit3 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Editor</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <TipTapEditor
              content={templateContent}
              onChange={setTemplateContent}
              placeholder="Start typing your email template..."
            />
          </div>
        </div>

        {/* Preview */}
        <div className="flex flex-col overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Preview</span>
            <Badge variant="secondary" className="text-xs">Sample Data</Badge>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-6">
              {/* Subject Preview */}
              <div className="mb-4 pb-4 border-b">
                <p className="text-xs text-muted-foreground mb-1">Subject:</p>
                <p className="font-medium">{previewSubject || 'No subject'}</p>
              </div>
              {/* Content Preview */}
              <div className="preview-content">
                {templateContent ? (
                  <div
                    className="prose prose-sm max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: previewContent }}
                  />
                ) : (
                  <p className="text-muted-foreground italic">Start typing to see preview...</p>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to Default?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove your customizations and restore the default template content.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>
              {isResetting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Reset to Default'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UnsavedChangesDialog
        open={isDialogOpen}
        onCancel={cancelLeave}
        onDiscard={confirmLeave}
        onSave={saveAndLeave}
        isSaving={isSavingNav}
      />

      {/* Preview Styles */}
      <style jsx global>{`
        .preview-content h1 {
          font-size: 1.75rem;
          font-weight: 700;
          margin-bottom: 0.75rem;
          margin-top: 0;
        }
        .preview-content h2 {
          font-size: 1.375rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
          margin-top: 1.25rem;
        }
        .preview-content h3 {
          font-size: 1.125rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
          margin-top: 1rem;
        }
        .preview-content p {
          margin-bottom: 0.5rem;
        }
        .preview-content ul, .preview-content ol {
          padding-left: 1.5rem;
          margin-bottom: 0.75rem;
        }
        .preview-content li {
          margin-bottom: 0.25rem;
        }
        .preview-content table {
          border-collapse: collapse;
          margin: 0.75rem 0;
          width: 100%;
        }
        .preview-content th, .preview-content td {
          border: 1px solid hsl(var(--border));
          padding: 0.5rem 0.75rem;
          text-align: left;
        }
        .preview-content th {
          background-color: hsl(var(--muted));
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
