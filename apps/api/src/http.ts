/**
 * The HTTP seam: request/response validation and the one error shape the whole API returns.
 *
 * Two rules from the task spec are enforced here rather than repeated in every route:
 *
 *  1. **Every request body and every response is validated against the zod schemas in
 *     `@jadal/contracts`** (`routes.*.body` / `routes.*.response`). `parseBody` and `parseResponse`
 *     are the only doors in and out; a route that forgets to validate is visibly missing a call.
 *  2. **Every failure is `{ error: { code, message } }`** (`ApiError` in the contract) with a 4xx for
 *     anything the caller got wrong and a 5xx for anything we got wrong. `errorPayload` is the
 *     single mapping from a thrown value to that shape, and `index.ts`/`app.ts` use it in `onError`.
 *
 * `HttpError` is the typed error a route raises for an expected failure (`404` for an unknown id,
 * `400` when policy refuses a decision, and so on). Everything else — a zod failure, a `StoreError`
 * from the append-only store, or an unknown throw — is translated here so no route has to know the
 * wire format.
 */

import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z, ZodError } from "zod";

import type { Env } from "./env";
import { isStoreError } from "./db/store";
import type { ProviderFetch, ProviderEnv } from "./system1";

/** The only version string the API reports; `/api/health` and nothing else reads it. */
export const APP_VERSION = "0.1.0";

/* ------------------------------------------------------------------ errors */

/**
 * An expected HTTP failure raised by a route.
 *
 * `status` is a `ContentfulStatusCode` so it can be handed straight to `c.json()`, and `code` is a
 * stable machine token (the contract's `ApiError.code`) distinct from the human `message`.
 */
export class HttpError extends Error {
  readonly code: string;
  readonly status: ContentfulStatusCode;

  constructor(code: string, message: string, status: ContentfulStatusCode) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.status = status;
  }
}

/** A `404` for an id that does not exist. */
export function notFound(code: string, message: string): HttpError {
  return new HttpError(code, message, 404);
}

/** A `400` for input the caller can fix — including a policy refusal. */
export function badRequest(code: string, message: string): HttpError {
  return new HttpError(code, message, 400);
}

/** The contract's `ApiError` body. */
export interface ErrorBody {
  error: { code: string; message: string };
}

/** Render zod issues as `path: message; path: message`, with `(root)` for a whole-value issue. */
function formatIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Is `error` a zod validation error?
 *
 * A named check as well as `instanceof`, because the API imports zod directly while `@jadal/contracts`
 * (and therefore the repo/store mappers that parse contract schemas) can resolve a second physical
 * copy in a pnpm workspace. In that case `instanceof` is false for a perfectly ordinary ZodError, and
 * without this the error would be misreported as a 500. The structural test checks the two stable
 * facts: the name and an `issues` array.
 */
function isZodError(error: unknown): error is ZodError {
  if (error instanceof ZodError) return true;
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; issues?: unknown };
  return candidate.name === "ZodError" && Array.isArray(candidate.issues);
}

/* ------------------------------------------------------------------ validation */

/**
 * Validate `value` against `schema`, throwing `HttpError` on failure.
 *
 * The default is a `400` (`validation_error`) because the common caller is `parseBody`. A response
 * that fails its own contract is not the caller's fault, so `parseResponse` overrides both the
 * status and the code.
 */
export function validate<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  status: ContentfulStatusCode = 400,
  code = "validation_error",
): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(code, formatIssues(result.error), status);
  }
  return result.data;
}

/**
 * Read and validate a JSON request body.
 *
 * Only the `req.json()` slice is required, so any Hono `Context` is accepted without coupling this
 * helper to a particular binding/path instantiation. A body that is not JSON at all is a `400`
 * `invalid_json` with the same `ApiError` shape as a schema failure.
 */
export async function parseBody<S extends z.ZodTypeAny>(
  c: { req: { json(): Promise<unknown> } },
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError("invalid_json", "request body must be valid JSON", 400);
  }
  return validate(schema, raw);
}

/**
 * Validate a response object before it is serialised.
 *
 * A response that does not match `routes.<name>.response` is a server bug, so it surfaces as a `500`
 * rather than leaking a malformed body to the client.
 */
export function parseResponse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  return validate(schema, body, 500, "invalid_response");
}

/* ------------------------------------------------------------------ error mapping */

/**
 * Translate any thrown value into the contract's `ApiError` shape and an HTTP status.
 *
 *  * `HttpError` keeps its own code/status.
 *  * A zod error that escaped explicit validation is a `400` with the issues.
 *  * A store error is an expected outcome of an append: a duplicate event is a `409`, an invalid
 *    event is a `400`, and anything else (a schema constraint, an append-only violation) is a `500`
 *    because it means the caller used the store wrongly rather than supplied bad input.
 *  * Anything else is a `500` with a generic message; internal details are never sent to a client.
 */
export function errorPayload(error: unknown): { status: ContentfulStatusCode; body: ErrorBody } {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  if (isZodError(error)) {
    return { status: 400, body: { error: { code: "validation_error", message: formatIssues(error) } } };
  }
  if (isStoreError(error)) {
    if (error.kind === "duplicate_event") {
      return { status: 409, body: { error: { code: "duplicate_event", message: error.message } } };
    }
    if (error.kind === "invalid_event") {
      return { status: 400, body: { error: { code: "invalid_event", message: error.message } } };
    }
    return { status: 500, body: { error: { code: "store_error", message: "state could not be persisted" } } };
  }
  return { status: 500, body: { error: { code: "internal_error", message: "internal server error" } } };
}

/* ------------------------------------------------------------------ provider env */

/**
 * Adapt the Worker/test `Env` to the provider slice System 1 and the voice clients expect.
 *
 * `Env` (the Worker binding set) has no `fetch`: the runtime supplies the global. Tests inject their
 * own through `createEnv`, so the injected function is preferred when present and the runtime global
 * is the fallback. This is the one cast in the file, and it is confined to that lookup.
 */
export function providerEnv(env: Env): ProviderEnv {
  const injected = (env as Env & { fetch?: ProviderFetch }).fetch;
  return { ...env, fetch: injected ?? runtimeFetch };
}

/** Reshape a `ProviderFetch` init into a `RequestInit` the runtime `fetch` accepts. */
function runtimeFetch(input: string, init?: Parameters<ProviderFetch>[1]): Promise<Response> {
  const requestInit: RequestInit = { method: init?.method ?? "GET" };
  if (init?.headers !== undefined) requestInit.headers = init.headers;
  if (init?.body !== undefined) requestInit.body = init.body as BodyInit;
  if (init?.signal !== undefined) requestInit.signal = init.signal;
  return globalThis.fetch(input, requestInit);
}
