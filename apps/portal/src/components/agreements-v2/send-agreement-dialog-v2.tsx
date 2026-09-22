"use client";

/**
 * Agreements v2: Send agreement, for an INDIVIDUAL agreement (D12, D13;
 * transcript 07:27–08:12, 15:22–16:55).
 *
 * Three steps, Back and Next between them:
 *
 *  1. Details. Recipient name and email (one recipient), CC (any number of
 *     addresses, typed or pasted, separated by commas or spaces, each one a
 *     removable chip), the document title (the chosen template's name until
 *     the operator edits it) and an optional message. There is no email/SMS
 *     choice: the signing service emails the recipient and the CC itself,
 *     with the title and the message, under the tenant's own brand (D13).
 *  2. Template. The tenant's templates, the default first and pre-selected,
 *     searchable by name, or Create new. Create new opens the editor on a
 *     starter document that ends with the two-part signatures section, and
 *     what is written there is sent this once: NO template is created.
 *  3. Preview. The document exactly as it will be sent: rendered through the
 *     one pipeline the send uses (renderAgreementHtml + ensureSignatureTag),
 *     with this recipient's details and the tenant's real company details.
 *     Send renders the same content with the same company details in 'send'
 *     mode, draws the PDF from that html in the browser, and hands both to
 *     the `agreements-v2` edge function (lib/agreements-v2/api-client.ts).
 *     Edit opens the editor on a COPY; the template is never touched. Send
 *     says it uses e-sign credits, and a failure is shown here, inline. A
 *     document with a signer field in it twice cannot be sent (it can confuse
 *     the signing service): Send is disabled and says why.
 *
 * THE COMPANY DETAILS come from the same source the templates section uses
 * (templates-section-v2.tsx: `tenants` company_name, contact_email,
 * contact_phone falling back to phone, address, under its query key, so the
 * two share one read), with TenantContext standing in until it answers. The
 * preview and the send are both built from `companyV2` below, so the two agree.
 *
 * Nothing here writes a template: the only network call is `sendAgreementV2`.
 * Everything resets when the dialog closes.
 */

import { useEffect, useId, useMemo, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, Pencil, Send, X } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Label } from "@/components/ui-v2/label";
import { Textarea } from "@/components/ui-v2/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";
import { defaultTemplateFor, useAgreementTemplatesV2 } from "@/hooks/use-agreement-templates-v2";
import { buildIndividualData, ensureSignatureTag, renderAgreementHtml } from "@/lib/agreements-v2/render";
import { toStatusV2 } from "@/lib/agreements-v2/status";
import {
  checkAgreementsReadyV2,
  sendAgreementV2,
  type AgreementCompanyV2,
  type AgreementsReadinessV2,
} from "@/lib/agreements-v2/api-client";
import {
  CC_MAX,
  MESSAGE_MAX,
  RECIPIENT_NAME_MAX,
  TITLE_MAX,
  isValidEmailV2,
  splitEmailsV2,
  validateIndividualSendV2,
} from "@/lib/agreements-v2/validation";
import { isBlankHtml } from "@/components/settings-v2/message-rules";
import { TemplatePickerV2 } from "@/components/agreements-v2/template-picker-v2";
import { AgreementEditorV2 } from "@/components/agreements-v2/editor/agreement-editor-v2";
import { duplicateSignerFieldsReasonV2 } from "@/components/agreements-v2/editor/starter-content";
import { AgreementPreviewV2 } from "@/components/agreements-v2/agreement-preview-v2";
import {
  TEMPLATE_PREVIEW_COMPANY_COLUMNS,
  templateCompanyV2QueryKey,
  withSignaturesSectionV2,
  type TemplateCompanyRowV2,
} from "@/components/agreements-v2/templates-section-v2";
import { cn } from "@/lib/utils";

type Step = "details" | "template" | "preview";
const STEPS: ReadonlyArray<{ key: Step; label: string }> = [
  { key: "details", label: "Details" },
  { key: "template", label: "Template" },
  { key: "preview", label: "Preview" },
];

/** What the document is called when it does not come from a named template. */
export const FALLBACK_TITLE = "Agreement";

export const MESSAGE_HELP = "Included in the email the recipient gets, and shown where they sign.";
export const CC_HELP = "Enter one or more email addresses, separated by a comma.";
export const CREDITS_NOTE = "Sending uses e-sign credits.";

