"use client";

/**
 * Agreements v2: the side panel's "Your signature" tab (build-spec D9, and the
 * BoldSign "Signature" dialog at 11:54: Draw / Upload, the legal line, Cancel
 * and "Save & use", which stays disabled until there is something to save).
 *
 * "Save & use" does two things: it keeps the image as this staff member's own
 * signature (`useOperatorSignatureV2().save`) and puts it into the agreement at
 * the cursor as `<img data-operator-signature="true" src="data:image/...">`.
 * Until ops/agreements_v2.sql is applied, `save` answers `{ persisted: false }`:
 * the image still goes into the agreement, and a quiet note says it will not
 * be remembered next time. Saving never blocks using.
 */

import { useRef, useState, type ChangeEvent } from "react";
import { Check, ImageUp, Info, Loader2, PenLine, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui-v2/tabs";
import { useOperatorSignatureV2 } from "@/hooks/use-operator-signature-v2";
import { SignaturePadV2 } from "./signature-pad-v2";
import { isOperatorSignatureSrc, OPERATOR_SIGNATURE_MAX_LENGTH } from "./operator-signature";

export const SIGNATURE_LEGAL_LINE = "I understand that this is a legal representation of my signature.";

/**
 * The booking app's own agreement engine (the one that sends at checkout)
 * prints plain text and cannot draw an image, so the operator's signature is
 * only in agreements sent from the portal. Said once, quietly.
 */
export const BOOKING_SITE_SIGNATURE_NOTE =
  "Your signature is added to agreements sent from the portal. Agreements your booking site sends automatically at checkout don't include it yet.";

/**
 * The largest file whose data URL still fits the 512 000-character cap the
 * table and the hook enforce: base64 grows a file by 4/3, plus the prefix.
 * About 375 kB.
 */
export const SIGNATURE_UPLOAD_MAX_BYTES = Math.floor((OPERATOR_SIGNATURE_MAX_LENGTH - "data:image/jpeg;base64,".length) / 4) * 3;
const MAX_KB = Math.floor(SIGNATURE_UPLOAD_MAX_BYTES / 1024);

/** Why this file cannot be used, or null. Checked before it is read. */
export function checkSignatureFile(file: Pick<File, "type" | "size">): string | null {
  if (file.type !== "image/png" && file.type !== "image/jpeg") return "Choose a PNG or JPEG image.";
  if (file.size > SIGNATURE_UPLOAD_MAX_BYTES) return `That image is too large. Choose one under ${MAX_KB} kB.`;
  return null;
}

/**
 * Does the data URL's content match its declared type? A GIF renamed to .png
 * is declared image/png by the browser; the PDF renderer would fail on it at
 * send time, so it is refused here instead.
 */
export function signatureBytesMatchType(dataUrl: string): boolean {
  if (dataUrl.startsWith("data:image/png;base64,")) return dataUrl.slice(22).startsWith("iVBORw0KGgo");
  if (dataUrl.startsWith("data:image/jpeg;base64,")) return dataUrl.slice(23).startsWith("/9j/");
  return false;
}

export function readSignatureFile(file: File): Promise<{ dataUrl: string } | { error: string }> {
  const problem = checkSignatureFile(file);
  if (problem) return Promise.resolve({ error: problem });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve({ error: "That image could not be read. Try another file." });
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!isOperatorSignatureSrc(dataUrl) || !signatureBytesMatchType(dataUrl)) {
        resolve({ error: "That file is not a PNG or JPEG image." });
        return;
      }
      resolve({ dataUrl });
    };
    reader.readAsDataURL(file);
  });
}

type Note = { tone: "ok" | "quiet" | "warn"; text: string } | null;

function SignatureImage({ src }: { src: string }) {
  return (
    <div className="flex h-24 items-center justify-center rounded-2xl border border-border bg-white p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, not a remote image */}
      <img src={src} alt="Your signature" className="max-h-full max-w-full object-contain" />
    </div>
  );
}

/**
 * `onUse` puts the image into the agreement at the cursor. It returns why it
 * could not (inside a table or a list, say), or nothing when it did.
 */
