/**
 * Tool dispatch: validate the input against the contract, run the tool, and centralise gating.
 *
 * This is the single seam the agent loop calls. A gated tool's runner is a proposal builder that
 * never writes; `runTool` wraps its value as `{ gated: true, proposal }` and never applies it.
 */

import { toolSpecs } from "@jadal/contracts";
import { isToolName, tools, type ToolEnv, type ToolName } from "./registry";

/** The outcome of one dispatch. `proposal` is present iff the tool is gated. */
export interface ToolOutcome {
  readonly name: ToolName;
  readonly gated: boolean;
  readonly value: unknown;
  readonly proposal?: unknown;
}

/**
 * Validate `rawInput` against the contract, run the tool, and centralise gating.
 *
 * Input validation happens *before* the runner: a tool never sees an input the contract rejects.
 * For a gated tool the return value is wrapped as a proposal and is not applied — the loop records
 * it and waits for the coordinator.
 *
 * @throws {RangeError} for an unknown tool name.
 * @throws {import("zod").ZodError} when the input does not satisfy `toolSpecs[name].input`.
 */
export async function runTool(env: ToolEnv, name: string, rawInput: unknown): Promise<ToolOutcome> {
  if (!isToolName(name)) throw new RangeError(`unknown tool: ${name}`);
  const definition = tools[name];
  const input = toolSpecs[name].input.parse(rawInput) as Record<string, unknown>;
  const value = await definition.run(env, input);
  if (definition.gated) return { name, gated: true, value, proposal: value };
  return { name, gated: false, value };
}
