/**
 * Minimal zod → JSON-schema conversion for the model-facing tool declarations.
 *
 * `toolSchemasFor` turns the contract's `toolSpecs` into OpenAI-shaped tool declarations. The
 * conversion below is deliberately narrow: it only has to cover the shapes `toolSpecs` uses
 * (objects of strings, numbers, booleans, enums, optionals, defaults and arrays). Unknown
 * constructs fall back to `{}`, which the model reads as "any JSON value"; the real gate is always
 * `toolSpecs[name].input.parse` in `./dispatch`.
 */

import { toolSpecs } from "@jadal/contracts";
import type { AgentName } from "@jadal/contracts";
import { TOOL_NAMES } from "./registry";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** zod stores its discriminator on `_def.typeName`; there is no public offline introspection API. */
function defOf(schema: unknown): Record<string, unknown> | null {
  const record = asRecord(schema);
  return record === null ? null : asRecord(record["_def"]);
}

function isOptionalLike(schema: unknown): boolean {
  const typeName = defOf(schema)?.["typeName"];
  return typeName === "ZodOptional" || typeName === "ZodDefault";
}

function jsonSchemaOf(schema: unknown): Record<string, unknown> {
  const def = defOf(schema);
  if (def === null) return {};
  switch (def["typeName"]) {
    case "ZodObject": {
      const shape = asRecord(def["shape"]);
      if (shape === null) return { type: "object" };
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const key of Object.keys(shape)) {
        properties[key] = jsonSchemaOf(shape[key]);
        if (!isOptionalLike(shape[key])) required.push(key);
      }
      return required.length === 0
        ? { type: "object", properties, additionalProperties: false }
        : { type: "object", properties, required, additionalProperties: false };
    }
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum": {
      const values = def["values"];
      return { type: "string", enum: Array.isArray(values) ? values : [] };
    }
    case "ZodLiteral":
      return { const: def["value"] };
    case "ZodArray":
      return { type: "array", items: jsonSchemaOf(def["type"]) };
    case "ZodOptional":
    case "ZodDefault":
    case "ZodNullable":
      return jsonSchemaOf(def["innerType"]);
    default:
      return {};
  }
}

/** OpenAI-shaped tool declarations for one agent, filtered by `toolSpecs[*].agent`. */
export function toolSchemasFor(agent: AgentName): unknown[] {
  return TOOL_NAMES.filter((name) => (toolSpecs[name].agent as readonly string[]).includes(agent)).map((name) => ({
    type: "function",
    function: {
      name,
      description: `Jadal ${agent} tool: ${name}`,
      parameters: jsonSchemaOf(toolSpecs[name].input),
    },
  }));
}
