"use client";

/**
 * Agreements v2 — "Manage signatures" (Template Studio's right sidebar).
 *
 * The signed-in staff member's saved signatures: draw one or upload one, keep
 * several, choose the primary (the one "Your signature" uses), rename, delete,
 * and put any of them into the agreement at the cursor.
 *
 * Saved in `operator_signatures_v2` (hooks/use-operator-signatures-v2.ts). The
 * image rules (PNG or JPEG data URL, at most 512 000 characters, bytes that
 * match the type) are the editor's own (./editor/operator-signature-tab-v2).
 */

import { useRef, useState, type ChangeEvent } from "react";
import { Check, ImageUp, Loader2, PenLine, Plus, Star, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { Input } from "@/components/ui-v2/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui-v2/tabs";
import { toast } from "@/hooks/use-toast";
import { useOperatorSignaturesV2, type OperatorSignatureV2 } from "@/hooks/use-operator-signatures-v2";
import { SignaturePadV2 } from "@/components/agreements-v2/editor/signature-pad-v2";
import { readSignatureFile, SIGNATURE_LEGAL_LINE } from "@/components/agreements-v2/editor/operator-signature-tab-v2";
import { cn } from "@/lib/utils";

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : "Something went wrong. Try again.");

export function SignatureManagerDialogV2({
  open,
  onOpenChange,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Put this signature into the agreement at the cursor. Returns why it could not, or null. */
  onUse?: (src: string) => string | null;
}) {
  const { signatures, isLoading, add, setPrimary, rename, remove } = useOperatorSignaturesV2();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const act = async (id: string, fn: () => Promise<void>, done?: string) => {
    setBusyId(id);
    try {
      await fn();
      if (done) toast({ title: done });
    } catch (e) {
      toast({ title: "That didn't work", description: errorText(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const use = (s: OperatorSignatureV2) => {
    if (!onUse) return;
    const problem = onUse(s.imageData);
    if (problem) toast({ title: "Not added", description: problem, variant: "destructive" });
    else {
      toast({ title: "Signature added to the agreement" });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88dvh,52rem)] flex-col gap-5 sm:max-w-3xl">
        <DialogHeader className="pr-10">
          <DialogTitle className="font-heading text-xl font-semibold tracking-tight">Manage signatures</DialogTitle>
          <DialogDescription>
            Your own signatures, for agreements that carry the company's signature. The primary one is used by default.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-1">
          <section aria-label="Your signatures" className="space-y-3">
            {isLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[0, 1].map((i) => (
                  <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted" />
                ))}
              </div>
            ) : signatures.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No signatures yet. Draw or upload your first one below; it becomes your primary.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {signatures.map((s) => (
                  <SignatureCard
                    key={s.id}
                    signature={s}
                    busy={busyId === s.id}
                    disabled={busyId !== null}
                    canUse={!!onUse}
                    onUse={() => use(s)}
                    onPrimary={() => void act(s.id, () => setPrimary(s.id), "Primary signature changed")}
                    onRename={(label) => void act(s.id, () => rename(s.id, label))}
                    onDelete={() => void act(s.id, () => remove(s.id), "Signature deleted")}
                  />
                ))}
              </ul>
            )}
          </section>

          {adding || signatures.length === 0 ? (
            <AddSignature
              first={signatures.length === 0}
              onCancel={signatures.length === 0 ? undefined : () => setAdding(false)}
              onSave={async (input) => {
                await add(input);
                toast({ title: "Signature saved" });
                setAdding(false);
              }}
            />
          ) : (
            <Button type="button" variant="outline" className="w-full" onClick={() => setAdding(true)}>
              <Plus data-icon="inline-start" />
              Add a signature
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SignatureCard({
  signature,
  busy,
  disabled,
  canUse,
  onUse,
  onPrimary,
  onRename,
  onDelete,
}: {
  signature: OperatorSignatureV2;
  busy: boolean;
  disabled: boolean;
  canUse: boolean;
  onUse: () => void;
  onPrimary: () => void;
  onRename: (label: string) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(signature.label ?? "");
  const commit = () => {
    if ((signature.label ?? "") !== label.trim()) onRename(label);
  };
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-3",
        signature.isPrimary ? "border-primary/50 bg-primary/5" : "border-border",
      )}
    >
      <div className="flex h-24 items-center justify-center rounded-xl bg-white p-3 ring-1 ring-black/5">
        <img src={signature.imageData} alt={signature.label || "Signature"} className="max-h-full max-w-full object-contain" />
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          placeholder={signature.source === "uploaded" ? "Uploaded signature" : "Drawn signature"}
          aria-label="Signature name"
          maxLength={60}
          className="h-8 text-sm"
        />
        {signature.isPrimary ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
            <Star className="size-3.5 fill-current" aria-hidden="true" />
            Primary
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {canUse && (
          <Button type="button" size="sm" onClick={onUse} disabled={disabled}>
            <Check data-icon="inline-start" />
            Use here
          </Button>
        )}
        {!signature.isPrimary && (
          <Button type="button" variant="ghost" size="sm" onClick={onPrimary} disabled={disabled}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Star data-icon="inline-start" />}
            Make primary
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          disabled={disabled}
          aria-label="Delete this signature"
          title="Delete"
        >
          {busy && signature.isPrimary ? <Loader2 className="animate-spin" /> : <Trash2 />}
        </Button>
      </div>
    </li>
  );
}

function AddSignature({
  first,
  onCancel,
  onSave,
}: {
  first: boolean;
  onCancel?: () => void;
  onSave: (input: { imageData: string; source: "drawn" | "uploaded"; label?: string; makePrimary?: boolean }) => Promise<void>;
}) {
  const [mode, setMode] = useState<"draw" | "upload">("draw");
  const [drawn, setDrawn] = useState("");
  const [uploaded, setUploaded] = useState("");
  const [label, setLabel] = useState("");
  const [primary, setPrimary] = useState(first);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const image = mode === "draw" ? drawn : uploaded;

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const result = await readSignatureFile(file);
    if ("error" in result) {
      setProblem(result.error);
      setUploaded("");
    } else {
      setProblem(null);
      setUploaded(result.dataUrl);
    }
  };

  const save = async () => {
    if (!image) return;
    setSaving(true);
    setProblem(null);
    try {
      await onSave({ imageData: image, source: mode === "draw" ? "drawn" : "uploaded", label, makePrimary: primary });
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Add a signature" className="space-y-3 rounded-2xl border border-border p-4">
      <p className="text-sm font-medium text-foreground">{first ? "Add your first signature" : "Add a signature"}</p>
      <Tabs value={mode} onValueChange={(v) => setMode(v as "draw" | "upload")}>
        <TabsList className="w-full">
          <TabsTrigger value="draw" className="flex-1">
            <PenLine />
            Draw
          </TabsTrigger>
          <TabsTrigger value="upload" className="flex-1">
            <Upload />
            Upload
          </TabsTrigger>
        </TabsList>
        <TabsContent value="draw" className="pt-3">
          <SignaturePadV2 onChange={setDrawn} />
        </TabsContent>
        <TabsContent value="upload" className="pt-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 text-sm text-muted-foreground transition-colors duration-200 ease-out hover:border-primary/50 hover:text-foreground motion-reduce:transition-none"
          >
            {uploaded ? (
              <img src={uploaded} alt="Uploaded signature" className="max-h-28 max-w-[80%] rounded bg-white object-contain p-2" />
            ) : (
              <>
                <ImageUp className="size-6" aria-hidden="true" />
                Choose a PNG or JPEG of your signature
              </>
            )}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={pick} />
        </TabsContent>
      </Tabs>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name it (optional), e.g. Full signature"
          aria-label="Signature name"
          maxLength={60}
          className="h-9 sm:flex-1"
        />
        {!first && (
          <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />
            Make primary
          </label>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{SIGNATURE_LEGAL_LINE}</p>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button type="button" onClick={() => void save()} disabled={!image || saving}>
          {saving && <Loader2 className="animate-spin" data-icon="inline-start" />}
          Save signature
        </Button>
      </div>
    </section>
  );
}
