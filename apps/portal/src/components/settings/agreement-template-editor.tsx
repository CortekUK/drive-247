'use client';

import React, { useState, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Copy,
  ChevronDown,
  User,
  Car,
  FileText,
  Building2,
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
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  TEMPLATE_VARIABLES,
  getVariablesByCategory,
  getSampleData,
  replaceVariables,
  type TemplateVariable,
} from '@/lib/template-variables';

interface AgreementTemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

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

export const AgreementTemplateEditor: React.FC<AgreementTemplateEditorProps> = ({
  value,
  onChange,
  className,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [variablesOpen, setVariablesOpen] = useState(false);

  const variablesByCategory = getVariablesByCategory();
  const sampleData = getSampleData();

  // Get current selection or cursor position
  const getSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return { start: 0, end: 0, text: '' };
    return {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
      text: value.substring(textarea.selectionStart, textarea.selectionEnd),
    };
  }, [value]);

  // Insert text at cursor or wrap selection
  const insertText = useCallback(
    (before: string, after: string = '', placeholder: string = '') => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const { start, end, text } = getSelection();
      const selectedText = text || placeholder;
      const newText =
        value.substring(0, start) +
        before +
        selectedText +
        after +
        value.substring(end);

      onChange(newText);

      // Set cursor position after update
      setTimeout(() => {
        textarea.focus();
        const newCursorPos = start + before.length + selectedText.length;
        textarea.setSelectionRange(
          start + before.length,
          text ? newCursorPos : start + before.length + placeholder.length
        );
      }, 0);
    },
    [value, onChange, getSelection]
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
      '\n| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| Cell 1   | Cell 2   | Cell 3   |\n',
      '',
      ''
    );

  const handleCopyVariable = useCallback((variable: TemplateVariable) => {
    const placeholder = `{{${variable.key}}}`;
    navigator.clipboard.writeText(placeholder);
    toast({
      title: 'Copied',
      description: `${placeholder} copied to clipboard`,
    });
  }, []);

  const handleInsertVariable = useCallback(
    (variable: TemplateVariable) => {
      const placeholder = `{{${variable.key}}}`;
      insertText(placeholder, '', '');
      setVariablesOpen(false);
      toast({
        title: 'Inserted',
        description: `${variable.label} variable inserted`,
      });
    },
    [insertText]
  );

  const previewContent = replaceVariables(value, sampleData);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border rounded-lg bg-muted/30 flex-wrap">
        {/* Text Formatting */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton icon={<Bold className="h-4 w-4" />} label="Bold (Ctrl+B)" onClick={formatBold} />
          <ToolbarButton icon={<Italic className="h-4 w-4" />} label="Italic (Ctrl+I)" onClick={formatItalic} />
          <ToolbarButton icon={<Underline className="h-4 w-4" />} label="Underline" onClick={formatUnderline} />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Headings */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton icon={<Heading1 className="h-4 w-4" />} label="Heading 1" onClick={formatH1} />
          <ToolbarButton icon={<Heading2 className="h-4 w-4" />} label="Heading 2" onClick={formatH2} />
          <ToolbarButton icon={<Heading3 className="h-4 w-4" />} label="Heading 3" onClick={formatH3} />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Lists */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton icon={<List className="h-4 w-4" />} label="Bullet List" onClick={formatBulletList} />
          <ToolbarButton icon={<ListOrdered className="h-4 w-4" />} label="Numbered List" onClick={formatNumberedList} />
          <ToolbarButton icon={<Quote className="h-4 w-4" />} label="Quote" onClick={formatQuote} />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Other */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton icon={<Minus className="h-4 w-4" />} label="Horizontal Rule" onClick={formatHorizontalRule} />
          <ToolbarButton icon={<Table className="h-4 w-4" />} label="Table" onClick={formatTable} />
          <ToolbarButton icon={<Link className="h-4 w-4" />} label="Link" onClick={formatLink} />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Variables Dropdown */}
        <Popover open={variablesOpen} onOpenChange={setVariablesOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <Variable className="h-4 w-4" />
              <span className="hidden sm:inline">Insert Variable</span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <ScrollArea className="h-[300px]">
              <div className="p-2 space-y-1">
                {Object.entries(variablesByCategory).map(([category, variables]) => (
                  <Collapsible key={category} defaultOpen>
                    <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-muted rounded-md transition-colors">
                      <div className="flex items-center gap-2">
                        {categoryIcons[category]}
                        <span className="font-medium text-sm">{categoryLabels[category]}</span>
                        <Badge variant="secondary" className="text-xs">
                          {variables.length}
                        </Badge>
                      </div>
                      <ChevronDown className="h-4 w-4" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pl-2">
                      <div className="space-y-0.5 pt-1">
                        {variables.map((variable) => (
                          <div
                            key={variable.key}
                            className="flex items-center justify-between p-2 hover:bg-muted rounded-md group cursor-pointer"
                            onClick={() => handleInsertVariable(variable)}
                          >
                            <div className="flex-1">
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                                {`{{${variable.key}}}`}
                              </code>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {variable.label}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyVariable(variable);
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      {/* Side-by-side Editor and Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Editor Panel */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Editor
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Write your agreement template here...

Use the toolbar above to format text.
Click 'Insert Variable' to add dynamic placeholders."
              className="min-h-[450px] font-mono text-sm resize-none border-0 rounded-none rounded-b-lg focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </CardContent>
        </Card>

        {/* Preview Panel */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Preview
              <Badge variant="secondary" className="text-xs font-normal">
                Sample Data
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[450px] px-4 pb-4">
              <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-table:my-2">
                {value ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {previewContent}
                  </ReactMarkdown>
                ) : (
                  <p className="text-muted-foreground italic">
                    Start typing in the editor to see a preview...
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Use the formatting toolbar for rich text. Variables like{' '}
        <code className="bg-muted px-1 py-0.5 rounded text-xs">{'{{customer_name}}'}</code>{' '}
        will be replaced with actual data when the agreement is generated.
      </p>
    </div>
  );
};

export default AgreementTemplateEditor;