export function OperatorSignatureTabV2({ onUse }: { onUse: (src: string) => string | null | void }) {
  const { signature, isLoading, save } = useOperatorSignatureV2();
  const [replacing, setReplacing] = useState(false);
  const [method, setMethod] = useState<"draw" | "upload">("draw");
  const [drawn, setDrawn] = useState("");
  const [uploaded, setUploaded] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<Note>(null);
  // Bumped to remount the pad, which is how a draft drawing is thrown away.
  const [padKey, setPadKey] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const draft = method === "draw" ? drawn : uploaded;
  const capturing = replacing || !signature;

  const resetDraft = () => {
    setDrawn("");
    setUploaded("");
    setUploadError(null);
    setPadKey((k) => k + 1);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const result = await readSignatureFile(file);
    if ("error" in result) {
      setUploaded("");
      setUploadError(result.error);
    } else {
      setUploaded(result.dataUrl);
      setUploadError(null);
    }
  };

  const saveAndUse = async () => {
    if (!isOperatorSignatureSrc(draft) || saving) return;
    setSaving(true);
    setNote(null);
    let persisted = false;
    let failed = false;
    try {
      persisted = (await save(draft)).persisted;
    } catch {
      failed = true;
    }
    // Into the agreement whatever happened to the save: keeping it for next
    // time is a convenience, using it now is what the operator asked for.
    const refused = onUse(draft);
    setSaving(false);
    if (refused) {
      // Not put in (the cursor is somewhere the PDF cannot print it). A kept
      // signature is one click away once the cursor moves; one that was not
      // kept stays drafted here, so Save & use can simply be pressed again.
      setNote({ tone: "warn", text: persisted ? `Saved as your signature, but not added. ${refused}` : `Not added. ${refused}` });
      if (persisted) {
        setReplacing(false);
        resetDraft();
      }
      return;
    }
    if (persisted) {
      setNote({ tone: "ok", text: "Saved as your signature and added to the agreement." });
      setReplacing(false);
      resetDraft();
    } else {
      setNote({
        tone: failed ? "warn" : "quiet",
        text: failed
          ? "Added to the agreement, but it could not be saved for next time. Try again later."
          : "Added to the agreement. It is not kept for next time yet, so you will add it again on the next agreement.",
      });
    }
  };

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading your signature…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Your own signature, for the company&apos;s side of the agreement. It is drawn into the document where you put it.
      </p>
      <p className="text-xs text-muted-foreground" data-slot="booking-site-signature-note">
        {BOOKING_SITE_SIGNATURE_NOTE}
      </p>

      {!capturing && signature && (
        <div className="flex flex-col gap-3">
          <SignatureImage src={signature} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const refused = onUse(signature);
                setNote(refused ? { tone: "warn", text: `Not added. ${refused}` } : null);
              }}
            >
              <Check data-icon="inline-start" />
              Use my signature
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setReplacing(true);
                setNote(null);
              }}
            >
              <RefreshCw data-icon="inline-start" />
              Replace
            </Button>
          </div>
        </div>
      )}

      {capturing && (
        <div className="flex flex-col gap-3">
          <Tabs value={method} onValueChange={(v) => setMethod(v as "draw" | "upload")}>
            <TabsList className="w-full">
              <TabsTrigger value="draw">
                <PenLine />
                Draw
              </TabsTrigger>
              <TabsTrigger value="upload">
                <Upload />
                Upload
              </TabsTrigger>
            </TabsList>
            <TabsContent value="draw" className="pt-1">
              <SignaturePadV2 key={padKey} onChange={setDrawn} />
            </TabsContent>
            <TabsContent value="upload" className="flex flex-col gap-2 pt-1">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="sr-only"
                aria-label="Upload your signature"
                onChange={(e) => void onFile(e)}
              />
              {uploaded ? (
                <SignatureImage src={uploaded} />
              ) : (
                <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border text-center text-xs text-muted-foreground">
                  <ImageUp className="size-5" aria-hidden="true" />
                  PNG or JPEG, up to {MAX_KB} kB
                </div>
              )}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload data-icon="inline-start" />
                  {uploaded ? "Choose another image" : "Choose an image"}
                </Button>
              </div>
              {uploadError && (
                <p role="alert" className="text-xs text-destructive">
                  {uploadError}
                </p>
              )}
            </TabsContent>
          </Tabs>

          <p className="text-xs text-muted-foreground">{SIGNATURE_LEGAL_LINE}</p>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => {
                resetDraft();
                setReplacing(false);
              }}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={!isOperatorSignatureSrc(draft) || saving} onClick={() => void saveAndUse()}>
              {saving && <Loader2 data-icon="inline-start" className="animate-spin" />}
              Save &amp; use
            </Button>
          </div>
        </div>
      )}

      {note && (
        <p
          role="status"
          className={
            note.tone === "warn"
              ? "flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
              : "flex items-start gap-1.5 text-xs text-muted-foreground"
          }
        >
          {note.tone === "ok" ? (
            <Check className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          )}
          {note.text}
        </p>
      )}
    </div>
  );
}
