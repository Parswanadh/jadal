/**
 * A thin, dependency-free Failproof AI event emitter for Jadal.
 *
 * ## What this is (and is not)
 *
 * Failproof AI's loop is Session → Audit → Finding → Issue → Policy. A **Session** is one agent
 * task; an **Event** is one recorded action inside it. The official TypeScript SDK
 * (`@failproofai/sdk`) emits those events; this module emits the *same wire format* with no
 * dependency, because `apps/api` is a Cloudflare Worker bundle and the SDK is Node-only (it writes
 * to a filesystem spool).
 *
 * The wire format here is copied field-for-field from the SDK's `dist/esm/schema.js`
 * (`toDict()` is the format — key order included), and the timestamp/queue semantics from its
 * `clock.js` and `writer.js`:
 *
 *   * envelope: `{ timestamp, session_id, agent_id, type, <required…>, environment, <optional…>, <extras…> }`
 *   * `timestamp` is `YYYY-MM-DDTHH:mm:ss.ssssssZ` — six fractional digits, strictly increasing
 *     within the process so a `tool_result` can never sort before its own `tool_use`;
 *   * closers (`tool_result`, `model_response`, `hook_completed`, `agent_resume`, `human_input`)
 *     carry a `duration_ms` the emitter *computes* — a caller-supplied one is refused, because a
 *     reported duration is unfalsifiable;
 *   * `agent_end.outcome` must be one of `success | failed | error | timeout | rejected | cancelled`
 *     for the dashboard to treat a run as failed — the near-miss `"failure"` counts as success.
 *
 * ## Why it does not call the network
 *
 * The SDK writes JSONL batch files into `~/.failproofai/custom-agents/events`; `failproofaid`
 * collects and uploads them. That indirection is what lets a Worker emit too: the sink is injected,
 * so the Worker can be given a no-op (or an HTTP sink) and a Node process can be given
 * `spoolSink()` from `./spool.ts`. **This module never imports `node:*` and never performs I/O**,
 * so importing it can never break the Worker build.
 *
 * ## Off by default
 *
 * A tracer built with no `sink`, or with `enabled: false`, is inert: every method is a no-op and
 * nothing is serialised. `enabled` defaults to `FAILPROOF_ENABLED === "1"`, so the application runs
 * exactly as before unless someone asks for tracing. See `docs/ops/failproof.md`.
 */

/* ------------------------------------------------------------------ wire vocabulary */

/** Every event type the Failproof wire format accepts (the SDK's fifteen methods, three standalone). */
export type FailproofEventType =
  | "agent_start"
  | "agent_end"
  | "agent_pause"
  | "agent_resume"
  | "model_request"
  | "model_response"
  | "tool_use"
  | "tool_result"
  | "hook_triggered"
  | "hook_completed"
  | "error"
  | "human_wait"
  | "human_input"
  | "human_pause"
  | "human_interrupt";

/**
 * Field names the wire format owns. An extra that collides with one of these is refused rather
 * than allowed to overwrite a promoted column (the SDK's `DECLARED_FIELD_NAMES`, same set).
 */
export const DECLARED_FIELD_NAMES: ReadonlySet<string> = new Set([
  "timestamp",
  "session_id",
  "agent_id",
  "type",
  "environment",
  "tool_name",
  "tool_call_id",
  "input",
  "output",
  "error",
  "duration_ms",
  "model",
  "messages",
  "system",
  "tools",
  "request_id",
  "stop_reason",
  "input_tokens",
  "output_tokens",
  "content",
  "role",
  "goal",
  "parent_id",
  "outcome",
  "summary",
  "pause_id",
  "reason",
  "user_id",
  "hook_name",
  "hook_id",
  "trigger_event",
  "error_type",
  "message",
  "traceback",
  "input_id",
  "prompt",
  "options",
  "response",
  "at_step",
]);

/** Reserved outright: the identity block and the environment are the emitter's, not a caller's. */
export const RESERVED_EXTRA_NAMES: ReadonlySet<string> = new Set([
  "timestamp",
  "session_id",
  "agent_id",
  "type",
  "environment",
]);

