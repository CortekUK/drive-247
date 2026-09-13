/** Cancels requests and rejects late results across auth, tenant and permission changes. */
export class TraxRequestScope {
  private scope = '';
  private revision = 0;
  private requests = new Set<AbortController>();
  setScope(scope: string) {
    if (scope !== this.scope) { this.invalidate(); this.scope = scope; }
  }
  invalidate() {
    this.revision++;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
  }
  begin() {
    const revision = this.revision;
    const scope = this.scope;
    const controller = new AbortController();
    this.requests.add(controller);
    return {
      signal: controller.signal,
      current: () => revision === this.revision && scope === this.scope && !controller.signal.aborted,
      finish: () => this.requests.delete(controller),
    };
  }
}
export function traxPageContext(pathname: string | null) {
  const match = pathname?.match(/^\/(rentals|vehicles|customers)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/?$/i);
  if (!match) return undefined;
  return { kind: ({ rentals: 'rental', vehicles: 'vehicle', customers: 'customer' } as const)[match[1].toLowerCase()], id: match[2] };
}
