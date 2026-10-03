/**
 * HTTP seam tests.
 *
 * `http.ts` is the only door in and out of every route, so these tests pin the four guarantees it
 * exists to provide: bodies/responses are validated against the contract schemas, a schema failure
 * is a `400` with the issues spelled out, a response that fails its own contract is a `500`, and
 * every thrown value maps to the one `{ error: { code, message } }` shape. The provider-env adapter
 * is covered too, because it is the single cast in the file.
 *
 * NO NETWORK: the one runtime-fetch test replaces `globalThis.fetch` with a spy.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { StoreError } from "./db/store";
import {
  APP_VERSION,
  HttpError,
  badRequest,
  errorPayload,
  notFound,
  parseBody,
  parseResponse,
  providerEnv,
  validate,
} from "./http";
import type { Env } from "./env";

/** A body reader shaped like the slice of a Hono context `parseBody` needs. */
function bodyReader(value: unknown, reject = false): { req: { json(): Promise<unknown> } } {
  return {
    req: {
      json: () => (reject ? Promise.reject(new SyntaxError("bad json")) : Promise.resolve(value)),
    },
  };
}

describe("HttpError and its constructors", () => {
  it("carries a code, a status and the Error name", () => {
    const error = new HttpError("teapot", "I am a teapot", 418);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("HttpError");
    expect(error.code).toBe("teapot");
    expect(error.status).toBe(418);
    expect(error.message).toBe("I am a teapot");
  });

  it("notFound is a 404 and badRequest is a 400", () => {
    expect(notFound("missing", "nope").status).toBe(404);
    expect(badRequest("bad", "nope").status).toBe(400);
  });
});

describe("validate", () => {
  const schema = z.object({ volume_m3: z.number().positive() });

  it("returns the parsed value when the schema accepts it", () => {
    expect(validate(schema, { volume_m3: 3 })).toEqual({ volume_m3: 3 });
  });

  it("throws a 400 validation_error naming the failing path", () => {
    try {
      validate(schema, { volume_m3: -1 });
      throw new Error("expected validate to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      const http = error as HttpError;
      expect(http.status).toBe(400);
      expect(http.code).toBe("validation_error");
      expect(http.message).toContain("volume_m3:");
    }
  });

  it("uses (root) for a whole-value issue and honours a custom status/code", () => {
    try {
      validate(z.string(), 7, 500, "invalid_response");
      throw new Error("expected validate to throw");
    } catch (error) {
      const http = error as HttpError;
      expect(http.status).toBe(500);
      expect(http.code).toBe("invalid_response");
      expect(http.message.startsWith("(root):")).toBe(true);
    }
  });
});

describe("parseBody", () => {
  const schema = z.object({ ok: z.boolean() });

  it("reads and validates a JSON body", async () => {
    await expect(parseBody(bodyReader({ ok: true }), schema)).resolves.toEqual({ ok: true });
  });

  it("maps a non-JSON body to a 400 invalid_json", async () => {
    await expect(parseBody(bodyReader(undefined, true), schema)).rejects.toMatchObject({
      code: "invalid_json",
      status: 400,
    });
  });

  it("maps a schema failure to a 400 validation_error", async () => {
    await expect(parseBody(bodyReader({ ok: "yes" }), schema)).rejects.toMatchObject({
      code: "validation_error",
      status: 400,
    });
  });
});

describe("parseResponse", () => {
  it("returns the validated body", () => {
    expect(parseResponse(z.object({ ok: z.literal(true) }), { ok: true })).toEqual({ ok: true });
  });

  it("treats a response that fails its own contract as a 500 invalid_response", () => {
    try {
      parseResponse(z.object({ ok: z.literal(true) }), { ok: false });
      throw new Error("expected parseResponse to throw");
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_response", status: 500 });
    }
  });
});

describe("errorPayload", () => {
  it("keeps an HttpError's own code and status", () => {
    expect(errorPayload(new HttpError("policy_refused", "no water", 400))).toEqual({
      status: 400,
      body: { error: { code: "policy_refused", message: "no water" } },
    });
  });

  it("maps a real ZodError to a 400 with the issues rendered", () => {
    const result = z.object({ n: z.number() }).safeParse({ n: "x" });
    if (result.success) throw new Error("expected a zod failure");
    const payload = errorPayload(result.error);
    expect(payload.status).toBe(400);
    expect(payload.body.error.code).toBe("validation_error");
    expect(payload.body.error.message).toContain("n:");
  });

  it("maps a structurally-identical foreign ZodError (second zod copy) to a 400", () => {
    const foreign = { name: "ZodError", issues: [{ path: ["a", "b"], message: "bad" }] };
    const payload = errorPayload(foreign);
    expect(payload.status).toBe(400);
    expect(payload.body.error.message).toBe("a.b: bad");
  });

  it("maps a duplicate event to a 409 and an invalid event to a 400", () => {
    expect(errorPayload(new StoreError("duplicate_event", "already there")).status).toBe(409);
    expect(errorPayload(new StoreError("duplicate_event", "already there")).body.error.code).toBe("duplicate_event");
    expect(errorPayload(new StoreError("invalid_event", "bad event")).status).toBe(400);
    expect(errorPayload(new StoreError("invalid_event", "bad event")).body.error.code).toBe("invalid_event");
  });

  it("hides the detail of any other store error behind a generic 500", () => {
    const payload = errorPayload(new StoreError("constraint", "UNIQUE constraint failed: secret"));
    expect(payload.status).toBe(500);
    expect(payload.body.error).toEqual({ code: "store_error", message: "state could not be persisted" });
  });

  it("maps an unknown throw to a generic 500 internal_error", () => {
    expect(errorPayload(new Error("kaboom"))).toEqual({
      status: 500,
      body: { error: { code: "internal_error", message: "internal server error" } },
    });
    expect(errorPayload("a string").status).toBe(500);
  });
});

describe("providerEnv", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers a fetch injected on the env", async () => {
    const injected = vi.fn(async () => new Response("injected"));
    const env = { fetch: injected } as unknown as Env;

    const provider = providerEnv(env);
    expect(provider.fetch).toBe(injected);
    const response = await provider.fetch("https://example.test");
    expect(await response.text()).toBe("injected");
  });

  it("falls back to the runtime global fetch when the env carries none", async () => {
    const runtime = vi.fn(async (_input: string, _init?: RequestInit) => new Response("runtime"));
    vi.stubGlobal("fetch", runtime);

    const provider = providerEnv({} as Env);
    const response = await provider.fetch("https://example.test", { method: "POST", body: "{}" });

    expect(await response.text()).toBe("runtime");
    expect(runtime).toHaveBeenCalledTimes(1);
    const [calledInput, calledInit] = runtime.mock.calls[0] ?? [];
    expect(calledInput).toBe("https://example.test");
    expect(calledInit?.method).toBe("POST");
  });
});

describe("APP_VERSION", () => {
  it("is the one version string the API reports", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
