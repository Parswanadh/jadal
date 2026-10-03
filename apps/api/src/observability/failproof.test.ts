/**
 * Unit tests for the dependency-free Failproof emitter (`failproof.ts`).
 *
 * The emitter is the half of the observability layer that must not import `node:*`, so these tests
 * drive it directly rather than through the Worker. They pin the four things a wrong implementation
 * would silently get wrong on the dashboard: the wire format (field names, key order, six-digit
 * timestamps), redaction (a secret must not survive to the sink), clock monotonicity (a
 * `tool_result` must never sort before its own `tool_use`), and the computed `duration_ms` on
 * closers (a caller may not supply one, except on `model_response`).
 */

import { describe, expect, it } from "vitest";

import {
  RESERVED_EXTRA_NAMES,
  createFailproofTracer,
  redactString,
  redactValue,
  type FailproofSink,
  type ToolResultFields,
} from "./failproof";

/** A sink that keeps every line it is handed, so a test can assert on the bytes. */
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

/** The six-fraction ISO instant the ingest parser requires. */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** Parse captured JSONL into objects, failing loudly if a line is not JSON. */
function events(lines: readonly string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The single captured event, for the many one-event cases. */
function only(parsed: readonly Record<string, unknown>[]): Record<string, unknown> {
  expect(parsed).toHaveLength(1);
  return parsed[0] as Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("wire format", () => {
  it("emits the SDK envelope with the declared key order and a six-digit timestamp", async () => {
    const { sink, lines } = capturingSink();
    const tracer = createFailproofTracer({ enabled: true, environment: "test", sessionId: "sess_1", agentId: "agent_1", sink });

    tracer.agentStart({ goal: "trace the run", extra: { fw_custom: "x" } });
    await tracer.flush();

    const event = only(events(lines));
    expect(Object.keys(event)).toEqual(["timestamp", "session_id", "agent_id", "type", "environment", "goal", "fw_custom"]);
    expect(event.timestamp).toMatch(TIMESTAMP_RE);
    expect(event.session_id).toBe("sess_1");
    expect(event.agent_id).toBe("agent_1");
    expect(event.type).toBe("agent_start");
    expect(event.environment).toBe("test");
    expect(event.goal).toBe("trace the run");
    expect(event.fw_custom).toBe("x");
  });

  it("promotes an event's required fields ahead of the environment", async () => {
    const { sink, lines } = capturingSink();
    const tracer = createFailproofTracer({ enabled: true, environment: "test", agentId: "agent_1", sink });

    tracer.toolUse({ toolName: "jadal.intake", toolCallId: "c1", input: { text: "hello" } });
    await tracer.flush();

    const event = only(events(lines));
    expect(Object.keys(event)).toEqual(["timestamp", "session_id", "agent_id", "type", "tool_name", "tool_call_id", "environment", "input"]);
    expect(event.type).toBe("tool_use");
    expect(event.tool_name).toBe("jadal.intake");
    expect(event.tool_call_id).toBe("c1");
  });

  it("drops reserved extras so a caller cannot rewrite the identity block", async () => {
    const { sink, lines } = capturingSink();
    const tracer = createFailproofTracer({ enabled: true, environment: "test", sessionId: "sess_1", agentId: "agent_1", sink });

    expect(RESERVED_EXTRA_NAMES.has("session_id")).toBe(true);
    tracer.agentStart({ extra: { session_id: "spoofed", agent_id: "spoofed", environment: "spoofed", fw_ok: true } });
    await tracer.flush();

    const event = only(events(lines));
    expect(event.session_id).toBe("sess_1");
    expect(event.agent_id).toBe("agent_1");
    expect(event.environment).toBe("test");
    expect(event.fw_ok).toBe(true);
  });

  it("omits undefined optionals rather than writing null", async () => {
    const { sink, lines } = capturingSink();
    const tracer = createFailproofTracer({ enabled: true, environment: "test", agentId: "agent_1", sink });

    tracer.agentStart({});
    await tracer.flush();

    const event = only(events(lines));
    expect(Object.keys(event)).toEqual(["timestamp", "session_id", "agent_id", "type", "environment"]);
  });

  it("refuses an environment containing a comma", () => {
    expect(() => createFailproofTracer({ environment: "prod,eu" })).toThrow(TypeError);
  });

  it("requires an agent id on every event", () => {
    const { sink } = capturingSink();
    const tracer = createFailproofTracer({ enabled: true, environment: "test", sessionId: "sess_1", sink });
    expect(() => tracer.agentStart({})).toThrow(/agent id/);
  });

  it("is inert when disabled", async () => {
    const { sink, lines } = capturingSink();
    const tracer = createFailproofTracer({ enabled: false, environment: "test", sink });

    tracer.agentStart({ agentId: "a" });
    tracer.toolUse({ agentId: "a", toolName: "t", toolCallId: "c" });
    await tracer.flush();

    expect(tracer.enabled).toBe(false);
    expect(tracer.emitted).toBe(0);
    expect(tracer.pending()).toBe(0);
    expect(lines).toHaveLength(0);
  });
});

describe("redaction", () => {
  it("replaces a bearer header, a JWT and vendor keys whole", () => {
    expect(redactString("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toBe("Authorization: [redacted]");
    expect(redactString("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop")).toBe("[redacted]");
    expect(redactString("sk-abcdefghijklmnopqrstuvwx")).toBe("[redacted]");
    expect(redactString("fpai_abcdefghijklmnopqrstuvwx")).toBe("[redacted]");
  });

  it("keeps the key but drops the value of a keyed secret", () => {
    expect(redactString("api_key=supersecretvalue")).toBe("api_key=[redacted]");
    expect(redactString("password: hunter2hunter2")).toBe("password=[redacted]");
  });

  it("leaves ordinary text untouched", () => {
    expect(redactString("Kisan Rao asked for 40 m3 of water")).toBe("Kisan Rao asked for 40 m3 of water");
  });

  it("redacts a secret-named key entirely, at any depth", () => {
    const value = redactValue({ user: { name: "Rao", password: "hunter2hunter2" }, notes: ["token=abcdefghijkl"] });
    expect(value).toEqual({ user: { name: "Rao", password: "[redacted]" }, notes: ["token=[redacted]"] });
  });

  it("passes numbers, booleans and null through untouched", () => {
    expect(redactValue(7)).toBe(7);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBeNull();
  });

  it("redacts before the bytes reach the sink", async () => {
    const { sink, lines } = capturingSink();
    const tracer = createFailproofTracer({ enabled: true, environment: "test", agentId: "agent_1", sink });

    tracer.agentStart({ goal: "call with Bearer abcdefghijklmnopqrstuvwxyz" });
    await tracer.flush();

    const event = only(events(lines));
    expect(event.goal).toBe("call with [redacted]");
    expect(lines.join("\n")).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});

describe("clock monotonicity", () => {
  it("stamps strictly increasing six-digit instants even within one millisecond", async () => {
    const { sink, lines } = capturingSink();
    const tracer = createFailproofTracer({ enabled: true, environment: "test", agentId: "agent_1", sink, batchSize: 10_000 });

    for (let i = 0; i < 50; i += 1) tracer.hookTriggered({ hookName: "jadal.http", hookId: `h${i}` });
    await tracer.flush();

    const stamps = events(lines).map((event) => String(event.timestamp));
    expect(stamps).toHaveLength(50);
    for (const stamp of stamps) expect(stamp).toMatch(TIMESTAMP_RE);
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i]! > stamps[i - 1]!).toBe(true);
    }
  });
});

describe("computed duration", () => {
  it("times a tool call from its opener and reports whole milliseconds", async () => {
    const { sink, lines } = capturingSink();
    const tracer = createFailproofTracer({ enabled: true, environment: "test", agentId: "agent_1", sink });

    tracer.toolUse({ toolName: "jadal.intake", toolCallId: "c1" });
    await sleep(20);
    tracer.toolResult({ toolName: "jadal.intake", toolCallId: "c1" });
    await tracer.flush();

    const parsed = events(lines);
    expect(parsed.map((event) => event.type)).toEqual(["tool_use", "tool_result"]);
    const result = parsed[1] as Record<string, unknown>;
    expect(typeof result.duration_ms).toBe("number");
    expect(result.duration_ms as number).toBeGreaterThanOrEqual(10);
  });

  it("omits duration_ms when no opener was recorded", async () => {
    const { sink, lines } = capturingSink();
    const tracer = createFailproofTracer({ enabled: true, environment: "test", agentId: "agent_1", sink });

    tracer.toolResult({ toolName: "t", toolCallId: "never-opened" });
    await tracer.flush();

    expect("duration_ms" in only(events(lines))).toBe(false);
  });

  it("refuses a caller-supplied duration on a closer the emitter times", () => {
    const { sink } = capturingSink();
    const tracer = createFailproofTracer({ enabled: true, environment: "test", agentId: "agent_1", sink });
    const fields = { toolName: "t", toolCallId: "c1", durationMs: 5 } as unknown as ToolResultFields;
    expect(() => tracer.toolResult(fields)).toThrow(TypeError);
  });

  it("accepts a caller-supplied duration on model_response, the one caller-timed closer", async () => {
    const { sink, lines } = capturingSink();
    const tracer = createFailproofTracer({ enabled: true, environment: "test", agentId: "agent_1", sink });

    tracer.modelResponse({ model: "sarvam", durationMs: 42 });
    await tracer.flush();

    expect(only(events(lines)).duration_ms).toBe(42);
  });
});
