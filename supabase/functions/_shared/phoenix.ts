// Arize Phoenix tracing for TRAX.
//
// Wrap a function's handler once:
//
//   Deno.serve(withPhoenix('trax-support', async (req) => { … }));
//
// Every call the handler makes to api.openai.com — chat/completions (plain or
// streamed), responses, embeddings — becomes an OpenInference LLM span, all
// under one CHAIN span for the request, so a multi-step TRAX answer reads as
// one trace in Phoenix. Requests that never reach OpenAI send nothing.
//
// No OpenTelemetry SDK: Phoenix's /v1/traces only accepts OTLP protobuf, and
// the handful of messages needed are encoded below. Exports run after the
// response (EdgeRuntime.waitUntil) and never throw — tracing must not break
// or slow TRAX.
//
// Config: the project is at Supabase's 100-secret limit, so it lives in Vault
// as `phoenix_tracing` = {endpoint, api_key, project?, hide_content?}, read
// through phoenix_tracing_config() (service role only; migration
// 20261027120000). PHOENIX_COLLECTOR_ENDPOINT / PHOENIX_API_KEY /
// PHOENIX_PROJECT_NAME env vars override it. No endpoint = tracing off.

import { AsyncLocalStorage } from 'node:async_hooks';

type Config = { endpoint: string; apiKey: string | null; project: string; hideContent: boolean };
type Attr = string | number | boolean;
type Span = {
  traceId: Uint8Array; spanId: Uint8Array; parentId?: Uint8Array; name: string; kind: number;
  start: bigint; end: bigint; attrs: Record<string, Attr>; error?: string;
};
type Trace = { traceId: Uint8Array; root: Span; spans: Span[]; pending: Promise<void>[] };

const nativeFetch = globalThis.fetch.bind(globalThis);
const current = new AsyncLocalStorage<Trace>();
const MAX_VALUE = 32_000;
const CONFIG_TTL_MS = 5 * 60_000;

let config: Config | null = null;
let configAt = 0;

