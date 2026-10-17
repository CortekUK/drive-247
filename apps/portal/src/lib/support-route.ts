/**
 * The portal's one Support destination.
 *
 * The main sidebar's Support item, TRAX's Support control and the record
 * handoff all use this, so every entry point lands on the same section and the
 * same authorized tickets. `ticket` opens an existing conversation. TRAX does not
 * raise tickets, so there is no issue hand-off any more.
 */
export const SUPPORT_ROUTE = '/support';

export function supportHref(target: { ticketId?: string } = {}): string {
  const params = new URLSearchParams();
  if (target.ticketId) params.set('ticket', target.ticketId);
  const query = params.toString();
  return query ? `${SUPPORT_ROUTE}?${query}` : SUPPORT_ROUTE;
}
