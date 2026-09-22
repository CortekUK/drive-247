"use client";

/**
 * Agreements v2: the editor's formatting toolbar. Only what the PDF renderer
 * draws (headings 1–3, paragraphs, bold / italic / underline, lists,
 * alignment, rules and tables), so nothing on the toolbar makes a promise the
 * signed document breaks.
 */

import type { ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Bold,
  ChevronDown,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Redo2,
  Rows3,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Separator } from "@/components/ui-v2/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import { cn } from "@/lib/utils";

function ToolButton({
  label,
  icon: Icon,
  onClick,
  active,
  disabled,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label={label}
          aria-pressed={active === undefined ? undefined : active}
          disabled={disabled}
          // Keep the editor's selection: a toolbar click must not blur it first.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          className={cn(active && "text-foreground")}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

const Divider = () => <Separator orientation="vertical" className="mx-1 h-5 !self-center" />;

export function EditorToolbarV2({ editor }: { editor: Editor | null }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e || e.isDestroyed) return null;
      return {
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        paragraph: e.isActive("paragraph"),
        h1: e.isActive("heading", { level: 1 }),
        h2: e.isActive("heading", { level: 2 }),
        h3: e.isActive("heading", { level: 3 }),
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        left: e.isActive({ textAlign: "left" }),
        center: e.isActive({ textAlign: "center" }),
        right: e.isActive({ textAlign: "right" }),
        inTable: e.isActive("table"),
      };
    },
  });

  if (!editor || !state) {
    return <div className="h-11 border-b border-border" aria-hidden="true" />;
  }
  const chain = () => editor.chain().focus();

  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
      <Group>
        <ToolButton label="Undo" icon={Undo2} onClick={() => chain().undo().run()} disabled={!state.canUndo} />
        <ToolButton label="Redo" icon={Redo2} onClick={() => chain().redo().run()} disabled={!state.canRedo} />
      </Group>
      <Divider />
      <Group>
        <ToolButton label="Bold" icon={Bold} active={state.bold} onClick={() => chain().toggleBold().run()} />
        <ToolButton label="Italic" icon={Italic} active={state.italic} onClick={() => chain().toggleItalic().run()} />
        <ToolButton label="Underline" icon={UnderlineIcon} active={state.underline} onClick={() => chain().toggleUnderline().run()} />
      </Group>
      <Divider />
      <Group>
        <ToolButton label="Paragraph" icon={Pilcrow} active={state.paragraph} onClick={() => chain().setParagraph().run()} />
        <ToolButton label="Heading 1" icon={Heading1} active={state.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()} />
        <ToolButton label="Heading 2" icon={Heading2} active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()} />
        <ToolButton label="Heading 3" icon={Heading3} active={state.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()} />
      </Group>
      <Divider />
      <Group>
        <ToolButton label="Bulleted list" icon={List} active={state.bullet} onClick={() => chain().toggleBulletList().run()} />
        <ToolButton label="Numbered list" icon={ListOrdered} active={state.ordered} onClick={() => chain().toggleOrderedList().run()} />
      </Group>
      <Divider />
      <Group>
        <ToolButton label="Align left" icon={AlignLeft} active={state.left} onClick={() => chain().setTextAlign("left").run()} />
        <ToolButton label="Align center" icon={AlignCenter} active={state.center} onClick={() => chain().setTextAlign("center").run()} />
        <ToolButton label="Align right" icon={AlignRight} active={state.right} onClick={() => chain().setTextAlign("right").run()} />
      </Group>
      <Divider />
      <Group>
        <ToolButton label="Horizontal line" icon={Minus} onClick={() => chain().setHorizontalRule().run()} />
        <ToolButton
          label="Insert table"
          icon={TableIcon}
          onClick={() => chain().insertTable({ rows: 3, cols: 2, withHeaderRow: false }).run()}
        />
        {state.inTable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" onMouseDown={(e) => e.preventDefault()}>
                <Rows3 data-icon="inline-start" />
                Table
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuItem onSelect={() => chain().addRowAfter().run()}>
                <BetweenHorizontalEnd />
                Add row below
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => chain().addColumnAfter().run()}>
                <BetweenVerticalEnd />
                Add column to the right
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => chain().deleteRow().run()}>
                <Trash2 />
                Delete row
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => chain().deleteColumn().run()}>
                <Trash2 />
                Delete column
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => chain().deleteTable().run()}>
                <Trash2 />
                Delete table
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Group>
    </div>
  );
}
