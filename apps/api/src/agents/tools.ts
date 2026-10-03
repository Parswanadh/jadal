/**
 * Tool registry barrel.
 *
 * The implementation is split across `tools/` so each concern stays small and navigable:
 *
 *  * `tools/registry.ts`   — tool definitions, input readers and every runner.
 *  * `tools/json-schema.ts`— the zod → JSON-schema conversion for the model's tool declarations.
 *  * `tools/dispatch.ts`   — `runTool` and the gating decision.
 *
 * Importers keep using `./tools`; this file just re-exports the public surface.
 */

export {
  TOOL_NAMES,
  isToolName,
  providerEnvOf,
  toAgentEnv,
  tools,
} from "./tools/registry";
export type { ToolDefinition, ToolEnv, ToolName, ToolRunner } from "./tools/registry";
export { toolSchemasFor } from "./tools/json-schema";
export { runTool } from "./tools/dispatch";
export type { ToolOutcome } from "./tools/dispatch";