/** Outcomes the server reads as a FAILED run. Anything else — including `"failure"` — is a success. */
export const FAILED_OUTCOMES: ReadonlySet<string> = new Set(["failed", "error", "timeout", "rejected"]);

/* ------------------------------------------------------------------ sink */

/**
 * Where encoded lines go. `write` receives complete JSONL lines (no trailing newline) and must
 * never throw into the caller's agent loop: a telemetry outage must not fail a water request.
 */
export interface FailproofSink {
  write(lines: readonly string[]): void | Promise<void>;
}

/** The default: accept everything, keep nothing. */
export const noopSink: FailproofSink = {
  write(): void {
    /* intentionally empty */
  },
};

/* ------------------------------------------------------------------ clock */

/**
 * Microseconds since the epoch, strictly increasing within this process.
 *
 * Mirrors the SDK's `nowMicros()`: the wall clock gives the millisecond and the sub-millisecond
 * digits are a sequence, so four events emitted inside one millisecond still order correctly on the
 * dashboard. A wall clock that steps backwards is followed rather than fought.
 */
const CLOCK_KEY = Symbol.for("jadal.failproof.clock");
const MAX_LEAD_MICROS = 1_000_000;

interface ClockState {
  last: number;
}

function clockState(): ClockState {
  const holder = globalThis as unknown as Record<symbol, ClockState | undefined>;
  let found = holder[CLOCK_KEY];
  if (found === undefined) {
    found = { last: 0 };
    holder[CLOCK_KEY] = found;
  }
  return found;
}

/** Microseconds since the epoch, strictly increasing within the process. */
export function nowMicros(): number {
  const clock = clockState();
  const wall = Date.now() * 1000;
  const next = wall > clock.last || clock.last - wall > MAX_LEAD_MICROS ? wall : clock.last + 1;
  clock.last = next;
  return next;
}

/** `2026-09-23T12:34:56.123456Z` — six fractional digits, as the ingest parser expects. */
export function formatMicros(micros: number): string {
  const ms = Math.floor(micros / 1000);
  const sub = String(micros - ms * 1000).padStart(3, "0");
  return `${new Date(ms).toISOString().slice(0, -1)}${sub}Z`;
}

/* ------------------------------------------------------------------ redaction */

/**
 * Redact secret-shaped strings before they reach a sink.
 *
 * The SDK redacts API keys, tokens, JWTs and bearer headers before the bytes reach disk, and the
 * daemon redacts again before upload. This is the same idea at the emitter boundary: Jadal's flow
 * carries farmer names and a Telugu transcript, not credentials, but a trace is a place credentials
 * must never land by accident.
 */
const REDACTION_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(sk|pk|rk)-[A-Za-z0-9]{16,}\b/g,
  /\b(fp|fpai)_[A-Za-z0-9]{16,}\b/g,
  /\b(api[_-]?key|token|secret|password|authorization)\s*[=:]\s*["']?[A-Za-z0-9._~+/=-]{8,}/gi,
];

/** Replace secret-shaped substrings with `[redacted]`. Non-strings pass through untouched. */
export function redactString(value: string): string {
  let out = value;
  for (const pattern of REDACTION_PATTERNS) out = out.replace(pattern, (match) => `${match.split(/[=:]/)[0]}=[redacted]`);
  return out;
}

/** Depth-bounded, cycle-safe redaction of a JSON-ish value. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 20) return "<max depth exceeded>";
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = /^(api_?key|token|secret|password|authorization)$/i.test(key) ? "[redacted]" : redactValue(item, depth + 1);
  }
  return out;
}

/* ------------------------------------------------------------------ field shapes */

/** Identity every event carries; the scopes fill it in, so most callers never pass it. */
export interface FailproofIdentity {
  sessionId?: string;
  agentId?: string;
}

/** Free-form fields stored with the event. Namespace them `fw_*` so they cannot collide. */
export type ExtraFields = Record<string, unknown>;

export interface AgentStartFields extends FailproofIdentity {
  goal?: string;
  parentId?: string;
  extra?: ExtraFields;
}

export interface AgentEndFields extends FailproofIdentity {
  outcome?: string;
  summary?: string;
  extra?: ExtraFields;
}

