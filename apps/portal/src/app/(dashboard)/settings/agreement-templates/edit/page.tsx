'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ArrowLeft,
  Save,
  Loader2,
  Eye,
  Edit3,
} from 'lucide-react';
import { useAgreementTemplates } from '@/hooks/use-agreement-templates';
import { DEFAULT_AGREEMENT_TEMPLATE, DEFAULT_TEMPLATE_NAME } from '@/lib/default-agreement-template';
import {
  getSampleData,
  replaceVariables,
} from '@/lib/template-variables';
import { toast } from '@/hooks/use-toast';
import { TipTapEditor } from '@/components/settings/tiptap-editor';

export default function EditAgreementTemplatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get('id');
  const isNew = !templateId;

  const {
    templates,
    isLoading,
    createTemplateAsync,
    isCreating,
    updateTemplateAsync,
    isUpdating,
  } = useAgreementTemplates();

  // Initialize with defaults for new templates
  const [templateName, setTemplateName] = useState(isNew ? DEFAULT_TEMPLATE_NAME : '');
  const [templateContent, setTemplateContent] = useState(isNew ? DEFAULT_AGREEMENT_TEMPLATE : '');
  const [loaded, setLoaded] = useState(false);

  const sampleData = getSampleData();

  // Load template data if editing existing template
  useEffect(() => {
    if (templateId && templates.length > 0 && !loaded) {
      const template = templates.find((t) => t.id === templateId);
      if (template) {
        setTemplateName(template.template_name);
        setTemplateContent(template.template_content);
        setLoaded(true);
      }
    }
  }, [templateId, templates, loaded]);

  const handleSave = async () => {
    if (!templateName.trim()) {
      toast({ title: 'Error', description: 'Please enter a template name', variant: 'destructive' });
      return;
    }
    if (!templateContent.trim()) {
      toast({ title: 'Error', description: 'Please enter template content', variant: 'destructive' });
      return;
    }

    try {
      if (templateId) {
        await updateTemplateAsync({
          id: templateId,
          template_name: templateName,
          template_content: templateContent,
        });
      } else {
        await createTemplateAsync({
          template_name: templateName,
          template_content: templateContent,
          is_active: true,
        });
      }
      router.push('/settings/agreement-templates');
    } catch (error) {
      // Error handled by hook
    }
  };

  const previewContent = replaceVariables(templateContent, sampleData);
  const isSaving = isCreating || isUpdating;

  if (isLoading && templateId) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-background">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/settings/agreement-templates')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">
              {isNew ? 'Create Agreement Template' : 'Edit Agreement Template'}
            </h1>
            <p className="text-sm text-muted-foreground">
              Use the rich text editor to customize your rental agreement
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => router.push('/settings/agreement-templates')}>
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

      {/* Template Name */}
      <div className="px-6 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-4">
          <Label htmlFor="template-name" className="text-sm font-medium whitespace-nowrap">
            Template Name
          </Label>
          <Input
            id="template-name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="e.g., Standard Rental Agreement"
            className="max-w-md"
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
              placeholder="Start typing your agreement template..."
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
            <div className="p-6 preview-content">
              {templateContent ? (
                <div
                  className="prose prose-sm max-w-none dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: previewContent }}
                />
              ) : (
                <p className="text-muted-foreground italic">Start typing to see preview...</p>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

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
          padding-bottom: 0.25rem;
          border-bottom: 1px solid hsl(var(--border));
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
        .preview-content hr {
          border: none;
          border-top: 1px solid hsl(var(--border));
          margin: 1rem 0;
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