/**
 * Why names are highlighted on an INDIVIDUAL agreement, and what to do. A
 * template written for rentals (the built-in agreement is one) carries the
 * vehicle, dates, prices and so on, and an agreement not linked to a rental
 * has nothing to fill them — so they print blank. Saying only "left blank"
 * left the operator guessing why.
 */
export function individualUnresolvedNoteV2(count: number): string {
  const what = count === 1 ? "1 highlighted detail" : `${count} highlighted details`;
  return `${what} in this template come from a rental (like the vehicle, dates or prices). This agreement isn't linked to a rental, so ${count === 1 ? "it is" : "they are"} left blank. Use Edit to remove or change ${count === 1 ? "it" : "them"}, or pick a template written for this.`;
}

/**
 * The document being sent when it is not simply a template's saved wording: a
 * one-off edit of a template (`templateId` is where it started), or one written
 * with Create new (`templateId` null). Either way it is used for this send only.
 */
interface DraftV2 {
  content: string;
  templateId: string | null;
}

interface EditorState {
  purpose: "create" | "edit";
  initialContent: string;
}

type FieldErrors = Partial<Record<"recipientName" | "recipientEmail" | "cc" | "title" | "message", string>>;

/**
 * Add the addresses in `text` to `list`. Returns the new list, what could not
 * be added (left in the input for the operator to fix), and why the first of
 * those was refused.
 */
export function addCcAddressesV2(
  list: readonly string[],
  text: string,
  recipientEmail: string,
): { list: string[]; rejected: string[]; error: string | null } {
  const next = [...list];
  const rejected: string[] = [];
  let error: string | null = null;
  const refuse = (email: string, why: string) => {
    rejected.push(email);
    if (!error) error = why;
  };
  for (const email of splitEmailsV2(text)) {
    const key = email.toLowerCase();
    if (!isValidEmailV2(email)) refuse(email, `${email} is not a valid email address.`);
    else if (key === recipientEmail.trim().toLowerCase()) refuse(email, `${email} is already the recipient.`);
    else if (next.some((e) => e.toLowerCase() === key)) continue;
    else if (next.length >= CC_MAX) refuse(email, `You can copy in at most ${CC_MAX} people.`);
    else next.push(email);
  }
  return { list: next, rejected, error };
}

/** The tenant's company details for the document, as the templates section reads them. */
function useCompanyDetailsV2(): TemplateCompanyRowV2 | null {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const query = useQuery({
    queryKey: templateCompanyV2QueryKey(tenantId),
    queryFn: async (): Promise<TemplateCompanyRowV2 | null> => {
      const { data, error } = await supabase
        .from("tenants")
        .select(TEMPLATE_PREVIEW_COMPANY_COLUMNS)
        .eq("id", tenantId as string)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as TemplateCompanyRowV2 | null;
    },
    enabled: !!tenantId,
    staleTime: 60_000,
    retry: 1,
  });
  if (query.data) return query.data;
  return tenant ? { company_name: tenant.company_name, contact_email: tenant.contact_email, phone: tenant.phone } : null;
}

export interface SendAgreementDialogV2Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  /**
   * Called once a send is RECORDED, so the list can refresh: after a send, and
   * also after one that went into the list as Failed (no credits, or refused).
   */
  onSent?(): void;
}

