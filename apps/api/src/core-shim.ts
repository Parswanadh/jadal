/**
 * The single import boundary between the API and the deterministic core.
 *
 * Task A (`packages/core`) has not landed, so this module currently contains a complete,
 * self-contained implementation of the interfaces declared in `packages/contracts/src/core.ts`.
 * It is written so that swapping in the real core is a one-line change:
 *
 *   // export * from "@jadal/core";   ← once Task A merges
 *
 * Rules that hold either way:
 *  * Every water number in the API comes from here. No route, agent or prompt does arithmetic.
 *  * Agronomic constants come from the verified FAO-56 table in
 *    `docs/research/fao56-crop-tables.md` (see `./core/crop-params.ts`), never from memory.
 *  * Anything not in FAO-56 is marked `// ASSUMED: <why>`.
 */

export * from "./core/crop-params";
export * from "./core/soil";
export * from "./core/crop-engine";
export * from "./core/hydraulics";
export * from "./core/roster";
export * from "./core/ledger";
export * from "./core/policy";
export * from "./core/units";