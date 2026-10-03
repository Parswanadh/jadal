/**
 * Failproof HTTP-middleware tests.
 *
 * The middleware turns one HTTP request into one Failproof session. These tests drive it with a fake
 * Hono context and a capturing sink, so they pin the exact event sequence and outcome mapping a
 * dashboard depends on: a 2xx/4xx ends `success`, a 5xx ends `error`, an exception is recorded and
 * ends `failed` before the error is re-thrown, and the sink is always flushed in `finally`.
 *
 * NO NETWORK: the sink keeps the lines in memory.
 */

import type { Context } from "hono";
import { describe, expect, it } from "vitest";

import { failproofMiddleware, type FailproofMiddlewareEnv } from "./hono-middleware";
import type { FailproofSink } from "./failproof";

/** A sink that keeps every line so a test can assert on the encoded events. */
function capturingSink(): { sink: FailproofSink; lines: string[] } {
  const lines: string[] = [];
  return {
    sink: {
      write(batch: readonly string[]): void {
        lines.push(...batch);
      },
    },
    lines,
  };
}

function parse(lines: readonly string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

interface FakeContext {
  readonly env: FailproofMiddlewareEnv;
  readonly req: { method: string; path: string };
  res: { status: number };
}

function context(env: FailproofMiddlewareEnv = {}, method = "GET", path = "/api/example"): FakeContext {
  return { env, req: { method, path }, res: { status: 200 } };
}

/** Run the middleware with a `next` that mutates the fake response or throws. */
async function run(
  fake: FakeContext,
  next: () => Promise<void>,
  options: Parameters<typeof failproofMiddleware>[0] = {},
): Promise<void> {
  const middleware = failproofMiddleware(options);
  await middleware(fake as unknown as Context, next);
}

describe("failproofMiddleware", () => {
  it("traces a successful request as one session in a fixed event order", async () => {
    const { sink, lines } = capturingSink();
    const fake = context({ ENVIRONMENT: "test" });

    await run(fake, async () => undefined, { enabled: true, sink: () => sink });

    const events = parse(lines);
    expect(events.map((event) => event.type)).toEqual([
      "agent_start",
      "hook_triggered",
      "hook_completed",
      "agent_end",
    ]);
    expect(events[0]?.goal).toBe("GET /api/example");
    expect(events[0]?.agent_id).toBe("jadal.api");
    expect(events[0]?.environment).toBe("test");
    expect(events[1]?.hook_name).toBe("jadal.http");
    expect(events[2]?.outcome).toBe("ok");
    expect(events[2]?.output).toEqual({ status: 200 });
    expect(events[3]?.outcome).toBe("success");
    expect(events[3]?.summary).toBe("GET /api/example → 200");
  });

  it("ends `error` for a 5xx and `refused` on the hook", async () => {
    const { sink, lines } = capturingSink();
    const fake = context();

    await run(
      fake,
      async () => {
        fake.res.status = 503;
      },
      { enabled: true, sink: () => sink },
    );

    const events = parse(lines);
    expect(events.find((event) => event.type === "hook_completed")?.outcome).toBe("refused");
    expect(events.find((event) => event.type === "agent_end")?.outcome).toBe("error");
    expect(events.find((event) => event.type === "agent_end")?.summary).toBe("GET /api/example → 503");
  });

  it("records an exception, ends `failed`, and re-throws", async () => {
    const { sink, lines } = capturingSink();
    const fake = context();
    const boom = new Error("handler exploded");

    await expect(
      run(fake, async () => {
        throw boom;
      }, { enabled: true, sink: () => sink }),
    ).rejects.toBe(boom);

    const events = parse(lines);
    expect(events.map((event) => event.type)).toEqual([
      "agent_start",
      "hook_triggered",
      "error",
      "hook_completed",
      "agent_end",
    ]);
    expect(events.find((event) => event.type === "error")?.message).toBe("handler exploded");
    expect(events.find((event) => event.type === "hook_completed")?.outcome).toBe("failed");
    expect(events.find((event) => event.type === "agent_end")?.outcome).toBe("failed");
  });

  it("is inert when explicitly disabled", async () => {
    const { sink, lines } = capturingSink();

    await run(context(), async () => undefined, { enabled: false, sink: () => sink });

    expect(lines).toHaveLength(0);
  });

  it("turns on when FAILPROOF_TRACE=1 and accepts a custom agent id", async () => {
    const { sink, lines } = capturingSink();

    await run(context({ FAILPROOF_TRACE: "1" }), async () => undefined, { sink: () => sink, agentId: "custom.agent" });

    const events = parse(lines);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.agent_id).toBe("custom.agent");
  });

  it("uses the request method and path in the goal and the summary", async () => {
    const { sink, lines } = capturingSink();
    const fake = context({}, "POST", "/api/requests/req-1/decide");

    await run(fake, async () => undefined, { enabled: true, sink: () => sink });

    const events = parse(lines);
    expect(events[0]?.goal).toBe("POST /api/requests/req-1/decide");
    expect(events[0]?.fw_method).toBe("POST");
    expect(events[0]?.fw_route).toBe("/api/requests/req-1/decide");
  });
});
