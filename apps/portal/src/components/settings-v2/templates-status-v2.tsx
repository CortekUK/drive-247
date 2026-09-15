"use client";

/**
 * v2 Settings › Customer messages: one status line per template row, so an
 * operator can tell a configured account from an untouched one without
 * opening each page. v2 ONLY (rendered from the settings page's v2 branch).
 */

import { EMAIL_TEMPLATE_TYPES } from "@/lib/email-template-variables";
import { useEmailTemplatesStrict } from "@/hooks/use-template-reads-v2";
import { useTemplateSelection } from "@/hooks/use-agreement-templates";

function Pending() {
  return (
    <span role="status" className="mt-1 block h-3 w-40 max-w-full animate-pulse rounded-full bg-muted">
      <span className="sr-only">Checking</span>
    </span>
  );
}

export function EmailTemplatesStatusV2() {
  const { data, isError } = useEmailTemplatesStrict();
  if (!data && isError) {
    return <span className="mt-0.5 block text-destructive">Couldn&apos;t check which emails are customized.</span>;
  }
  if (!data) return <Pending />;
  const keys = new Set(data.map((t) => t.template_key));
  const count = EMAIL_TEMPLATE_TYPES.filter((t) => keys.has(t.key)).length;
  return (
    <span className="mt-0.5 block" data-status="email-templates">
      {count === 0 ? "All emails use the default wording." : `${count} of ${EMAIL_TEMPLATE_TYPES.length} emails customized.`}
    </span>
  );
}

export function AgreementTemplateStatusV2() {
  const { activeType, customTemplate, isLoading, error } = useTemplateSelection("standard");
  if (error) {
    return <span className="mt-0.5 block text-destructive">Couldn&apos;t check which agreement is active.</span>;
  }
  if (isLoading) return <Pending />;
  const custom = activeType === "custom" && !!customTemplate?.template_content?.trim();
  return (
    <span className="mt-0.5 block" data-status="agreement">
      {custom ? "Customers sign your custom agreement." : "Customers sign the default agreement."}
    </span>
  );
}
