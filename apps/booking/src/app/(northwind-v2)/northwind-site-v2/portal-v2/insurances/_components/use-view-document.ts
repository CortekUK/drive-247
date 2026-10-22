'use client';

/**
 * View: the actual document, in the browser's own PDF viewer, in a new tab —
 * where it can be read, printed or saved (owner, Oct 22 2026: "View opens the
 * actual document in the browser PDF viewer"). No dialog.
 *
 *   - An uploaded certificate opens on a short-lived signed URL from the
 *     `customer-documents` bucket (the operator's View opens the file URL the
 *     same way, apps/portal insurances page `handleView`).
 *     A row whose `file_url` is a full URL outside the bucket (older and seeded
 *     rows) opens on that URL as it stands.
 *   - A Bonzah policy has no stored file: its PDF comes from Bonzah through
 *     `bonzah-download-pdf` (the same path Download uses) as base64, and opens
 *     as a PDF blob.
 *
 * The tab is opened synchronously, inside the click, so no popup blocker eats
 * it; it is pointed at the document once the URL is in hand, and closed again
 * if fetching fails.
 */

import { useCallback, useState } from 'react';

import { useTenant } from '@nw/contexts/TenantContext';
import {
  DOCUMENT_BUCKET,
  type CustomerDocument,
  type CustomerInsurancePolicy,
} from '@nw/hooks/use-customer-documents';
import { supabase } from '@nw/integrations/supabase/client';

type PolicyPdf = CustomerInsurancePolicy['pdfIds'][number];

/** Long enough to read and save; short enough that a shared link goes stale. */
const SIGNED_URL_SECONDS = 60 * 10;

function openPendingTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) {
    try {
      tab.document.title = 'Opening document…';
      tab.document.body.style.font = '14px system-ui, sans-serif';
      tab.document.body.style.padding = '24px';
      tab.document.body.textContent = 'Opening your document…';
    } catch {
      // A browser that will not let us write to the blank tab still navigates it.
    }
  }
  return tab;
}

/** A `file_url` that is a whole URL outside our bucket (`toStoragePath` leaves those as-is). */
export function externalFileUrl(doc: CustomerDocument): string | null {
  return doc.storagePath && /^https?:\/\//i.test(doc.storagePath) ? doc.storagePath : null;
}

/**
 * Download a file that lives outside our bucket: fetch it as a blob so the
 * browser saves it under its file name; if the host refuses (CORS), hand the
 * URL to the browser, which shows it with its own save button.
 */
export async function downloadExternal(doc: CustomerDocument, url: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const blobUrl = URL.createObjectURL(await response.blob());
    const anchor = window.document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = doc.fileName ?? `${doc.name}.pdf`;
    window.document.body.appendChild(anchor);
    anchor.click();
    window.document.body.removeChild(anchor);
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

function base64ToPdfBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
}

export function useViewDocument() {
  const { tenant } = useTenant();
  const [viewingKey, setViewingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = (tab: Window | null, url: string) => {
    if (tab && !tab.closed) tab.location.href = url;
    else window.open(url, '_blank');
  };

  const fail = (tab: Window | null, message: string) => {
    if (tab && !tab.closed) tab.close();
    setError(message);
  };

  const viewDocument = useCallback(async (doc: CustomerDocument) => {
    if (!doc.storagePath) {
      setError('That document has no file attached. Please contact us.');
      return;
    }
    const external = externalFileUrl(doc);
    if (external) {
      window.open(external, '_blank', 'noopener');
      return;
    }
    const tab = openPendingTab();
    setViewingKey(doc.id);
    setError(null);
    try {
      const { data, error: signError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .createSignedUrl(doc.storagePath, SIGNED_URL_SECONDS);
      if (signError || !data?.signedUrl) {
        console.error('[useViewDocument] Signing failed', signError);
        fail(tab, `We could not open “${doc.name}”. Please try again.`);
        return;
      }
      show(tab, data.signedUrl);
    } catch (caught: unknown) {
      console.error('[useViewDocument] Threw', caught);
      fail(tab, `We could not open “${doc.name}”. Please try again.`);
    } finally {
      setViewingKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const viewPolicy = useCallback(
    async (policy: CustomerInsurancePolicy, entry: PolicyPdf) => {
      const tenantId = tenant?.id ?? null;
      if (!tenantId || !policy.policyId) {
        setError('That policy document is not available yet.');
        return;
      }
      const tab = openPendingTab();
      setViewingKey(`${policy.id}:${entry.coverage}`);
      setError(null);
      try {
        const { data, error: fnError } = await supabase.functions.invoke('bonzah-download-pdf', {
          body: { tenant_id: tenantId, pdf_id: String(entry.pdfId), policy_id: policy.policyId },
        });
        const base64 = (data as { documentBase64?: string } | null)?.documentBase64;
        if (fnError || !base64) {
          console.error('[useViewDocument] Bonzah PDF failed', fnError);
          fail(tab, `We could not open your ${entry.label} policy. Please try again.`);
          return;
        }
        const url = URL.createObjectURL(base64ToPdfBlob(base64));
        show(tab, url);
        // The tab has loaded it by then; free the memory.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (caught: unknown) {
        console.error('[useViewDocument] Threw', caught);
        fail(tab, `We could not open your ${entry.label} policy. Please try again.`);
      } finally {
        setViewingKey(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenant?.id],
  );

  const clearError = useCallback(() => setError(null), []);

  return { viewingKey, error, viewDocument, viewPolicy, clearError };
}