async function loadConfig(): Promise<Config | null> {
  if (Date.now() - configAt < CONFIG_TTL_MS) return config;
  configAt = Date.now();
  const env = (k: string) => Deno.env.get(k) || null;
  let v: Record<string, unknown> = {};
  if (!env('PHOENIX_COLLECTOR_ENDPOINT')) {
    try {
      const url = env('SUPABASE_URL');
      const key = env('SUPABASE_SERVICE_ROLE_KEY');
      if (url && key) {
        const res = await nativeFetch(`${url}/rest/v1/rpc/phoenix_tracing_config`, {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(3_000),
        });
        if (res.ok) v = (await res.json()) ?? {};
      }
    } catch (err) {
      console.error('[phoenix] config read failed:', err);
    }
  }
  const endpoint = (env('PHOENIX_COLLECTOR_ENDPOINT') ?? (v.endpoint as string | undefined))?.replace(/\/+$/, '');
  config = endpoint
    ? {
        endpoint: endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint}/v1/traces`,
        apiKey: env('PHOENIX_API_KEY') ?? (v.api_key as string | undefined) ?? null,
        project: env('PHOENIX_PROJECT_NAME') ?? (v.project as string | undefined) ?? 'trax',
        hideContent: v.hide_content === true,
      }
    : null;
  return config;
}

/* ───────────────────────────── handler wrapper ───────────────────────────── */

export function withPhoenix(
  functionName: string,
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  installFetchHook();
  return async (req) => {
    if (req.method === 'OPTIONS') return handler(req);
    const root: Span = {
      traceId: randomBytes(16), spanId: randomBytes(8), name: functionName, kind: 2,
      start: nowNs(), end: 0n,
      attrs: { 'openinference.span.kind': 'CHAIN', 'metadata': JSON.stringify({ function: functionName }) },
    };
    const trace: Trace = { traceId: root.traceId, root, spans: [], pending: [] };
    let response: Response | undefined;
    try {
      response = await current.run(trace, () => handler(req));
      return response;
    } catch (err) {
      root.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      root.end = nowNs();
      if (response) root.attrs['http.status_code'] = response.status;
      if (response && response.status >= 500) root.error ??= `HTTP ${response.status}`;
      if (trace.spans.length || trace.pending.length) background(flush(trace));
    }
  };
}

let hooked = false;
function installFetchHook() {
  if (hooked) return;
  hooked = true;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const trace = current.getStore();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!trace || !url.startsWith('https://api.openai.com/')) return nativeFetch(input, init);
    return tracedOpenAI(trace, url, input, init);
  };
}

async function tracedOpenAI(trace: Trace, url: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const endpoint = new URL(url).pathname.replace(/^\/v1\//, '');
  let body: Record<string, any> = {};
  try { body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}; } catch { /* not JSON */ }
  const span: Span = {
    traceId: trace.traceId, spanId: randomBytes(8), parentId: trace.root.spanId,
    name: `openai.${endpoint}`, kind: 3, start: nowNs(), end: 0n, attrs: {},
  };
  requestAttrs(span.attrs, endpoint, body);

  let res: Response;
  try {
    res = await nativeFetch(input, init);
  } catch (err) {
    span.end = nowNs();
    span.error = err instanceof Error ? err.message : String(err);
    trace.spans.push(span);
    throw err;
  }

  const done = (async () => {
    try {
      const text = await res.clone().text();
      if (!res.ok) span.error = `${res.status}: ${text.slice(0, 500)}`;
      else if (body.stream) streamAttrs(span.attrs, text);
      else responseAttrs(span.attrs, endpoint, JSON.parse(text));
    } catch (err) {
      span.error ??= err instanceof Error ? err.message : String(err);
    } finally {
      span.end = nowNs();
      trace.spans.push(span);
    }
  })();
  trace.pending.push(done);
  return res;
}

/* ──────────────────────── OpenInference attributes ───────────────────────── */

function requestAttrs(a: Record<string, Attr>, endpoint: string, body: Record<string, any>) {
  const embedding = endpoint === 'embeddings';
  a['openinference.span.kind'] = embedding ? 'EMBEDDING' : 'LLM';
  a['llm.provider'] = 'openai';
  a['llm.system'] = 'openai';
  if (body.model) a[embedding ? 'embedding.model_name' : 'llm.model_name'] = body.model;
  if (embedding) return;

  const { messages, input, tools, stream, ...params } = body;
  delete params.model;
  delete params.instructions;
  a['llm.invocation_parameters'] = JSON.stringify({ ...params, ...(stream ? { stream } : {}) });
  a['input.mime_type'] = 'application/json';
  a['input.value'] = clip(JSON.stringify(messages ?? input ?? null));

  const msgs: any[] = Array.isArray(messages) ? messages
    : Array.isArray(input) ? input.filter((m) => m && typeof m === 'object' && 'role' in m)
    : typeof input === 'string' ? [{ role: 'user', content: input }] : [];
  if (typeof body.instructions === 'string') msgs.unshift({ role: 'system', content: body.instructions });
  msgs.forEach((m, i) => {
    const p = `llm.input_messages.${i}.message`;
    a[`${p}.role`] = m.role;
    const content = textOf(m.content);
    if (content) a[`${p}.content`] = clip(content);
    (m.tool_calls ?? []).forEach((c: any, j: number) => {
      a[`${p}.tool_calls.${j}.tool_call.function.name`] = c.function?.name ?? '';
      a[`${p}.tool_calls.${j}.tool_call.function.arguments`] = clip(c.function?.arguments ?? '');
    });
    if (m.tool_call_id) a[`${p}.tool_call_id`] = m.tool_call_id;
  });
  (tools ?? []).forEach((t: unknown, i: number) => { a[`llm.tools.${i}.tool.json_schema`] = clip(JSON.stringify(t)); });
}

function usageAttrs(a: Record<string, Attr>, u: any) {
  const prompt = u?.prompt_tokens ?? u?.input_tokens;
  const completion = u?.completion_tokens ?? u?.output_tokens;
  if (typeof prompt === 'number') a['llm.token_count.prompt'] = prompt;
  if (typeof completion === 'number') a['llm.token_count.completion'] = completion;
  if (typeof u?.total_tokens === 'number') a['llm.token_count.total'] = u.total_tokens;
}

function responseAttrs(a: Record<string, Attr>, endpoint: string, data: any) {
  usageAttrs(a, data?.usage);
  if (endpoint === 'embeddings') return;

  a['output.mime_type'] = 'application/json';
  if (endpoint === 'responses') {
    const items: any[] = data?.output ?? [];
    const text = items.filter((o) => o.type === 'message').map((o) => textOf(o.content)).join('');
    const calls = items.filter((o) => o.type === 'function_call');
    a['output.value'] = clip(JSON.stringify(items));
    outputMessage(a, text, calls.map((c) => ({ name: c.name, arguments: c.arguments })));
    return;
  }
  const msg = data?.choices?.[0]?.message ?? {};
  a['output.value'] = clip(JSON.stringify(msg));
  outputMessage(a, msg.content ?? '', (msg.tool_calls ?? []).map((c: any) => c.function ?? {}));
}

/** A streamed chat completion: stitch the SSE deltas back into one message. */
function streamAttrs(a: Record<string, Attr>, sse: string) {
  let text = '';
  for (const line of sse.split('\n')) {
    const data = line.startsWith('data:') ? line.slice(5).trim() : '';
    if (!data || data === '[DONE]') continue;
    try {
      const chunk = JSON.parse(data);
      text += chunk?.choices?.[0]?.delta?.content ?? '';
      if (chunk?.usage) usageAttrs(a, chunk.usage);
    } catch { /* partial line */ }
  }
  a['output.mime_type'] = 'text/plain';
  a['output.value'] = clip(text);
  outputMessage(a, text, []);
}

function outputMessage(a: Record<string, Attr>, content: string, calls: { name?: string; arguments?: string }[]) {
  const p = 'llm.output_messages.0.message';
  a[`${p}.role`] = 'assistant';
  if (content) a[`${p}.content`] = clip(content);
  calls.forEach((c, j) => {
    a[`${p}.tool_calls.${j}.tool_call.function.name`] = c.name ?? '';
    a[`${p}.tool_calls.${j}.tool_call.function.arguments`] = clip(c.arguments ?? '');
  });
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
}

const clip = (s: string) => (s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}…[truncated]` : s);