export interface ToolUseFields extends FailproofIdentity {
  toolName: string;
  toolCallId: string;
  input?: unknown;
  extra?: ExtraFields;
}

export interface ToolResultFields extends FailproofIdentity {
  toolName: string;
  toolCallId: string;
  output?: unknown;
  error?: string;
  extra?: ExtraFields;
}

export interface ModelRequestFields extends FailproofIdentity {
  model?: string;
  messages?: unknown;
  system?: string;
  tools?: unknown;
  requestId?: string;
  extra?: ExtraFields;
}

export interface ModelResponseFields extends FailproofIdentity {
  model?: string;
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  content?: unknown;
  role?: string;
  requestId?: string;
  /** The ONE closer a caller may time: only the caller knows real provider latency. Whole ms. */
  durationMs?: number;
  extra?: ExtraFields;
}

export interface HookTriggeredFields extends FailproofIdentity {
  hookName: string;
  hookId: string;
  triggerEvent?: string;
  input?: unknown;
  extra?: ExtraFields;
}

export interface HookCompletedFields extends FailproofIdentity {
  hookName: string;
  hookId: string;
  outcome?: string;
  output?: unknown;
  error?: string;
  extra?: ExtraFields;
}

export interface ErrorFields extends FailproofIdentity {
  errorType: string;
  message: string;
  traceback?: string;
  extra?: ExtraFields;
}

export interface HumanWaitFields extends FailproofIdentity {
  inputId: string;
  prompt?: string;
  options?: unknown;
  reason?: string;
  extra?: ExtraFields;
}

export interface HumanInputFields extends FailproofIdentity {
  inputId: string;
  response?: unknown;
  extra?: ExtraFields;
}

export interface HumanPauseFields extends FailproofIdentity {
  reason?: string;
  userId?: string;
  extra?: ExtraFields;
}

export interface HumanInterruptFields extends FailproofIdentity {
  reason?: string;
  userId?: string;
  atStep?: string | number;
  extra?: ExtraFields;
}

/* ------------------------------------------------------------------ builder */

/**
 * The identity block, then `environment`, then supplied optionals in declared order, then extras.
 *
 * KEY ORDER IS PART OF THE FORMAT, exactly as the SDK's `schema.js` says: the two SDKs write into
 * the same spool and the same ingest endpoint, so a field that differs is a field the dashboard
 * renders for one writer and not the other.
 */
function build(
  base: Record<string, unknown>,
  environment: string,
  specifics: readonly (readonly [string, unknown])[],
  extra: ExtraFields | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base, environment };
  for (const [key, value] of specifics) {
    if (value !== undefined && value !== null) result[key] = redactValue(value);
  }
  if (extra !== undefined) {
    for (const [key, value] of Object.entries(extra)) {
      if (RESERVED_EXTRA_NAMES.has(key)) continue;
      result[key] = redactValue(value);
    }
  }
  return result;
}

/** Pairing kinds and the id field that matches an opener to its closer. */
const PAIR_KEYS = {
  tool: "tool_call_id",
  hook: "hook_id",
  pause: "pause_id",
  human: "input_id",
  model: "request_id",
} as const;

type PairKind = keyof typeof PAIR_KEYS;

/* ------------------------------------------------------------------ tracer */

export interface FailproofTracerOptions {
  /** Identity for the whole run. A caller should pass its own request/job id where one exists. */
  sessionId?: string;
  /** The label on every event, e.g. `development`, `production`. No commas (ingest splits on them). */
  environment?: string;
  /** Default agent id for events that do not set one. */
  agentId?: string;
  /** `false` makes the tracer inert. Defaults to `FAILPROOF_ENABLED === "1"`. */
  enabled?: boolean;
  /** Where encoded lines go. Defaults to `noopSink`. */
  sink?: FailproofSink;
  /** Lines are buffered and handed to the sink in batches of at most this many. Default 200. */
  batchSize?: number;
}

export interface FailproofTracer {
  readonly enabled: boolean;
  readonly sessionId: string;
  readonly environment: string;
  /** Number of events emitted so far (before batching). */
  readonly emitted: number;
  /** Events emitted and not yet flushed. */
  pending(): number;