export function SendAgreementDialogV2({ open, onOpenChange, onSent }: SendAgreementDialogV2Props) {
  const baseId = useId();
  const fieldId = (name: string) => `${baseId}-${name}`;
  const { tenant } = useTenant();
  const company = useCompanyDetailsV2();
  const { templates, isLoading: templatesLoading, error: templatesError, refetch: refetchTemplates } = useAgreementTemplatesV2();

  const [step, setStep] = useState<Step>("details");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [cc, setCc] = useState<string[]>([]);
  const [ccDraft, setCcDraft] = useState("");
  const [title, setTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [draft, setDraft] = useState<DraftV2 | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Asked when the dialog opens: the agreements service not deployed yet, the
  // one-time database update not applied yet, or e-signing not set up, is said
  // on step 1 — not after three steps. null while asking, or when the check itself could not be
  // reached (then nothing is blocked and the send reports its own error).
  const [readiness, setReadiness] = useState<AgreementsReadinessV2 | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    checkAgreementsReadyV2()
      .then((result) => live && setReadiness(result))
      .catch(() => live && setReadiness(null));
    return () => {
      live = false;
    };
  }, [open]);
  const notReady = readiness?.ready === false ? readiness : null;

  // Everything starts over when the dialog closes.
  useEffect(() => {
    if (open) return;
    setStep("details");
    setRecipientName("");
    setRecipientEmail("");
    setCc([]);
    setCcDraft("");
    setTitle("");
    setTitleEdited(false);
    setMessage("");
    setErrors({});
    setSelectedId(null);
    setSelectionTouched(false);
    setDraft(null);
    setTemplateError(null);
    setEditor(null);
    setSending(false);
    setSendError(null);
    setReadiness(null);
  }, [open]);

  // The default template is pre-selected once the templates arrive.
  useEffect(() => {
    if (!open || selectionTouched || draft || selectedId) return;
    const initial = defaultTemplateFor(templates, "standard") ?? templates[0] ?? null;
    if (initial) setSelectedId(initial.id);
  }, [open, templates, selectionTouched, draft, selectedId]);

  const selected = useMemo(() => templates.find((t) => t.id === selectedId) ?? null, [templates, selectedId]);
  const isCustom = !!draft && draft.templateId === null;
  const defaultTitle = isCustom ? FALLBACK_TITLE : selected?.name.trim() || FALLBACK_TITLE;
  const titleValue = titleEdited ? title : defaultTitle;
  const content = draft ? draft.content : selected?.content ?? "";
  const templateIdForSend = draft ? draft.templateId : selected?.id ?? null;
  // Each signer field once (the send path defines each tag once, for signer
  // 1): a document with one twice can confuse the signing service, so Send is
  // refused, with why, until the operator edits it down to one.
  const duplicateReason = useMemo(() => duplicateSignerFieldsReasonV2(content), [content]);

  // The company variables, the same for the preview and the send.
  const companyV2 = useMemo<AgreementCompanyV2>(
    () => ({
      companyName: company?.company_name ?? "",
      companyEmail: company?.contact_email ?? "",
      companyPhone: company?.contact_phone || company?.phone || "",
      companyAddress: company?.address ?? "",
    }),
    [company?.company_name, company?.contact_email, company?.contact_phone, company?.phone, company?.address],
  );
  const timeZone = tenant?.timezone || undefined;
  const previewData = useMemo(
    () => buildIndividualData({ ...companyV2, recipientName, recipientEmail, timeZone }),
    [companyV2, recipientName, recipientEmail, timeZone],
  );
  const previewHtml = useMemo(
    () => (step === "preview" ? ensureSignatureTag(renderAgreementHtml(content, previewData, { mode: "preview", markMissing: true })) : ""),
    [step, content, previewData],
  );

  /* ── step 1 ─────────────────────────────────────────────────────────── */

  /** Turn whatever is typed in the CC box into chips; what cannot be added stays there. */
  const commitCc = (text: string = ccDraft): boolean => {
    if (!text.trim()) {
      setErrors((e) => ({ ...e, cc: undefined }));
      return true;
    }
    const result = addCcAddressesV2(cc, text, recipientEmail);
    setCc(result.list);
    setCcDraft(result.rejected.join(", "));
    setErrors((e) => ({ ...e, cc: result.error ?? undefined }));
    return result.rejected.length === 0;
  };

  const onCcKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || event.key === ";" || event.key === " ") {
      event.preventDefault();
      commitCc();
    } else if (event.key === "Backspace" && ccDraft === "" && cc.length > 0) {
      setCc((list) => list.slice(0, -1));
    }
  };

  const onCcPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!/[\s,;]/.test(pasted)) return;
    event.preventDefault();
    commitCc(`${ccDraft} ${pasted}`);
  };

  const removeCc = (email: string) => setCc((list) => list.filter((e) => e !== email));

  const checkDetails = (): boolean => {
    const ccOk = commitCc();
    const next: FieldErrors = {};
    const name = recipientName.trim();
    if (!name) next.recipientName = "Enter the recipient’s name.";
    else if (name.length > RECIPIENT_NAME_MAX) next.recipientName = `At most ${RECIPIENT_NAME_MAX} characters.`;
    if (!isValidEmailV2(recipientEmail)) next.recipientEmail = "Enter a valid email address.";
    // A chip added before the recipient's email was changed to the same address.
    const recipientKey = recipientEmail.trim().toLowerCase();
    if (ccOk && cc.some((e) => e.toLowerCase() === recipientKey)) next.cc = "The recipient cannot also be copied in.";
    const t = titleValue.trim();
    if (!t) next.title = "Give the document a title.";
    else if (t.length > TITLE_MAX) next.title = `At most ${TITLE_MAX} characters.`;
    if (message.trim().length > MESSAGE_MAX) next.message = `At most ${MESSAGE_MAX} characters.`;
    // commitCc has already put its own reason in `errors.cc` when it refused something.
    setErrors((e) => ({ ...next, cc: next.cc ?? (ccOk ? undefined : e.cc) }));
    return ccOk && Object.values(next).every((v) => !v);
  };

  /* ── step 2 ─────────────────────────────────────────────────────────── */

  const selectTemplate = (id: string) => {
    setSelectionTouched(true);
    setSelectedId(id);
    setTemplateError(null);
    // A one-off edit belongs to the template it was made from.
    if (draft && draft.templateId !== id) setDraft(null);
  };

  const checkTemplate = (): boolean => {
    if (!draft && !selected) {
      setTemplateError("Pick a template, or create a new one.");
      return false;
    }
    if (isBlankHtml(content)) {
      setTemplateError("This template has no wording yet. Pick another, or create a new one.");
      return false;
    }
    setTemplateError(null);
    return true;
  };

  /* ── editor ─────────────────────────────────────────────────────────── */

  const openCreate = () => setEditor({ purpose: "create", initialContent: withSignaturesSectionV2("") });
  const openEdit = () => setEditor({ purpose: "edit", initialContent: content });

  /** The editor's result is used for THIS send only; no template is written. */
  const applyEdited = (edited: string) => {
    if (!editor) return;
    if (editor.purpose === "create") {
      setDraft({ content: edited, templateId: null });
      setSelectionTouched(true);
      setSelectedId(null);
    } else {
      setDraft({ content: edited, templateId: draft ? draft.templateId : selected?.id ?? null });
    }
    setTemplateError(null);
    setSendError(null);
    setEditor(null);
    setStep("preview");
  };

  /* ── send ───────────────────────────────────────────────────────────── */

  const send = async () => {
    if (duplicateReason || notReady) return;
    const checked = validateIndividualSendV2({
      templateId: templateIdForSend,
      contentHtml: content,
      title: titleValue,
      message,
      recipientName,
      recipientEmail,
      cc,
    });
    if (!checked.ok) {
      setSendError(checked.error);
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const v = checked.value;
      const result = await sendAgreementV2({
        templateId: v.templateId,
        contentHtml: v.contentHtml,
        title: v.title,
        ...(v.message ? { message: v.message } : {}),
        recipientName: v.recipientName,
        recipientEmail: v.recipientEmail,
        cc: v.cc,
        company: companyV2,
        timeZone,
      });
      if (toStatusV2(result.status) === "failed") {
        onSent?.();
        setSendError(
          result.status === "credit_failed"
            ? "There are not enough e-sign credits to send this agreement. Top up, then send it again."
            : result.error || "The signing service turned it down. It is in the list as Failed.",
        );
        return;
      }
      toast({ title: "Agreement sent", description: `${v.recipientName} has been emailed it to sign.` });
      onSent?.();
      onOpenChange(false);
    } catch (error) {
      setSendError(error instanceof Error && error.message ? error.message : "The agreement could not be sent.");
    } finally {
      setSending(false);
    }
  };

  /* ── navigation ─────────────────────────────────────────────────────── */

  const next = () => {
    if (step === "details" && checkDetails()) setStep("template");
    else if (step === "template" && checkTemplate()) setStep("preview");
  };
  const back = () => {
    setSendError(null);
    if (step === "preview") setStep("template");
    else if (step === "template") setStep("details");
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const invalid = (key: keyof FieldErrors) => (errors[key] ? true : undefined);
  const describedBy = (key: keyof FieldErrors, help?: boolean) =>
    [help ? fieldId(`${key}-help`) : null, errors[key] ? fieldId(`${key}-error`) : null].filter(Boolean).join(" ") || undefined;
  const fieldError = (key: keyof FieldErrors) =>
    errors[key] ? (
      <p id={fieldId(`${key}-error`)} className="text-xs text-destructive">
        {errors[key]}
      </p>
    ) : null;

  return (
    <>
      {/* Hidden (not closed: every value here is kept) while the full-screen editor is up, so only one modal is ever on screen. */}
      <Dialog open={open && !editor} onOpenChange={(nextOpen) => !nextOpen && !sending && onOpenChange(false)}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="shrink-0 gap-2 border-b px-6 py-4 pr-14">
            <DialogTitle className="text-lg">Send agreement</DialogTitle>
            <DialogDescription>
              Step {stepIndex + 1} of {STEPS.length}: {STEPS[stepIndex].label}
            </DialogDescription>
            <ol className="flex items-center gap-2 pt-1 text-xs" aria-label="Steps">
              {STEPS.map((s, i) => (
                <li
                  key={s.key}
                  aria-current={s.key === step ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2",
                    s.key === step ? "font-medium text-foreground" : i < stepIndex ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums",
                      s.key === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                  {s.label}
                  {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" aria-hidden />}
                </li>
              ))}
            </ol>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {notReady && (
              <div
                className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-foreground"
                role="status"
                data-slot="send-not-ready"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                <span>
                  You can prepare and preview this agreement, but it can&apos;t be sent yet. {notReady.message}
                </span>
              </div>
            )}
            {step === "details" && (
              <div className="grid gap-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor={fieldId("recipientName")}>Recipient name*</Label>
                    <Input
                      id={fieldId("recipientName")}
                      value={recipientName}
                      maxLength={RECIPIENT_NAME_MAX}
                      autoComplete="off"
                      aria-invalid={invalid("recipientName")}
                      aria-describedby={describedBy("recipientName")}
                      onChange={(e) => setRecipientName(e.target.value)}
                    />
                    {fieldError("recipientName")}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={fieldId("recipientEmail")}>Recipient email*</Label>
                    <Input
                      id={fieldId("recipientEmail")}
                      type="email"
                      value={recipientEmail}
                      autoComplete="off"
                      aria-invalid={invalid("recipientEmail")}
                      aria-describedby={describedBy("recipientEmail")}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                    />
                    {fieldError("recipientEmail")}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor={fieldId("cc")}>CC</Label>
                  <div
                    className={cn(
                      "flex min-h-9 flex-wrap items-center gap-1.5 rounded-3xl bg-input/50 px-2 py-1.5 focus-within:ring-3 focus-within:ring-ring/30",
                      errors.cc && "ring-3 ring-destructive/20",
                    )}
                  >
                    {cc.map((email) => (
                      <span
                        key={email}
                        className="inline-flex max-w-full items-center gap-1 rounded-full bg-background py-0.5 pr-0.5 pl-2.5 text-xs ring-1 ring-foreground/10"
                      >
                        <span className="truncate">{email}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Remove ${email}`}
                          onClick={() => removeCc(email)}
                        >
                          <X />
                        </Button>
                      </span>
                    ))}
                    <input
                      id={fieldId("cc")}
                      value={ccDraft}
                      autoComplete="off"
                      className="h-6 min-w-[12rem] flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground md:text-sm"
                      placeholder={cc.length === 0 ? "name@example.com" : ""}
                      aria-invalid={invalid("cc")}
                      aria-describedby={describedBy("cc", true)}
                      onChange={(e) => setCcDraft(e.target.value)}
                      onKeyDown={onCcKeyDown}
                      onPaste={onCcPaste}
                      onBlur={() => commitCc()}
                    />
                  </div>
                  <p id={fieldId("cc-help")} className="text-xs text-muted-foreground">
                    {CC_HELP}
                  </p>
                  {fieldError("cc")}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor={fieldId("title")}>Document title</Label>
                  <Input
                    id={fieldId("title")}
                    value={titleValue}
                    maxLength={TITLE_MAX}
                    aria-invalid={invalid("title")}
                    aria-describedby={describedBy("title", true)}
                    onChange={(e) => {
                      setTitleEdited(true);
                      setTitle(e.target.value);
                    }}
                  />
                  <p id={fieldId("title-help")} className="text-xs text-muted-foreground">
                    The recipient sees this as the agreement’s name. It starts as the template’s name.
                  </p>
                  {fieldError("title")}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor={fieldId("message")}>
                    Message <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Textarea
                    id={fieldId("message")}
                    value={message}
                    rows={3}
                    maxLength={MESSAGE_MAX}
                    aria-invalid={invalid("message")}
                    aria-describedby={describedBy("message", true)}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <p id={fieldId("message-help")} className="flex justify-between gap-3 text-xs text-muted-foreground">
                    <span>{MESSAGE_HELP}</span>
                    <span className="shrink-0 tabular-nums">
                      {message.length}/{MESSAGE_MAX}
                    </span>
                  </p>
                  {fieldError("message")}
                </div>
              </div>
            )}

            {step === "template" && (
              <div className="grid gap-3">
                {isCustom && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted px-4 py-3 text-sm">
                    <span>You wrote this agreement for this send. Pick a template to use one instead.</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setStep("preview")}>
                      Preview it
                    </Button>
                  </div>
                )}
                {templatesLoading ? (
                  <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground" role="status">
                    <Loader2 className="size-4 animate-spin" />
                    Loading your templates…
                  </div>
                ) : templatesError ? (
                  <div className="flex flex-col items-start gap-2 py-6 text-sm" role="alert">
                    <p>Your templates could not be loaded.</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => void refetchTemplates()}>
                      Try again
                    </Button>
                  </div>
                ) : (
                  <TemplatePickerV2
                    templates={templates}
                    selectedId={isCustom ? null : selectedId}
                    onSelect={selectTemplate}
                    onCreateNew={openCreate}
                  />
                )}
                {templateError && (
                  <p className="text-sm text-destructive" role="alert">
                    {templateError}
                  </p>
                )}
              </div>
            )}

            {step === "preview" && (
              <div className="grid gap-4">
                <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
                  <dt className="text-muted-foreground">To</dt>
                  <dd className="break-all">
                    {recipientName.trim()} &lt;{recipientEmail.trim()}&gt;
                  </dd>
                  {cc.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">CC</dt>
                      <dd className="break-all">{cc.join(", ")}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Title</dt>
                  <dd>{titleValue.trim()}</dd>
                  {message.trim() && (
                    <>
                      <dt className="text-muted-foreground">Message</dt>
                      <dd className="whitespace-pre-wrap">{message.trim()}</dd>
                    </>
                  )}
                </dl>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {draft
                      ? "Your edits apply to this agreement only. The template is unchanged."
                      : "This is exactly what the recipient will be asked to sign."}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={openEdit} disabled={sending}>
                    <Pencil />
                    Edit
                  </Button>
                </div>
                <div className="rounded-2xl bg-muted p-4">
                  <AgreementPreviewV2
                    html={previewHtml}
                    banner={titleValue.trim()}
                    className="mx-auto"
                    unresolvedNote={individualUnresolvedNoteV2}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 items-center border-t px-6 py-4 sm:justify-between">
            <div className="min-w-0 flex-1">
              {step === "preview" && duplicateReason && (
                <p
                  id={fieldId("duplicate-signer-fields")}
                  className="flex items-start gap-1.5 text-sm text-destructive"
                  role="alert"
                  data-slot="duplicate-signer-fields"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>{duplicateReason} Use Edit to fix it, then send.</span>
                </p>
              )}
              {step === "preview" && !duplicateReason && !notReady && sendError && (
                <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>{sendError}</span>
                </p>
              )}
              {step === "preview" && !duplicateReason && notReady && (
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground" id={fieldId("send-not-ready")}>
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>Sending isn&apos;t available yet — see the note above.</span>
                </p>
              )}
              {step === "preview" && !duplicateReason && !notReady && !sendError && <p className="text-xs text-muted-foreground">{CREDITS_NOTE}</p>}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {step === "details" ? (
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={back} disabled={sending}>
                  <ArrowLeft />
                  Back
                </Button>
              )}
              {step === "preview" ? (
                <Button
                  type="button"
                  onClick={() => void send()}
                  disabled={sending || !!duplicateReason || !!notReady}
                  aria-describedby={
                    duplicateReason ? fieldId("duplicate-signer-fields") : notReady ? fieldId("send-not-ready") : undefined
                  }
                >
                  {sending ? <Loader2 className="animate-spin" /> : <Send />}
                  {sending ? "Sending…" : "Send agreement"}
                </Button>
              ) : (
                <Button type="button" onClick={next} disabled={step === "template" && templatesLoading}>
                  Next
                  <ArrowRight />
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {open && editor && (
        <AgreementEditorV2
          open
          onClose={() => setEditor(null)}
          mode="one-off"
          initialName={titleValue.trim() || FALLBACK_TITLE}
          initialContent={editor.initialContent}
          previewData={previewData}
          saveLabel="Use for this agreement"
          nameEditable={false}
          previewBanner={titleValue.trim() || FALLBACK_TITLE}
          onSave={(edited) => applyEdited(edited)}
        />
      )}
    </>
  );
}
