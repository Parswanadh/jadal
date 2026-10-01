/**
 * The hand-rolled System-2 tool loop.
 *
 * `runAgent` is deliberately small rather than delegated to an SDK: `llm.chat` returns either prose
 * or typed tool calls, and the loop feeds the tool results back until the model answers or a cap
 * stops it. It caps the number of steps and the calls per step, and refuses to execute the exact same
 * `(name, args)` call twice — a looping model cannot make the demo spend an unbounded amount of work.
 *
 * Gating lives in `./tools.runTool`: a gated tool's result comes back as a proposal, is recorded in
 * the returned `proposal`, and is never applied. The loop does not commit anything itself.
 *
 * EVENT LOGGING. The contract's `JadalEvent` union has no generic "agent step" variant, and B-SPEC
 * forbids inventing event types. Every step is therefore recorded in the returned `steps` array with
 * `actor: { kind: "agent", id }`; only tools that map onto a real event (`place_call`,
 * `send_whatsapp`, `record_ack`) append to the log, through `appendEvent` inside the tool.
 */

import type { AgentName } from "@jadal/contracts";
import { chat, type ChatMessage } from "./llm";
import { runTool, toAgentEnv, toolSchemasFor, type ToolEnv } from "./tools";

export const DEFAULT_MAX_STEPS = 8;
/** Hard cap on tool calls executed from a single model turn. */
export const MAX_CALLS_PER_STEP = 4;
/** Tool results are fed back as text; a very large result is truncated to keep the prompt bounded. */
const MAX_RESULT_CHARS = 4000;

export interface AgentStep {
  readonly index: number;
  readonly type: "llm" | "tool" | "refused" | "cap";
  readonly name?: string;
  readonly detail: string;
  readonly actor: { readonly kind: "agent"; readonly id: string };
}

export interface ToolCallRecord {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly gated: boolean;
}

export interface AgentProposal {
  readonly tool: string;
  readonly value: unknown;
}

export interface AgentRunOptions {
  readonly name: AgentName;
  readonly system: string;
  readonly goal: string;
  readonly maxSteps?: number;
}

export interface AgentRunResult {
  readonly text: string;
  readonly steps: AgentStep[];
  readonly toolCalls: ToolCallRecord[];
  readonly source: "llm" | "fallback";
  readonly proposal?: AgentProposal;
}

/** Deterministic stringify with sorted keys, so `{a,b}` and `{b,a}` collide as the same call. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function stringifyResult(value: unknown): string {
  const text = JSON.stringify(value) ?? "null";
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…(truncated)` : text;
}

/** Deterministic text for the offline path; the loop never throws just because there is no key. */
function fallbackText(name: AgentName): string {
  return `${name} agent: no language model is configured, so the deterministic tools are the whole answer.`;
}

/**
 * Run one agent to completion (or to `maxSteps`).
 *
 * @returns `source: "fallback"` when no model answered (no key, or a transport failure); the loop has
 *   then made zero network calls beyond the failed attempt, and `chat` itself made none at all when
 *   the key is absent.
 */
export async function runAgent(env: ToolEnv, options: AgentRunOptions): Promise<AgentRunResult> {
  const { name, system, goal } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const actor = { kind: "agent" as const, id: name };

  const steps: AgentStep[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const seen = new Set<string>();
  const messages: ChatMessage[] = [{ role: "user", content: goal }];
  let proposal: AgentProposal | undefined;

  for (let step = 0; step < maxSteps; step += 1) {
    const result = await chat(toAgentEnv(env), { system, messages, tools: toolSchemasFor(name) });

    if (result.source === "fallback") {
      steps.push({ index: step, type: "llm", detail: "model unavailable; deterministic path", actor });
      return { text: fallbackText(name), steps, toolCalls, source: "fallback", ...(proposal ? { proposal } : {}) };
    }

    const calls = result.toolCalls.slice(0, MAX_CALLS_PER_STEP);
    if (result.toolCalls.length > calls.length) {
      steps.push({ index: step, type: "cap", detail: `per-step tool-call cap (${MAX_CALLS_PER_STEP}) reached`, actor });
    }

    if (calls.length === 0) {
      steps.push({ index: step, type: "llm", detail: "final answer", actor });
      return { text: result.content ?? "", steps, toolCalls, source: "llm", ...(proposal ? { proposal } : {}) };
    }

    // The OpenAI wire format wants an assistant message carrying the tool calls before the tool
    // results; `llm.ChatMessage` carries only role+content, so the calls are summarised as prose.
    messages.push({ role: "assistant", content: calls.map((call) => `call ${call.name}(${JSON.stringify(call.args)})`).join("; ") });

    for (const call of calls) {
      const key = `${call.name}:${stableStringify(call.args)}`;
      if (seen.has(key)) {
        steps.push({ index: step, type: "refused", name: call.name, detail: "duplicate tool call refused", actor });
        messages.push({ role: "tool", tool_call_id: call.id, content: `refused: duplicate ${call.name} call with identical arguments` });
        continue;
      }
      seen.add(key);

      try {
        const outcome = await runTool(env, call.name, call.args);
        toolCalls.push({ name: call.name, args: call.args, gated: outcome.gated });
        if (outcome.gated) proposal = { tool: outcome.name, value: outcome.value };
        steps.push({
          index: step,
          type: "tool",
          name: call.name,
          detail: outcome.gated ? "proposal built (not committed)" : "executed",
          actor,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: stringifyResult(outcome.value) });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        steps.push({ index: step, type: "tool", name: call.name, detail: `error: ${detail}`, actor });
        messages.push({ role: "tool", tool_call_id: call.id, content: `error: ${detail}` });
      }
    }
  }

  steps.push({ index: maxSteps, type: "cap", detail: `maxSteps (${maxSteps}) reached`, actor });
  return { text: fallbackText(name), steps, toolCalls, source: "llm", ...(proposal ? { proposal } : {}) };
}