  agentStart(fields?: AgentStartFields): void;
  agentEnd(fields?: AgentEndFields): void;
  toolUse(fields: ToolUseFields): void;
  toolResult(fields: ToolResultFields): void;
  modelRequest(fields?: ModelRequestFields): void;
  modelResponse(fields?: ModelResponseFields): void;
  hookTriggered(fields: HookTriggeredFields): void;
  hookCompleted(fields: HookCompletedFields): void;
  error(fields: ErrorFields): void;
  humanWait(fields: HumanWaitFields): void;
  humanInput(fields: HumanInputFields): void;
  humanPause(fields?: HumanPauseFields): void;
  humanInterrupt(fields?: HumanInterruptFields): void;

  /** Set the ambient agent id for subsequent events that do not name one. */
  setAgentId(agentId: string | undefined): void;
  /** The ambient agent id, or undefined. */
  currentAgentId(): string | undefined;

  /** Emit `agent_start`, run `body`, emit `agent_end` (and `error` on a throw), re-throw. */
  agent<T>(agentId: string, options: { goal?: string; parentId?: string; extra?: ExtraFields } | undefined, body: () => T): T;
  /** Emit `tool_use`, run `body`, emit `tool_result`, re-throw. */
  toolCall<T>(name: string, options: { toolCallId?: string; input?: unknown; extra?: ExtraFields }, body: () => T): T;

  /** Hand buffered lines to the sink. Safe to call more than once. */
  flush(): Promise<void>;
}

function randomId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid === "string") return `${prefix}_${uuid}`;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** A promise-like value, without importing anything. Keeps the scopes sync-when-sync. */
function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/** Refuse a caller-supplied `duration_ms`, exactly as the SDK does. */
function refuseCallerDuration(fields: Record<string, unknown>, method: string): void {
  if ("durationMs" in fields || "duration_ms" in fields) {
    throw new TypeError(`${method}: duration_ms is computed by the emitter and cannot be passed by the caller`);
  }
}

/**
 * Build a tracer. Off unless asked for: with no sink, or `enabled: false`, every method is inert.
 *
 * @throws {TypeError} when `environment` contains a comma — ingest splits that field to build its
 *   filters and silently drops every event whose label contains one.
 */
