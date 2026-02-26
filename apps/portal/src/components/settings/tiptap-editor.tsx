'use client';

import React, { useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Undo,
  Redo,
  Variable,
  ChevronDown,
  Table as TableIcon,
  Pilcrow,
  PenLine,
  Calendar,
  Fingerprint,
} from 'lucide-react';
import {
  getVariablesByCategory,
  type TemplateVariable,
} from '@/lib/template-variables';

interface TipTapEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
}

interface ToolbarButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  icon,
  label,
  onClick,
  isActive = false,
  disabled = false,
}) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={isActive ? 'secondary' : 'ghost'}
          size="sm"
          className={`h-8 w-8 p-0 ${isActive ? 'bg-primary/20 text-primary' : ''}`}
          onClick={onClick}
          disabled={disabled}
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

const categoryLabels: Record<string, string> = {
  customer: 'Customer',
  vehicle: 'Vehicle',
  rental: 'Rental',
  company: 'Company',
};

const ESIGN_FIELDS = [
  {
    key: 'sig1',
    label: 'Signature',
    description: 'Customer signs here',
    icon: PenLine,
    tag: '{{@sig1}}',
  },
  {
    key: 'date1',
    label: 'Date Signed',
    description: 'Auto-filled signing date',
    icon: Calendar,
    tag: '{{@date1}}',
  },
  {
    key: 'init1',
    label: 'Initials',
    description: 'Customer initials here',
    icon: Fingerprint,
    tag: '{{@init1}}',
  },
] as const;

