import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ShimDatabase, type ShimStatement } from "./d1-shim";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(HERE, "..", "migrations");

/** Reads every migration file in lexical order (0001_, 0002_, …). */
export function readMigrations(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8"));
}

/** In-memory D1 with migrations applied. */
export async function createTestDb(): Promise<ShimDatabase> {
  const db = new ShimDatabase();
  for (const sql of readMigrations()) {
    await db.exec(sql);
  }
  return db;
}

/** Minimal KV stand-in: a Map with the async surface the app uses. */
export class ShimKV {
  #map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.#map.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.#map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.#map.delete(key);
  }

  async list(): Promise<unknown> {
    return { keys: [...this.#map.keys()].map((name) => ({ name })) };
  }
}

/** Queue stand-in that records what the app tried to send. */
export class ShimQueue<T = unknown> {
  readonly sent: T[] = [];

  async send(message: T): Promise<void> {
    this.sent.push(message);
  }

  async sendBatch(messages: Iterable<{ body: T }>): Promise<void> {
    for (const message of messages) this.sent.push(message.body);
  }
}

/** A captured outbound fetch, so tests can assert on provider calls without a network. */
export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

export interface TestEnv {
  DB: ShimDatabase;
  CACHE: ShimKV;
  OUTBOUND: ShimQueue<unknown>;
  /** Every fetch the app attempted, in order. */
  calls: FetchCall[];
  /**
   * Route a provider call to a canned response. Default: throws, so any unmocked external call
   * fails loudly instead of hanging.
   */
  fetch: (input: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<Response>;
  META_WHATSAPP_TOKEN?: string;
  META_PHONE_NUMBER_ID?: string;
}

/** Provider routes keyed by URL substring, matched in insertion order. */
export type FetchRoutes = Record<string, unknown | ((call: FetchCall) => unknown)>;

export function createEnv(routes: FetchRoutes = {}): TestEnv {
  const calls: FetchCall[] = [];
  const env: TestEnv = {
    DB: new ShimDatabase(),
    CACHE: new ShimKV(),
    OUTBOUND: new ShimQueue(),
    calls,
    fetch: async (input, init) => {
      const call: FetchCall = {
        url: input,
        method: init?.method ?? "GET",
        body: init?.body,
        headers: init?.headers ?? {},
      };
      calls.push(call);

      for (const [pattern, response] of Object.entries(routes)) {
        if (input.includes(pattern)) {
          const payload = typeof response === "function" ? response(call) : response;
          if (payload instanceof Response) return payload;
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
      }
      throw new Error(`Unmocked outbound fetch: ${input}`);
    },
  };
  return env;
}

export type AppForEnv = (env: TestEnv) => Hono<{ Bindings: TestEnv }>;

/** Call a Hono route directly. Returns the parsed body plus status and headers. */
export async function call<T = unknown>(
  app: Hono<{ Bindings: TestEnv }>,
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; env?: TestEnv } = {},
): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await app.fetch(
    new Request(`https://api.jadal.test${path}`, {
      method,
      headers: options.body === undefined ? {} : { "content-type": "application/json" },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    options.env as never,
  );
  const text = await res.text();
  let body: unknown = undefined;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body: body as T, headers: res.headers };
}

export function expectOk<T>(result: { status: number; body: T }): T {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Expected 2xx, got ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

export function expectStatus(result: { status: number; body: unknown }, status: ContentfulStatusCode): void {
  if (result.status !== status) {
    throw new Error(`Expected ${status}, got ${result.status}: ${JSON.stringify(result.body)}`);
  }
}

export type { ShimDatabase, ShimStatement };