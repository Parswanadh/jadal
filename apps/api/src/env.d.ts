/// <reference types="@cloudflare/workers-types" />

// NOTE: the Worker *bindings and variables* type is `Env` in `./env.ts`. This file only declares the
// Cloudflare runtime globals, because the repo has no `@cloudflare/workers-types` package to resolve.
// The telephony variables B9 wires up live on `Env` there:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, PUBLIC_BASE_URL, SARVAM_API_KEY,
//   DEEPGRAM_API_KEY, SARVAM_TTS_SPEAKER, REAL_TELEPHONY, SKIP_TWILIO_SIGNATURE
// The System-1 (Jev / Laya / rules) variables live on `Env` there too:
//   SYSTEM1_PROVIDER, LAYA_ENDPOINT, LAYA_TIMEOUT_MS, OPENROUTER_API_KEY, JEV_MODEL, JEV_TIMEOUT_MS
// Their local *names* (never values) are listed in `.dev.vars.example`.

// Ambient Cloudflare Worker type fallback declarations
declare global {
  interface D1Database {
    prepare(query: string): D1PreparedStatement;
    dump(): Promise<ArrayBuffer>;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Response<T>[]>;
    exec(query: string): Promise<D1ExecResult>;
  }

  interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(colName?: string): Promise<T | null>;
    run<T = unknown>(): Promise<D1Response<T>>;
    // The `D1Response` envelope, exactly as the real binding behaves:
    // `const { results } = await stmt.all()`. Until B9 this fallback declared `Promise<T[]>`, which
    // matched only the in-memory test shim; the first real `wrangler dev` boot then 500'd every read
    // route with `rows.map is not a function`. Use `resultRows()` from `db/store.ts` to unwrap.
    all<T = unknown>(): Promise<D1Response<T>>;
    raw<T = unknown>(): Promise<T[]>;
  }

  interface D1Response<T = unknown> {
    success: boolean;
    meta: Record<string, unknown>;
    results?: T[];
    error?: string;
  }

  interface D1ExecResult {
    count: number;
    duration: number;
  }

  interface KVNamespace {
    get(key: string, options?: unknown): Promise<string | null>;
    put(key: string, value: string | ReadableStream | ArrayBuffer, options?: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: unknown): Promise<unknown>;
  }

  interface Queue<T = unknown> {
    send(message: T, options?: unknown): Promise<void>;
    sendBatch(messages: Iterable<{ body: T }>, options?: unknown): Promise<void>;
  }

  interface Fetcher {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  }

  interface ScheduledEvent {
    cron: string;
    type: string;
    scheduledTime: number;
  }

  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
  }

  interface Message<T = unknown> {
    readonly id: string;
    readonly timestamp: Date;
    readonly body: T;
    readonly attempts: number;
    ack(): void;
    retry(): void;
  }

  interface MessageBatch<T = unknown> {
    readonly queue: string;
    readonly messages: readonly Message<T>[];
    ackAll(): void;
    retryAll(): void;
  }

  interface Workflow {
    create(options?: { params?: unknown }): Promise<{ id: string }>;
  }
}

export {};