export const TipTapEditor: React.FC<TipTapEditorProps> = ({
  content,
  onChange,
  placeholder = 'Start typing your agreement...',
}) => {
  const [variablesOpen, setVariablesOpen] = React.useState(false);
  const [esignOpen, setEsignOpen] = React.useState(false);
  const variablesByCategory = getVariablesByCategory();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Placeholder.configure({
        placeholder,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[500px] px-6 py-4',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Sync content when it changes externally (e.g., loading default template)
  React.useEffect(() => {
    if (editor && content && editor.getHTML() !== content) {
      // Only update if content is different to avoid cursor jumping
      editor.commands.setContent(content, false);
    }
  }, [editor, content]);

  const insertVariable = useCallback(
    (variable: TemplateVariable) => {
      if (!editor) return;

      // Insert variable as plain text - will be replaced during email send
      editor
        .chain()
        .focus()
        .insertContent(`{{${variable.key}}}`)
        .run();

      setVariablesOpen(false);
    },
    [editor]
  );

  const insertEsignField = useCallback(
    (field: typeof ESIGN_FIELDS[number]) => {
      if (!editor) return;

      editor
        .chain()
        .focus()
        .insertContent(field.tag)
        .run();

      setEsignOpen(false);
    },
    [editor]
  );

  const insertTable = useCallback(() => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
      .run();
  }, [editor]);

  if (!editor) {
    return null;
  }

  return (
    <div className="flex flex-col h-full border rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b bg-muted/30 flex-wrap">
        {/* Undo/Redo */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            icon={<Undo className="h-4 w-4" />}
            label="Undo"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
          />
          <ToolbarButton
            icon={<Redo className="h-4 w-4" />}
            label="Redo"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
          />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Text Formatting */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            icon={<Bold className="h-4 w-4" />}
            label="Bold"
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive('bold')}
          />
          <ToolbarButton
            icon={<Italic className="h-4 w-4" />}
            label="Italic"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive('italic')}
          />
          <ToolbarButton
            icon={<UnderlineIcon className="h-4 w-4" />}
            label="Underline"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={editor.isActive('underline')}
          />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Headings */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            icon={<Pilcrow className="h-4 w-4" />}
            label="Paragraph"
            onClick={() => editor.chain().focus().setParagraph().run()}
            isActive={editor.isActive('paragraph')}
          />
          <ToolbarButton
            icon={<Heading1 className="h-4 w-4" />}
            label="Heading 1"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            isActive={editor.isActive('heading', { level: 1 })}
          />
          <ToolbarButton
            icon={<Heading2 className="h-4 w-4" />}
            label="Heading 2"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            isActive={editor.isActive('heading', { level: 2 })}
          />
          <ToolbarButton
            icon={<Heading3 className="h-4 w-4" />}
            label="Heading 3"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            isActive={editor.isActive('heading', { level: 3 })}
          />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Lists */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            icon={<List className="h-4 w-4" />}
            label="Bullet List"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive('bulletList')}
          />
          <ToolbarButton
            icon={<ListOrdered className="h-4 w-4" />}
            label="Numbered List"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive('orderedList')}
          />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Alignment */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            icon={<AlignLeft className="h-4 w-4" />}
            label="Align Left"
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            isActive={editor.isActive({ textAlign: 'left' })}
          />
          <ToolbarButton
            icon={<AlignCenter className="h-4 w-4" />}
            label="Align Center"
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            isActive={editor.isActive({ textAlign: 'center' })}
          />
          <ToolbarButton
            icon={<AlignRight className="h-4 w-4" />}
            label="Align Right"
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            isActive={editor.isActive({ textAlign: 'right' })}
          />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Other */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            icon={<Minus className="h-4 w-4" />}
            label="Horizontal Rule"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          />
          <ToolbarButton
            icon={<TableIcon className="h-4 w-4" />}
            label="Insert Table"
            onClick={insertTable}
          />
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Variables */}
        <Popover open={variablesOpen} onOpenChange={setVariablesOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <Variable className="h-4 w-4" />
              Insert Variable
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <ScrollArea className="h-[300px]">
              <div className="p-2">
                {Object.entries(variablesByCategory).map(([category, variables]) => (
                  <div key={category} className="mb-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1">
                      {categoryLabels[category]}
                    </div>
                    {variables.map((variable) => (
                      <button
                        key={variable.key}
                        className="w-full text-left px-2 py-1.5 hover:bg-muted rounded-md transition-colors"
                        onClick={() => insertVariable(variable)}
                      >
                        <div className="font-medium text-sm">{variable.label}</div>
                        <code className="text-xs text-muted-foreground">
                          {`{{${variable.key}}}`}
                        </code>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* E-Sign Fields */}
        <Popover open={esignOpen} onOpenChange={setEsignOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <PenLine className="h-4 w-4" />
              E-Sign Fields
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1">
                BoldSign Fields
              </div>
              {ESIGN_FIELDS.map((field) => {
                const Icon = field.icon;
                return (
                  <button
                    key={field.key}
                    className="w-full text-left flex items-center gap-3 px-2 py-2 hover:bg-muted rounded-md transition-colors"
                    onClick={() => insertEsignField(field)}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{field.label}</div>
                      <div className="text-xs text-muted-foreground">{field.description}</div>
                    </div>
                  </button>
                );
              })}
              <div className="px-2 pt-2 border-t mt-2">
                <p className="text-xs text-muted-foreground">
                  These fields become interactive signing areas in BoldSign where the customer can sign, initial, or see the date.
                </p>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Editor */}
      <ScrollArea className="flex-1">
        <EditorContent editor={editor} className="min-h-full" />
      </ScrollArea>

      {/* Editor Styles */}
      <style jsx global>{`
        .tiptap {
          outline: none;
        }
        .tiptap p.is-editor-empty:first-child::before {
          color: #adb5bd;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }
        /* Override prose default margins for tiptap editor to keep it tight */
        .tiptap h1 {
          font-size: 1.75rem;
          font-weight: 700;
          margin-bottom: 0.75rem;
          margin-top: 1.5rem;
        }
        .tiptap h2 {
          font-size: 1.375rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
          margin-top: 1.25rem;
          padding-bottom: 0.25rem;
          border-bottom: 1px solid hsl(var(--border));
        }
        .tiptap h3 {
          font-size: 1.125rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
          margin-top: 1rem;
        }
        .tiptap p {
          margin-bottom: 0.5rem;
        }
        .tiptap ul, .tiptap ol {
          padding-left: 1.5rem;
          margin-bottom: 0.75rem;
        }
        .tiptap li {
          margin-bottom: 0.25rem;
        }
        .tiptap hr {
          border: none;
          border-top: 1px solid hsl(var(--border));
          margin: 1rem 0;
        }
        .tiptap table {
          border-collapse: collapse;
          margin: 0.75rem 0;
          width: 100%;
        }
        .tiptap th, .tiptap td {
          border: 1px solid hsl(var(--border));
          padding: 0.5rem 0.75rem;
          text-align: left;
        }
        .tiptap th {
          background-color: hsl(var(--muted));
          font-weight: 600;
        }
      `}</style>
    </div>
  );
};

export default TipTapEditor;
