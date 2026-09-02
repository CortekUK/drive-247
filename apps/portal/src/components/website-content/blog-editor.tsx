import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { common, createLowlight } from "lowlight";
import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Link as LinkIcon,
  Unlink,
  Undo,
  Redo,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Minus,
  ImageIcon,
  Youtube as YoutubeIcon,
  Upload,
  Loader2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Highlighter,
  Code,
  TableIcon,
  Columns,
  RowsIcon,
  Trash2,
  ChevronDown,
  Type,
  Pilcrow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface BlogEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  className?: string;
  editable?: boolean;
}

function getWordCount(html: string): number {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return 0;
  return text.split(" ").length;
}

function getReadingTime(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 200));
}

const lowlight = createLowlight(common);

// ---- Toolbar Button ----
function ToolbarButton({
  onClick,
  active,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center justify-center rounded-md p-1.5 text-sm transition-colors",
        "hover:bg-accent/10 hover:text-accent-foreground disabled:opacity-40 disabled:pointer-events-none",
        active && "bg-accent/15 text-accent-foreground"
      )}
    >
      {children}
    </button>
  );
}

export function BlogEditor({
  content,
  onChange,
  placeholder = "Start writing... Use '/' for commands",
  className,
  editable = true,
}: BlogEditorProps) {
  const [wordCount, setWordCount] = useState(0);
  const [imageUrl, setImageUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [imagePopoverOpen, setImagePopoverOpen] = useState(false);
  const [youtubePopoverOpen, setYoutubePopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorWrapperRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-indigo-600 underline cursor-pointer" },
      }),
      Image.configure({
        HTMLAttributes: { class: "rounded-lg max-w-full h-auto my-4" },
        allowBase64: true,
      }),
      Youtube.configure({
        HTMLAttributes: { class: "rounded-lg my-4 aspect-video w-full" },
        width: 640,
        height: 360,
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Highlight.configure({
        multicolor: true,
        HTMLAttributes: { class: "rounded px-1" },
      }),
      TextStyle,
      Color,
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: { class: "rounded-lg bg-slate-900 text-slate-100 p-4 my-4 text-sm font-mono overflow-x-auto" },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: { class: "border-collapse table-auto w-full my-4" },
      }),
      TableRow,
      TableHeader.configure({
        HTMLAttributes: { class: "border border-border bg-muted/50 px-3 py-2 text-left font-semibold text-sm" },
      }),
      TableCell.configure({
        HTMLAttributes: { class: "border border-border px-3 py-2 text-sm" },
      }),
    ],
    content: content || "",
    editorProps: {
      attributes: {
        class:
          "min-h-[500px] px-8 py-6 focus:outline-none text-[15px] leading-relaxed",
      },
      handleDrop: (view, event, _slice, moved) => {
        if (!moved && event.dataTransfer?.files?.length) {
          const file = event.dataTransfer.files[0];
          if (file.type.startsWith("image/")) {
            event.preventDefault();
            handleImageUpload(file);
            return true;
          }
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of Array.from(items)) {
            if (item.type.startsWith("image/")) {
              event.preventDefault();
              const file = item.getAsFile();
              if (file) handleImageUpload(file);
              return true;
            }
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html);
      setWordCount(getWordCount(html));
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
      setWordCount(getWordCount(content || ""));
    }
  }, [content, editor]);

  const handleSetLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href;
    setLinkUrl(previousUrl || "https://");
    setLinkPopoverOpen(true);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor) return;
    if (!linkUrl || linkUrl === "https://") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: linkUrl })
        .run();
    }
    setLinkPopoverOpen(false);
    setLinkUrl("");
  }, [editor, linkUrl]);

  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file (PNG, JPG, WebP)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Please upload an image smaller than 10MB");
      return;
    }

    setUploading(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `blog/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("cms-media")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("cms-media").getPublicUrl(fileName);

      editor?.chain().focus().setImage({ src: publicUrl, alt: file.name }).run();
      toast.success("Image uploaded");
      setImagePopoverOpen(false);
    } catch (error: any) {
      console.error("Blog image upload error:", error);
      toast.error(error.message || "Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const insertImageUrl = () => {
    if (!imageUrl.trim() || !editor) return;
    editor.chain().focus().setImage({ src: imageUrl.trim() }).run();
    setImageUrl("");
    setImagePopoverOpen(false);
  };

  const insertYoutube = () => {
    if (!youtubeUrl.trim() || !editor) return;
    editor.chain().focus().setYoutubeVideo({ src: youtubeUrl.trim() }).run();
    setYoutubeUrl("");
    setYoutubePopoverOpen(false);
  };

  // Drag & drop zone handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith("image/")) {
      handleImageUpload(file);
    }
  };

  if (!editor) return null;

  const readingTime = getReadingTime(wordCount);

  // Current block type label
  const getBlockLabel = () => {
    if (editor.isActive("heading", { level: 1 })) return "Heading 1";
    if (editor.isActive("heading", { level: 2 })) return "Heading 2";
    if (editor.isActive("heading", { level: 3 })) return "Heading 3";
    if (editor.isActive("codeBlock")) return "Code Block";
    if (editor.isActive("blockquote")) return "Quote";
    return "Paragraph";
  };

  return (
    <div
      ref={editorWrapperRef}
      className={cn(
        "border rounded-xl overflow-hidden bg-background transition-all duration-200",
        isDragOver && "ring-2 ring-indigo-500/40 border-indigo-400",
        className
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ====== TOOLBAR ====== */}
      <div className="border-b bg-muted/20 px-3 py-1.5 flex flex-wrap items-center gap-0.5">
        {/* Undo/Redo */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo"
        >
          <Undo className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo"
        >
          <Redo className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-5 mx-1.5" />

        {/* Block type dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-accent/10 transition-colors min-w-[120px]"
            >
              <Pilcrow className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs">{getBlockLabel()}</span>
              <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem
              onClick={() => editor.chain().focus().setParagraph().run()}
              className="gap-2"
            >
              <Type className="h-4 w-4" />
              <span>Paragraph</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
              className="gap-2"
            >
              <Heading1 className="h-4 w-4" />
              <span className="font-bold text-lg">Heading 1</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
              className="gap-2"
            >
              <Heading2 className="h-4 w-4" />
              <span className="font-semibold">Heading 2</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 3 }).run()
              }
              className="gap-2"
            >
              <Heading3 className="h-4 w-4" />
              <span className="font-medium text-sm">Heading 3</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                editor.chain().focus().toggleBulletList().run()
              }
              className="gap-2"
            >
              <List className="h-4 w-4" />
              <span>Bullet List</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                editor.chain().focus().toggleOrderedList().run()
              }
              className="gap-2"
            >
              <ListOrdered className="h-4 w-4" />
              <span>Numbered List</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                editor.chain().focus().toggleBlockquote().run()
              }
              className="gap-2"
            >
              <Quote className="h-4 w-4" />
              <span>Blockquote</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                editor.chain().focus().toggleCodeBlock().run()
              }
              className="gap-2"
            >
              <Code className="h-4 w-4" />
              <span>Code Block</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                editor.chain().focus().setHorizontalRule().run()
              }
              className="gap-2"
            >
              <Minus className="h-4 w-4" />
              <span>Divider</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-5 mx-1.5" />

        {/* Inline formatting */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold (⌘B)"
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic (⌘I)"
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title="Underline (⌘U)"
        >
          <UnderlineIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title="Strikethrough"
        >
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHighlight({ color: "#fef08a" }).run()}
          active={editor.isActive("highlight")}
          title="Highlight"
        >
          <Highlighter className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive("code")}
          title="Inline Code"
        >
          <Code className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-5 mx-1.5" />

        {/* Alignment */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          active={editor.isActive({ textAlign: "left" })}
          title="Align Left"
        >
          <AlignLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          active={editor.isActive({ textAlign: "center" })}
          title="Align Center"
        >
          <AlignCenter className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          active={editor.isActive({ textAlign: "right" })}
          title="Align Right"
        >
          <AlignRight className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
          active={editor.isActive({ textAlign: "justify" })}
          title="Justify"
        >
          <AlignJustify className="h-4 w-4" />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-5 mx-1.5" />

        {/* Link */}
        <Popover open={linkPopoverOpen} onOpenChange={setLinkPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={handleSetLink}
              className={cn(
                "inline-flex items-center justify-center rounded-md p-1.5 text-sm transition-colors",
                "hover:bg-accent/10 hover:text-accent-foreground",
                editor.isActive("link") && "bg-accent/15 text-accent-foreground"
              )}
              title="Insert Link"
            >
              <LinkIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-3" align="start">
            <p className="text-sm font-medium">Insert Link</p>
            <Input
              placeholder="https://example.com"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyLink()}
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                className="flex-1"
                onClick={applyLink}
              >
                Apply
              </Button>
              {editor.isActive("link") && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    editor.chain().focus().unsetLink().run();
                    setLinkPopoverOpen(false);
                  }}
                >
                  <Unlink className="h-3.5 w-3.5 mr-1" />
                  Remove
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Separator orientation="vertical" className="h-5 mx-1.5" />

        {/* Image */}
        <Popover open={imagePopoverOpen} onOpenChange={setImagePopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md p-1.5 text-sm transition-colors hover:bg-accent/10"
              title="Insert Image"
            >
              <ImageIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-3" align="start">
            <p className="text-sm font-medium">Insert Image</p>
            <div className="space-y-2">
              <Input
                placeholder="https://example.com/image.jpg"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && insertImageUrl()}
              />
              <Button
                type="button"
                size="sm"
                className="w-full"
                onClick={insertImageUrl}
                disabled={!imageUrl.trim()}
              >
                Insert URL
              </Button>
            </div>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-popover px-2 text-muted-foreground">
                  or
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Image
                </>
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              Or drag & drop an image into the editor
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageUpload(file);
                e.target.value = "";
              }}
            />
          </PopoverContent>
        </Popover>

        {/* YouTube */}
        <Popover open={youtubePopoverOpen} onOpenChange={setYoutubePopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md p-1.5 text-sm transition-colors hover:bg-accent/10"
              title="Embed YouTube Video"
            >
              <YoutubeIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-3" align="start">
            <p className="text-sm font-medium">Embed YouTube Video</p>
            <Input
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && insertYoutube()}
            />
            <Button
              type="button"
              size="sm"
              className="w-full"
              onClick={insertYoutube}
              disabled={!youtubeUrl.trim()}
            >
              Embed Video
            </Button>
          </PopoverContent>
        </Popover>

        {/* Table */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex items-center justify-center rounded-md p-1.5 text-sm transition-colors hover:bg-accent/10",
                editor.isActive("table") && "bg-accent/15"
              )}
              title="Table"
            >
              <TableIcon className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {!editor.isActive("table") ? (
              <DropdownMenuItem
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                    .run()
                }
                className="gap-2"
              >
                <TableIcon className="h-4 w-4" />
                Insert Table (3x3)
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().addColumnAfter().run()}
                  className="gap-2"
                >
                  <Columns className="h-4 w-4" />
                  Add Column After
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().addRowAfter().run()}
                  className="gap-2"
                >
                  <RowsIcon className="h-4 w-4" />
                  Add Row After
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().deleteColumn().run()}
                  className="gap-2 text-red-600"
                >
                  <Columns className="h-4 w-4" />
                  Delete Column
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().deleteRow().run()}
                  className="gap-2 text-red-600"
                >
                  <RowsIcon className="h-4 w-4" />
                  Delete Row
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => editor.chain().focus().deleteTable().run()}
                  className="gap-2 text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Table
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ====== BUBBLE MENU (appears on text selection) ====== */}
      <BubbleMenu
        editor={editor}
        tippyOptions={{ duration: 150, placement: "top" }}
        className="flex items-center gap-0.5 rounded-lg border bg-background shadow-lg px-1 py-0.5"
      >
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarButton>
        <Separator orientation="vertical" className="h-4 mx-0.5" />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHighlight({ color: "#fef08a" }).run()}
          active={editor.isActive("highlight")}
        >
          <Highlighter className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive("code")}
        >
          <Code className="h-3.5 w-3.5" />
        </ToolbarButton>
        <Separator orientation="vertical" className="h-4 mx-0.5" />
        <ToolbarButton onClick={handleSetLink} active={editor.isActive("link")}>
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        {editor.isActive("link") && (
          <ToolbarButton
            onClick={() => editor.chain().focus().unsetLink().run()}
          >
            <Unlink className="h-3.5 w-3.5" />
          </ToolbarButton>
        )}
      </BubbleMenu>

      {/* ====== EDITOR CONTENT ====== */}
      <div className="relative">
        {uploading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <div className="flex items-center gap-2 rounded-lg bg-background border shadow-lg px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              <span className="text-sm font-medium">Uploading image...</span>
            </div>
          </div>
        )}
        <EditorContent editor={editor} />
      </div>

      {/* ====== FOOTER ====== */}
      <div className="border-t bg-muted/20 px-4 py-2 flex justify-between items-center text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{wordCount.toLocaleString()} words</span>
          <span className="text-muted-foreground/40">|</span>
          <span>{readingTime} min read</span>
        </div>
        <div className="flex items-center gap-2">
          {uploading && (
            <span className="flex items-center gap-1 text-indigo-600">
              <Loader2 className="h-3 w-3 animate-spin" />
              Uploading...
            </span>
          )}
          <span className="text-muted-foreground/60">
            Drag & drop images supported
          </span>
        </div>
      </div>

      {/* ====== EDITOR STYLES ====== */}
      <style>{`
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: hsl(var(--muted-foreground) / 0.4);
          pointer-events: none;
          height: 0;
          font-style: italic;
        }
        .tiptap:focus {
          outline: none;
        }
        .tiptap {
          min-height: 500px;
        }
        .tiptap > * + * {
          margin-top: 0.5em;
        }
        .tiptap ul {
          list-style-type: disc;
          padding-left: 1.5rem;
        }
        .tiptap ol {
          list-style-type: decimal;
          padding-left: 1.5rem;
        }
        .tiptap ul li,
        .tiptap ol li {
          margin-bottom: 0.25em;
        }
        .tiptap h1 {
          font-size: 2rem;
          font-weight: 700;
          margin-top: 2rem;
          margin-bottom: 0.75rem;
          line-height: 1.2;
          letter-spacing: -0.02em;
        }
        .tiptap h2 {
          font-size: 1.5rem;
          font-weight: 600;
          margin-top: 1.75rem;
          margin-bottom: 0.5rem;
          line-height: 1.3;
          letter-spacing: -0.01em;
        }
        .tiptap h3 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-top: 1.5rem;
          margin-bottom: 0.5rem;
          line-height: 1.4;
        }
        .tiptap p {
          margin-bottom: 0.75rem;
          line-height: 1.75;
        }
        .tiptap blockquote {
          border-left: 3px solid hsl(var(--border));
          padding-left: 1rem;
          margin-left: 0;
          margin-top: 1rem;
          margin-bottom: 1rem;
          font-style: italic;
          color: hsl(var(--muted-foreground));
        }
        .tiptap hr {
          border: none;
          border-top: 2px solid hsl(var(--border));
          margin: 2rem 0;
        }
        .tiptap img {
          max-width: 100%;
          height: auto;
          border-radius: 0.5rem;
          margin: 1.5rem 0;
        }
        .tiptap img.ProseMirror-selectednode {
          outline: 2px solid #6366f1;
          outline-offset: 2px;
          border-radius: 0.5rem;
        }
        .tiptap iframe {
          max-width: 100%;
          border-radius: 0.5rem;
          margin: 1.5rem 0;
        }
        .tiptap a {
          color: #6366f1;
          text-decoration: underline;
          cursor: pointer;
        }
        .tiptap code {
          background-color: hsl(var(--muted));
          border-radius: 0.25rem;
          padding: 0.15em 0.3em;
          font-size: 0.875em;
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
        }
        .tiptap pre {
          background: #0f172a;
          color: #e2e8f0;
          border-radius: 0.5rem;
          padding: 1rem 1.25rem;
          margin: 1.5rem 0;
          overflow-x: auto;
          font-size: 0.875rem;
          line-height: 1.6;
        }
        .tiptap pre code {
          background: none;
          padding: 0;
          font-size: inherit;
          color: inherit;
          border-radius: 0;
        }
        .tiptap mark {
          border-radius: 0.15em;
          padding: 0.05em 0.2em;
          box-decoration-break: clone;
        }
        .tiptap table {
          border-collapse: collapse;
          table-layout: auto;
          width: 100%;
          margin: 1.5rem 0;
          overflow: hidden;
        }
        .tiptap table td,
        .tiptap table th {
          border: 1px solid hsl(var(--border));
          padding: 0.5rem 0.75rem;
          vertical-align: top;
          position: relative;
          min-width: 80px;
        }
        .tiptap table th {
          font-weight: 600;
          background: hsl(var(--muted) / 0.5);
          text-align: left;
        }
        .tiptap table .selectedCell:after {
          content: "";
          position: absolute;
          inset: 0;
          background: rgba(99, 102, 241, 0.1);
          pointer-events: none;
        }
        .tiptap table .column-resize-handle {
          position: absolute;
          right: -2px;
          top: 0;
          bottom: -2px;
          width: 4px;
          background-color: #6366f1;
          pointer-events: none;
        }
        .tiptap .tableWrapper {
          overflow-x: auto;
          margin: 1.5rem 0;
        }
      `}</style>
    </div>
  );
}

export { getWordCount, getReadingTime };
