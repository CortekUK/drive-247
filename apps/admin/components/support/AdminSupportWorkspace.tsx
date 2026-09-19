'use client';

import { MessageSquareText } from 'lucide-react';
import { useAdminSupport } from '@/lib/use-support-messaging';
import { SupportInbox } from '../../../../shared/trax-support/SupportInbox';

export function AdminSupportWorkspace({ initialId }: { initialId?: string }) {
  const support = useAdminSupport();
  const loading = support.checking && !support.errorCode;
  const needsSetup = support.errorCode === 'local_configuration_required';
  const restricted = ['forbidden', 'context_changed'].includes(support.errorCode ?? '');
  const signedOut = support.errorCode === 'unauthorized';
  const title = loading ? 'Checking support access…'
    : needsSetup ? 'Support needs setup'
    : restricted ? 'Support access required'
    : signedOut ? 'Sign in again to open Support'
    : 'Support is currently unavailable';

  /* The same three areas as the tenant's Support section: the ticket list is the
     Support rail on a desktop (AdminSupportRail, in the layout's sidebar slot), and
     this fills the height the layout bounds, so the conversation and the details
     panel scroll inside themselves and the reply box never falls below the page. */
  return (
    <div className="flex min-h-[420px] w-full min-w-0 flex-1 flex-col gap-3">
      {support.allowed ? (
        <SupportInbox key={support.scope} call={support.call} admin scope={support.scope} initialId={initialId} uploadAttachment={support.uploadAttachment} />
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-background">
        <section className="flex min-w-0 flex-1 flex-col" aria-label="Support setup and access">
          <header className="border-b border-border px-5 py-4">
            <h1 className="text-base font-semibold">Support inbox</h1>
            <p className="mt-1 text-sm text-muted-foreground">Tenant tickets and two-way conversations</p>
          </header>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6 sm:p-10">
            <div className="w-full max-w-lg space-y-4">
              <MessageSquareText className="h-9 w-9 text-primary" aria-hidden="true" />
              <h2 className="text-xl font-semibold" aria-live="polite">{title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {loading ? 'Verifying your account and the support connection.'
                  : needsSetup ? 'This local admin server is missing its support connection settings. Configure the server, then check again.'
                  : restricted ? 'Your account needs an active platform support assignment before it can view tenant conversations. Ask an authorized platform administrator to review your access.'
                  : signedOut ? 'Your session could not be verified. Sign in again, then return to this page.'
                  : 'We could not verify the support connection. Check the service and its storage configuration, then try again. No ticket data is shown until access is confirmed.'}
              </p>
              {needsSetup && (
                <details className="rounded-lg border border-border bg-secondary/30 p-4 text-sm">
                  <summary className="cursor-pointer font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Local setup steps</summary>
                  <ol className="mt-3 list-decimal space-y-3 pl-5 leading-relaxed text-muted-foreground">
                    <li>Configure the admin app’s private <code>apps/admin/.env.local</code> with the approved Supabase project and server credentials.</li>
                    <li>After the support migrations are approved and applied, enable <code>TRAX_SUPPORT_STORAGE</code> and assign authorized support staff.</li>
                    <li>Restart the admin server. Follow <code>docs/trax/in-app-support.md</code> for the setup checklist.</li>
                  </ol>
                </details>
              )}
              {!loading && <button type="button" disabled={support.checking} onClick={() => void support.retry()} className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-50">{support.checking ? 'Checking…' : 'Check again'}</button>}
              {!loading && <p className="text-xs text-muted-foreground">Human support messaging does not require OpenAI.</p>}
            </div>
          </div>
        </section>
        </div>
      )}
    </div>
  );
}
