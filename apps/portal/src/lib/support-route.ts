/**
 * The portal's one Support destination.
 *
 * The profile menu's Support item, TRAX's Support control and the escalation
 * handoff all use this, so every entry point lands on the same section and the
 * same authorized tickets. `issue` opens the new-request composer for a TRAX
 * issue (opening still creates nothing); `ticket` opens an existing conversation.
 */
export const SUPPORT_ROUTE = '/support';

export function supportHref(target: { ticketId?: string; issueId?: string } = {}): string {
  const params = new URLSearchParams();
  if (target.ticketId) params.set('ticket', target.ticketId);
  if (target.issueId) params.set('issue', target.issueId);
  const query = params.toString();
  return query ? `${SUPPORT_ROUTE}?${query}` : SUPPORT_ROUTE;
}
