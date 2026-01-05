'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft,
  Save,
  Loader2,
  Eye,
  Edit3,
  RotateCcw,
} from 'lucide-react';
import {
  useTemplateSelection,
  type TemplateType,
  DEFAULT_TEMPLATE_NAME,
  CUSTOM_TEMPLATE_NAME,
} from '@/hooks/use-agreement-templates';
import { DEFAULT_AGREEMENT_TEMPLATE } from '@/lib/default-agreement-template';
import {
  getSampleData,
  replaceVariables,
} from '@/lib/template-variables';
import { toast } from '@/hooks/use-toast';
import { TipTapEditor } from '@/components/settings/tiptap-editor';

export default function EditAgreementTemplatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateType = (searchParams.get('type') as TemplateType) || 'default';

  const {
    defaultTemplate,
    customTemplate,
    isLoading,
    updateContentAsync,
    isUpdating,
    resetDefaultAsync,
    isResetting,
  } = useTemplateSelection();

  const [templateContent, setTemplateContent] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const sampleData = getSampleData();

  const currentTemplate = templateType === 'default' ? defaultTemplate : customTemplate;
  const templateName = templateType === 'default' ? DEFAULT_TEMPLATE_NAME : CUSTOM_TEMPLATE_NAME;
  const isDefault = templateType === 'default';

  // Load template content when data is available
  useEffect(() => {
    if (!isLoading && !loaded) {
      if (currentTemplate && currentTemplate.template_content) {
        // Template exists in database with content, use it
        setTemplateContent(currentTemplate.template_content);
      } else if (isDefault) {
        // Default template - use default content from codebase
        setTemplateContent(DEFAULT_AGREEMENT_TEMPLATE);
      } else {
        // Custom template - start blank
        setTemplateContent('');
      }
      setLoaded(true);
    }
  }, [currentTemplate, loaded, isLoading, isDefault]);

  // Track changes
  useEffect(() => {
    if (loaded) {
      const originalContent = currentTemplate?.template_content || (isDefault ? DEFAULT_AGREEMENT_TEMPLATE : '');
      setHasChanges(templateContent !== originalContent);
    }
  }, [templateContent, currentTemplate, loaded, isDefault]);

  const handleSave = async () => {
    if (!templateContent.trim()) {
      toast({ title: 'Error', description: 'Template content cannot be empty', variant: 'destructive' });
      return;
    }

    try {
      await updateContentAsync({ type: templateType, content: templateContent });
      setHasChanges(false);
      router.push('/settings/agreement-templates');
    } catch (error) {
      // Error handled by hook
    }
  };

  const handleReset = async () => {
    if (isDefault) {
      try {
        await resetDefaultAsync();
        setTemplateContent(DEFAULT_AGREEMENT_TEMPLATE);
        setHasChanges(false);
      } catch (error) {
        // Error handled by hook
      }
    }
  };

  const handleContentChange = (content: string) => {
    setTemplateContent(content);
  };

  const previewContent = replaceVariables(templateContent, sampleData);
  const isSaving = isUpdating;

  if (isLoading) {
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
            <h1 className="text-xl font-semibold flex items-center gap-2">
              Edit {templateName}
              {hasChanges && (
                <Badge variant="secondary" className="text-xs">Unsaved changes</Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isDefault
                ? 'Customize the standard rental agreement template'
                : 'Create your own custom rental agreement'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isDefault && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={isResetting}>
                  {isResetting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Reset to Original
                    </>
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset Default Template?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will restore the default template to its original content.
                    Any customizations you've made will be lost.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleReset}>
                    Reset Template
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button variant="outline" onClick={() => router.push('/settings/agreement-templates')}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
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
              onChange={handleContentChange}
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