/* ──────────────────────────────── export ────────────────────────────────── */

async function flush(trace: Trace): Promise<void> {
  try {
    await Promise.allSettled(trace.pending);
    const cfg = await loadConfig();
    if (!cfg) return;
    const spans = [trace.root, ...trace.spans];
    if (cfg.hideContent) spans.forEach((s) => stripContent(s.attrs));
    const headers: Record<string, string> = { 'Content-Type': 'application/x-protobuf' };
    if (cfg.apiKey) {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
      headers.api_key = cfg.apiKey; // older Phoenix Cloud spaces read this one
    }
    const res = await nativeFetch(cfg.endpoint, {
      method: 'POST',
      headers,
      body: encodeExport(cfg.project, spans),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) console.error('[phoenix] export failed:', res.status, (await res.text()).slice(0, 300));
  } catch (err) {
    console.error('[phoenix] export failed:', err);
  }
}

function stripContent(a: Record<string, Attr>) {
  for (const k of Object.keys(a)) {
    if (/^(input|output)\.value$|\.content$|\.arguments$/.test(k)) a[k] = '[hidden]';
  }
}

function background(p: Promise<void>) {
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}

/* ──────────────────────── OTLP protobuf encoding ─────────────────────────── */
// opentelemetry/proto/collector/trace/v1 ExportTraceServiceRequest — only the
// fields Phoenix reads.

class Pb {
  private buf: number[] = [];
  private varint(n: bigint) {
    while (n > 0x7fn) { this.buf.push(Number(n & 0x7fn) | 0x80); n >>= 7n; }
    this.buf.push(Number(n));
  }
  private tag(field: number, wire: number) { this.varint(BigInt((field << 3) | wire)); }
  uint(field: number, n: number | bigint) { this.tag(field, 0); this.varint(BigInt(n)); return this; }
  fixed64(field: number, n: bigint) {
    this.tag(field, 1);
    for (let i = 0; i < 8; i++) this.buf.push(Number((n >> BigInt(8 * i)) & 0xffn));
    return this;
  }
  double(field: number, n: number) {
    this.tag(field, 1);
    this.buf.push(...new Uint8Array(new Float64Array([n]).buffer));
    return this;
  }
  bytes(field: number, b: Uint8Array) { this.tag(field, 2); this.varint(BigInt(b.length)); this.buf.push(...b); return this; }
  str(field: number, s: string) { return this.bytes(field, new TextEncoder().encode(s)); }
  msg(field: number, m: Pb) { return this.bytes(field, m.done()); }
  done() { return new Uint8Array(this.buf); }
}

function keyValue(key: string, v: Attr): Pb {
  const any = new Pb();
  if (typeof v === 'string') any.str(1, v);
  else if (typeof v === 'boolean') any.uint(2, v ? 1 : 0);
  else if (Number.isInteger(v)) any.uint(3, BigInt.asUintN(64, BigInt(v)));
  else any.double(4, v);
  return new Pb().str(1, key).msg(2, any);
}

function encodeSpan(s: Span): Pb {
  const pb = new Pb().bytes(1, s.traceId).bytes(2, s.spanId);
  if (s.parentId) pb.bytes(4, s.parentId);
  pb.str(5, s.name).uint(6, s.kind).fixed64(7, s.start).fixed64(8, s.end || s.start);
  for (const [k, v] of Object.entries(s.attrs)) pb.msg(9, keyValue(k, v));
  const status = new Pb();
  if (s.error) status.str(2, s.error.slice(0, 1_000)).uint(3, 2);
  else status.uint(3, 1);
  return pb.msg(15, status);
}

function encodeExport(project: string, spans: Span[]): Uint8Array {
  const resource = new Pb()
    .msg(1, keyValue('service.name', 'trax'))
    .msg(1, keyValue('openinference.project.name', project));
  const scope = new Pb().msg(1, new Pb().str(1, 'drive247-phoenix').str(2, '1.0.0'));
  for (const s of spans) scope.msg(2, encodeSpan(s));
  const resourceSpans = new Pb().msg(1, resource).msg(2, scope);
  return new Pb().msg(1, resourceSpans).done();
}

const nowNs = () => BigInt(Date.now()) * 1_000_000n;
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
