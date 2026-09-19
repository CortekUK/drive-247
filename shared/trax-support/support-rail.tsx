'use client';
import React from 'react';
import type { SupportInboxState } from './use-support-inbox';

/**
 * How the Support page lends its ticket list to the app's left rail.
 *
 * On a desktop, Support uses the sidebar's own slot for the ticket list instead of
 * putting a list column beside the navigation (four columns would squeeze the
 * conversation). The rail and the page are siblings in the layout, so the page —
 * which owns `useSupportInbox` — publishes its inbox here, and the rail publishes
 * back whether it is actually showing the list. When it is not (a phone, where the
 * sidebar is a closed sheet; a collapsed sidebar; or no rail mounted at all), the
 * page shows the list itself. Nothing is fetched twice: there is one inbox.
 *
 * Two contexts on purpose. The page reads only the rail's status, which changes
 * rarely; the rail reads the inbox, which changes on every keystroke. Keeping them
 * apart means publishing the inbox never re-renders the page that published it.
 */

interface RailStatus { mounted: boolean; listed: boolean }
interface RailControl { status: RailStatus; publishInbox: (inbox: SupportInboxState | null) => void; publishStatus: (status: RailStatus) => void }

const InboxContext = React.createContext<SupportInboxState | null>(null);
const ControlContext = React.createContext<RailControl | null>(null);

export function SupportRailProvider({ children }: { children: React.ReactNode }) {
  const [inbox, publishInbox] = React.useState<SupportInboxState | null>(null);
  const [status, setStatus] = React.useState<RailStatus>({ mounted: false, listed: false });
  const publishStatus = React.useCallback((next: RailStatus) => {
    setStatus((old) => (old.mounted === next.mounted && old.listed === next.listed ? old : next));
  }, []);
  const control = React.useMemo(() => ({ status, publishInbox, publishStatus }), [status, publishStatus]);
  return (
    <ControlContext.Provider value={control}>
      <InboxContext.Provider value={inbox}>{children}</InboxContext.Provider>
    </ControlContext.Provider>
  );
}

/** The page: hands its inbox to the rail. True when the rail is showing the list. */
export function useSupportRailHost(inbox: SupportInboxState): boolean {
  const control = React.useContext(ControlContext);
  const publish = control?.publishInbox;
  React.useEffect(() => { publish?.(inbox); }, [publish, inbox]);
  React.useEffect(() => () => publish?.(null), [publish]);
  return !!control?.status.mounted && control.status.listed;
}

/** The rail: says whether the list is on screen in it, and reads the page's inbox. */
export function useSupportRail(listed: boolean): SupportInboxState | null {
  const control = React.useContext(ControlContext);
  const publish = control?.publishStatus;
  React.useEffect(() => {
    publish?.({ mounted: true, listed });
    return () => publish?.({ mounted: false, listed: false });
  }, [publish, listed]);
  return React.useContext(InboxContext);
}
