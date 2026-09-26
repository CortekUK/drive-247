/**
 * A recording fake of the supabase-js client for component tests: every query
 * is logged with its table, action, columns, payload and filters, and answered
 * by a resolver the test supplies. `functions.invoke` is logged and answered
 * the same way. Nothing here reaches a network.
 */

export type Filter = [op: string, column: string, value: unknown];

export interface RecordedQuery {
  table: string;
  action: "select" | "insert" | "update" | "delete";
  columns?: string;
  payload?: any;
  filters: Filter[];
  terminal: "single" | "maybeSingle" | null;
}

export interface RecordedInvoke {
  name: string;
  body: any;
}

export type QueryResolver = (q: RecordedQuery) => { data?: any; error?: any } | undefined;
export type InvokeResolver = (call: RecordedInvoke) => { data?: any; error?: any } | undefined;

export interface RecordingSupabase {
  client: any;
  queries: RecordedQuery[];
  invokes: RecordedInvoke[];
  /** Queries and invokes interleaved, in the order they ran. */
  order: string[];
  onQuery: QueryResolver;
  onInvoke: InvokeResolver;
  reset(): void;
}

export function recordingSupabase(): RecordingSupabase {
  const rec: RecordingSupabase = {
    client: null,
    queries: [],
    invokes: [],
    order: [],
    onQuery: () => undefined,
    onInvoke: () => undefined,
    reset() {
      rec.queries.length = 0;
      rec.invokes.length = 0;
      rec.order.length = 0;
      rec.onQuery = () => undefined;
      rec.onInvoke = () => undefined;
    },
  };

  const builder = (table: string) => {
    const q: RecordedQuery = { table, action: "select", filters: [], terminal: null };
    let ran: Promise<any> | null = null;
    const run = () => {
      if (!ran) {
        rec.queries.push(q);
        rec.order.push(`${q.action}:${q.table}`);
        const out = rec.onQuery(q) ?? {};
        ran = Promise.resolve({ data: out.data ?? null, error: out.error ?? null });
      }
      return ran;
    };
    const chain = (op: string) => (column: string, value?: unknown) => {
      q.filters.push([op, column, value]);
      return b;
    };
    const b: any = {
      select(columns?: string) {
        if (q.action === "select") q.columns = columns;
        return b;
      },
      insert(payload: any) {
        q.action = "insert";
        q.payload = payload;
        return b;
      },
      update(payload: any) {
        q.action = "update";
        q.payload = payload;
        return b;
      },
      delete() {
        q.action = "delete";
        return b;
      },
      eq: chain("eq"),
      neq: chain("neq"),
      gt: chain("gt"),
      gte: chain("gte"),
      lt: chain("lt"),
      lte: chain("lte"),
      in: chain("in"),
      is: chain("is"),
      or: (expr: string) => {
        q.filters.push(["or", expr, undefined]);
        return b;
      },
      order: chain("order"),
      limit: chain("limit"),
      range: chain("range"),
      single() {
        q.terminal = "single";
        return run();
      },
      maybeSingle() {
        q.terminal = "maybeSingle";
        return run();
      },
      then(res: any, rej: any) {
        return run().then(res, rej);
      },
    };
    return b;
  };

  rec.client = {
    from: (table: string) => builder(table),
    functions: {
      invoke: async (name: string, opts: { body?: any } = {}) => {
        const call = { name, body: opts.body };
        rec.invokes.push(call);
        rec.order.push(`invoke:${name}`);
        const out = rec.onInvoke(call) ?? {};
        return { data: out.data ?? null, error: out.error ?? null };
      },
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  };
  return rec;
}

/** The filter value for `op column`, or undefined. */
export const filterOf = (q: RecordedQuery, op: string, column: string) => q.filters.find((f) => f[0] === op && f[1] === column)?.[2];
