/// <reference types="@cloudflare/workers-types" />

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
}

export {};