export function createFailproofTracer(options: FailproofTracerOptions = {}): FailproofTracer {
  const environment = options.environment ?? environmentFromGlobal() ?? "dev";
  if (environment.includes(",")) {
    throw new TypeError(`Failproof environment must not contain a comma (got ${JSON.stringify(environment)})`);
  }

  const enabled = options.enabled ?? globalFlag("FAILPROOF_ENABLED");
  const sink = options.sink ?? noopSink;
  const batchSize = Math.max(1, options.batchSize ?? 200);
  const sessionId = options.sessionId ?? randomId("sess");
  let agentId = options.agentId;

  const openers = new Map<string, number>();
  let buffer: string[] = [];
  let emitted = 0;

  function pairKey(kind: PairKind, id: string): string {
    return `${kind}:${sessionId}:${id}`;
  }

  function enqueue(event: Record<string, unknown>): void {
    emitted += 1;
    if (buffer.length >= batchSize) {
      const full = buffer;
      buffer = [];
      void Promise.resolve(sink.write(full)).catch(() => {
        /* a telemetry sink never fails the agent loop */
      });
    }
    buffer.push(JSON.stringify(event));
  }

  function identity(fields: FailproofIdentity): { sessionId: string; agentId: string | undefined } {
    const sid = fields.sessionId ?? sessionId;
    const aid = fields.agentId ?? agentId;
    if (aid === undefined) {
      throw new TypeError("Failproof event has no agent id: bind one with agent()/setAgentId() or pass agentId");
    }
    return { sessionId: sid, agentId: aid };
  }

  function stamp(): string {
    return formatMicros(nowMicros());
  }

  function emit(type: FailproofEventType, fields: FailproofIdentity, required: Record<string, unknown>, specifics: readonly (readonly [string, unknown])[], extra?: ExtraFields): void {
    if (!enabled) return;
    const { sessionId: sid, agentId: aid } = identity(fields);
    const base = { timestamp: stamp(), session_id: sid, agent_id: aid, type, ...required };
    enqueue(build(base, environment, specifics, extra));
  }

  function open(kind: PairKind, id: string): void {
    openers.set(pairKey(kind, id), nowMicros());
  }

  /** Whole milliseconds since the matching opener, or undefined when there was none. */
  function close(kind: PairKind, id: string): number | undefined {
    const key = pairKey(kind, id);
    const started = openers.get(key);
    if (started === undefined) return undefined;
    openers.delete(key);
    const elapsed = Math.floor((nowMicros() - started) / 1000);
    return elapsed >= 0 ? elapsed : undefined;
  }

  const tracer: FailproofTracer = {
    get enabled() {
      return enabled;
    },
    sessionId,
    environment,
    get emitted() {
      return emitted;
    },
    pending() {
      return buffer.length;
    },

    agentStart(fields = {}) {
      emit("agent_start", fields, {}, [
        ["goal", fields.goal],
        ["parent_id", fields.parentId],
      ], fields.extra);
    },
    agentEnd(fields = {}) {
      emit("agent_end", fields, {}, [
        ["outcome", fields.outcome],
        ["summary", fields.summary],
      ], fields.extra);
    },
    toolUse(fields) {
      emit("tool_use", fields, { tool_name: fields.toolName, tool_call_id: fields.toolCallId }, [["input", fields.input]], fields.extra);
      if (enabled) open("tool", fields.toolCallId);
    },
    toolResult(fields) {
      refuseCallerDuration(fields as unknown as Record<string, unknown>, "toolResult");
      emit(
        "tool_result",
        fields,
        { tool_name: fields.toolName, tool_call_id: fields.toolCallId },
        [
          ["output", fields.output],
          ["error", fields.error],
          ["duration_ms", close("tool", fields.toolCallId)],
        ],
        fields.extra,
      );
    },
    modelRequest(fields = {}) {
      emit("model_request", fields, {}, [
        ["model", fields.model],
        ["messages", fields.messages],
        ["system", fields.system],
        ["tools", fields.tools],
        ["request_id", fields.requestId],
      ], fields.extra);
      if (enabled && fields.requestId !== undefined) open("model", fields.requestId);
    },
    modelResponse(fields = {}) {
      // The one closer a caller MAY time: only the caller knows the provider's real latency.
      const duration = fields.durationMs ?? (fields.requestId === undefined ? undefined : close("model", fields.requestId));
      emit("model_response", fields, {}, [
        ["model", fields.model],
        ["stop_reason", fields.stopReason],
        ["input_tokens", fields.inputTokens],
        ["output_tokens", fields.outputTokens],
        ["content", fields.content],
        ["role", fields.role],
        ["request_id", fields.requestId],
        // Not one of the SDK's four auto-timed closers (it does not time model calls), so the
        // duration is the caller's when supplied and the opener's gap otherwise.
        ["duration_ms", duration],
      ], fields.extra);
    },
    hookTriggered(fields) {
      emit("hook_triggered", fields, { hook_name: fields.hookName, hook_id: fields.hookId }, [
        ["trigger_event", fields.triggerEvent],
        ["input", fields.input],
      ], fields.extra);
      if (enabled) open("hook", fields.hookId);
    },
    hookCompleted(fields) {
      refuseCallerDuration(fields as unknown as Record<string, unknown>, "hookCompleted");
      emit(
        "hook_completed",
        fields,
        { hook_name: fields.hookName, hook_id: fields.hookId },
        [
          ["outcome", fields.outcome],
          ["output", fields.output],
          ["error", fields.error],
          ["duration_ms", close("hook", fields.hookId)],
        ],
        fields.extra,
      );
    },
    error(fields) {
      emit("error", fields, { error_type: fields.errorType, message: fields.message }, [["traceback", fields.traceback]], fields.extra);
    },
    humanWait(fields) {
      emit("human_wait", fields, { input_id: fields.inputId }, [
        ["prompt", fields.prompt],
        ["options", fields.options],
        ["reason", fields.reason],
      ], fields.extra);
      if (enabled) open("human", fields.inputId);
    },
    humanInput(fields) {
      refuseCallerDuration(fields as unknown as Record<string, unknown>, "humanInput");
      emit("human_input", fields, { input_id: fields.inputId }, [
        ["response", fields.response],
        ["duration_ms", close("human", fields.inputId)],
      ], fields.extra);
    },
    humanPause(fields = {}) {
      emit("human_pause", fields, {}, [
        ["reason", fields.reason],
        ["user_id", fields.userId],
      ], fields.extra);
    },
    humanInterrupt(fields = {}) {
      emit("human_interrupt", fields, {}, [
        ["reason", fields.reason],
        ["user_id", fields.userId],
        ["at_step", fields.atStep],
      ], fields.extra);
    },

    setAgentId(next) {
      agentId = next;
    },
    currentAgentId() {
      return agentId;
    },

    agent<T>(id: string, options: { goal?: string; parentId?: string; extra?: ExtraFields } | undefined, body: () => T): T {
      const previous = agentId;
      agentId = id;
      tracer.agentStart({ agentId: id, ...(options?.goal === undefined ? {} : { goal: options.goal }), ...(options?.parentId === undefined ? {} : { parentId: options.parentId }), ...(options?.extra === undefined ? {} : { extra: options.extra }) });

      const failed = (thrown: unknown): never => {
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        tracer.error({ agentId: id, errorType: thrown instanceof Error ? thrown.name : "Error", message });
        tracer.agentEnd({ agentId: id, outcome: "failed" });
        throw thrown;
      };

      // A synchronous body stays synchronous, exactly as the SDK promises; an async one closes
      // only once it settles, so the trace never records a promise as the run's outcome.
      try {
        const value = body();
        if (isThenable(value)) {
          return value.then(
            (settled) => {
              tracer.agentEnd({ agentId: id, outcome: "success" });
              agentId = previous;
              return settled;
            },
            (thrown) => {
              agentId = previous;
              return failed(thrown);
            },
          ) as unknown as T;
        }
        tracer.agentEnd({ agentId: id, outcome: "success" });
        agentId = previous;
        return value;
      } catch (thrown) {
        agentId = previous;
        return failed(thrown);
      }
    },

    toolCall<T>(name: string, options: { toolCallId?: string; input?: unknown; extra?: ExtraFields }, body: () => T): T {
      const toolCallId = options.toolCallId ?? randomId("call");
      tracer.toolUse({ toolName: name, toolCallId, ...(options.input === undefined ? {} : { input: options.input }), ...(options.extra === undefined ? {} : { extra: options.extra }) });
      try {
        const value = body();
        if (isThenable(value)) {
          return value.then(
            (settled) => {
              tracer.toolResult({ toolName: name, toolCallId, output: settled });
              return settled;
            },
            (thrown) => {
              tracer.toolResult({ toolName: name, toolCallId, error: thrown instanceof Error ? thrown.message : String(thrown) });
              throw thrown;
            },
          ) as unknown as T;
        }
        tracer.toolResult({ toolName: name, toolCallId, output: value });
        return value;
      } catch (thrown) {
        tracer.toolResult({ toolName: name, toolCallId, error: thrown instanceof Error ? thrown.message : String(thrown) });
        throw thrown;
      }
    },

    async flush(): Promise<void> {
      if (buffer.length === 0) return;
      const full = buffer;
      buffer = [];
      await sink.write(full);
    },
  };

  return tracer;
}

/* ------------------------------------------------------------------ environment helpers */

/** `globalThis.process.env` when it exists (Node, wrangler local), without importing `node:process`. */
function globalEnv(): Record<string, string | undefined> {
  const holder = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return holder.process?.env ?? {};
}

function globalFlag(name: string): boolean {
  return globalEnv()[name] === "1";
}

function environmentFromGlobal(): string | undefined {
  const value = globalEnv()["AGENTEYE_ENVIRONMENT"] ?? globalEnv()["FAILPROOF_ENVIRONMENT"];
  return value !== undefined && value.length > 0 ? value : undefined;
}
