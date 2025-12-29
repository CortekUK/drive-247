'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ArrowLeft,
  Save,
  Loader2,
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Minus,
  Table,
  Link,
  Variable,
  ChevronDown,
  Copy,
  User,
  Car,
  FileText,
  Building2,
  Eye,
  Edit3,
} from 'lucide-react';
import { useAgreementTemplates, type AgreementTemplate } from '@/hooks/use-agreement-templates';
import { DEFAULT_AGREEMENT_TEMPLATE, DEFAULT_TEMPLATE_NAME } from '@/lib/default-agreement-template';
import {
  getVariablesByCategory,
  getSampleData,
  replaceVariables,
  type TemplateVariable,
} from '@/lib/template-variables';
import { toast } from '@/hooks/use-toast';

const categoryIcons: Record<string, React.ReactNode> = {
  customer: <User className="h-4 w-4" />,
  vehicle: <Car className="h-4 w-4" />,
  rental: <FileText className="h-4 w-4" />,
  company: <Building2 className="h-4 w-4" />,
};

const categoryLabels: Record<string, string> = {
  customer: 'Customer',
  vehicle: 'Vehicle',
  rental: 'Rental',
  company: 'Company',
};

interface ToolbarButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ icon, label, onClick }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

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
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const variablesByCategory = getVariablesByCategory();
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

  // Get selection helper
  const getSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return { start: 0, end: 0, text: '' };
    return {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
      text: templateContent.substring(textarea.selectionStart, textarea.selectionEnd),
    };
  }, [templateContent]);

  // Insert text at cursor
  const insertText = useCallback(
    (before: string, after: string = '', placeholder: string = '') => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const { start, end, text } = getSelection();
      const selectedText = text || placeholder;
      const newText =
        templateContent.substring(0, start) +
        before +
        selectedText +
        after +
        templateContent.substring(end);

      setTemplateContent(newText);

      setTimeout(() => {
        textarea.focus();
        const newCursorPos = start + before.length + selectedText.length;
        textarea.setSelectionRange(
          start + before.length,
          text ? newCursorPos : start + before.length + placeholder.length
        );
      }, 0);
    },
    [templateContent, getSelection]
  );

  // Formatting functions
  const formatBold = () => insertText('**', '**', 'bold text');
  const formatItalic = () => insertText('*', '*', 'italic text');
  const formatUnderline = () => insertText('<u>', '</u>', 'underlined text');
  const formatH1 = () => insertText('\n# ', '\n', 'Heading 1');
  const formatH2 = () => insertText('\n## ', '\n', 'Heading 2');
  const formatH3 = () => insertText('\n### ', '\n', 'Heading 3');
  const formatBulletList = () => insertText('\n- ', '\n', 'List item');
  const formatNumberedList = () => insertText('\n1. ', '\n', 'List item');
  const formatQuote = () => insertText('\n> ', '\n', 'Quote');
  const formatHorizontalRule = () => insertText('\n\n---\n\n', '', '');
  const formatLink = () => insertText('[', '](url)', 'link text');
  const formatTable = () =>
    insertText(
      '\n| Column 1 | Column 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |\n',
      '',
      ''
    );

  const handleCopyVariable = useCallback((variable: TemplateVariable) => {
    const placeholder = `{{${variable.key}}}`;
    navigator.clipboard.writeText(placeholder);
    toast({ title: 'Copied', description: `${placeholder} copied to clipboard` });
  }, []);

  const handleInsertVariable = useCallback(
    (variable: TemplateVariable) => {
      const placeholder = `{{${variable.key}}}`;
      insertText(placeholder, '', '');
      setVariablesOpen(false);
    },
    [insertText]
  );

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
              Use formatting tools and variables to create your rental agreement
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

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-6 py-2 border-b bg-background flex-wrap">
        <div className="flex items-center gap-0.5">
          <ToolbarButton icon={<Bold className="h-4 w-4" />} label="Bold" onClick={formatBold} />
          <ToolbarButton icon={<Italic className="h-4 w-4" />} label="Italic" onClick={formatItalic} />
          <ToolbarButton icon={<Underline className="h-4 w-4" />} label="Underline" onClick={formatUnderline} />
        </div>
        <Separator orientation="vertical" className="h-6 mx-2" />
        <div className="flex items-center gap-0.5">
          <ToolbarButton icon={<Heading1 className="h-4 w-4" />} label="Heading 1" onClick={formatH1} />
          <ToolbarButton icon={<Heading2 className="h-4 w-4" />} label="Heading 2" onClick={formatH2} />
          <ToolbarButton icon={<Heading3 className="h-4 w-4" />} label="Heading 3" onClick={formatH3} />
        </div>
        <Separator orientation="vertical" className="h-6 mx-2" />
        <div className="flex items-center gap-0.5">
          <ToolbarButton icon={<List className="h-4 w-4" />} label="Bullet List" onClick={formatBulletList} />
          <ToolbarButton icon={<ListOrdered className="h-4 w-4" />} label="Numbered List" onClick={formatNumberedList} />
          <ToolbarButton icon={<Quote className="h-4 w-4" />} label="Quote" onClick={formatQuote} />
        </div>
        <Separator orientation="vertical" className="h-6 mx-2" />
        <div className="flex items-center gap-0.5">
          <ToolbarButton icon={<Minus className="h-4 w-4" />} label="Horizontal Rule" onClick={formatHorizontalRule} />
          <ToolbarButton icon={<Table className="h-4 w-4" />} label="Table" onClick={formatTable} />
          <ToolbarButton icon={<Link className="h-4 w-4" />} label="Link" onClick={formatLink} />
        </div>
        <Separator orientation="vertical" className="h-6 mx-2" />
        <Popover open={variablesOpen} onOpenChange={setVariablesOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <Variable className="h-4 w-4" />
              Insert Variable
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <ScrollArea className="h-[280px]">
              <div className="p-2 space-y-1">
                {Object.entries(variablesByCategory).map(([category, variables]) => (
                  <Collapsible key={category} defaultOpen>
                    <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-muted rounded-md">
                      <div className="flex items-center gap-2">
                        {categoryIcons[category]}
                        <span className="font-medium text-sm">{categoryLabels[category]}</span>
                      </div>
                      <ChevronDown className="h-4 w-4" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pl-2">
                      {variables.map((variable) => (
                        <div
                          key={variable.key}
                          className="flex items-center justify-between p-2 hover:bg-muted rounded cursor-pointer group"
                          onClick={() => handleInsertVariable(variable)}
                        >
                          <div>
                            <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">
                              {`{{${variable.key}}}`}
                            </code>
                            <p className="text-xs text-muted-foreground">{variable.label}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100"
                            onClick={(e) => { e.stopPropagation(); handleCopyVariable(variable); }}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      {/* Editor and Preview - Side by Side */}
      <div className="flex-1 grid grid-cols-2 min-h-0">
        {/* Editor */}
        <div className="flex flex-col border-r">
          <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2">
            <Edit3 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Editor</span>
          </div>
          <Textarea
            ref={textareaRef}
            value={templateContent}
            onChange={(e) => setTemplateContent(e.target.value)}
            placeholder="Start typing your agreement template..."
            className="flex-1 resize-none border-0 rounded-none focus-visible:ring-0 font-mono text-sm p-4"
          />
        </div>

        {/* Preview */}
        <div className="flex flex-col">
          <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Preview</span>
            <Badge variant="secondary" className="text-xs">Sample Data</Badge>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-6 preview-content">
              {templateContent ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({children}) => <h1 className="text-2xl font-bold mb-3 mt-0">{children}</h1>,
                    h2: ({children}) => <h2 className="text-xl font-semibold mb-2 mt-4 pb-1 border-b">{children}</h2>,
                    h3: ({children}) => <h3 className="text-lg font-medium mb-2 mt-3">{children}</h3>,
                    p: ({children}) => <p className="mb-2 leading-relaxed">{children}</p>,
                    ul: ({children}) => <ul className="mb-3 ml-4 list-disc">{children}</ul>,
                    ol: ({children}) => <ol className="mb-3 ml-4 list-decimal">{children}</ol>,
                    li: ({children}) => <li className="mb-1">{children}</li>,
                    hr: () => <hr className="my-4 border-border" />,
                    strong: ({children}) => <strong className="font-semibold">{children}</strong>,
                    table: ({children}) => <table className="w-full mb-3 border-collapse">{children}</table>,
                    th: ({children}) => <th className="border border-border px-3 py-2 bg-muted text-left font-medium">{children}</th>,
                    td: ({children}) => <td className="border border-border px-3 py-2">{children}</td>,
                  }}
                >
                  {previewContent}
                </ReactMarkdown>
              ) : (
                <p className="text-muted-foreground italic">Start typing to see preview...</p>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
