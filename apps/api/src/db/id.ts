/**
 * Id generation.
 *
 * Two kinds of id, and picking the wrong one is a bug, so the rules are:
 *
 *  * `newId(prefix)` — **default for anything created at runtime**: a fresh request, a fresh farmer,
 *    a fresh roster. 122 bits of `crypto.randomUUID()`, so collisions are not a practical concern even
 *    with several Workers writing concurrently. Not reproducible, by design: replaying the event log
 *    is what produces the same ids again, not regenerating them.
 *
 *  * `deterministicId(namespace, ...parts)` — **for anything that must be identical across runs**: the
 *    demo seed in `packages/contracts/fixtures/demo-scenario.json`, snapshot/contract tests, and
 *    idempotent retries where "did I already create this?" has to be answerable. Same namespace and
 *    same parts ⇒ same id, forever, on any machine. Because of that it is *not* safe for two genuinely
 *    different objects: two farmers both named "Ramaiah" would collide. Include a discriminating part
 *    (phone number, sowing date, sequence number) whenever the parts are not already unique.
 *
 * Both prefix their output with a short type tag so an id in a log line is self-describing.
 */

/** Characters kept from a UUID. 32 hex chars is 128 bits — the whole UUID. */
const UUID_HEX_LENGTH = 32;

/**
 * Default id for runtime-created objects. Not reproducible; collision-free.
 *
 * @param prefix Short type tag, e.g. `"req"`, `"evt"`, `"lgr"`.
 */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, UUID_HEX_LENGTH)}`;
}

/** FNV-1a 64-bit, twice with different offset bases to get 128 deterministic bits. */
const FNV_PRIME = 0x100000001b3n;
const FNV_OFFSET_A = 0xcbf29ce484222325n;
const FNV_OFFSET_B = 0x84222325cbf29ce4n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64(input: string, offset: bigint): bigint {
  let hash = offset;
  for (let i = 0; i < input.length; i += 1) {
    // Hash UTF-16 code units rather than bytes: stable across runtimes, and no TextEncoder needed.
    hash = (hash ^ BigInt(input.charCodeAt(i))) & MASK_64;
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash;
}

/**
 * Id derived from its own content, so it is identical on every machine and every run.
 *
 * @param namespace Type tag, e.g. `"farmer"`. Keeps ids from different entity spaces apart.
 * @param parts The values that make this object unique. Serialised as JSON, so `("ab", "c")` and
 *   `("a", "bc")` cannot collide.
 */
export function deterministicId(namespace: string, ...parts: readonly (string | number)[]): string {
  const canonical = JSON.stringify(parts);
  const high = fnv1a64(canonical, FNV_OFFSET_A);
  const low = fnv1a64(canonical, FNV_OFFSET_B);
  return `${namespace}_${high.toString(16).padStart(16, "0")}${low.toString(16).padStart(16, "0")}`;
}