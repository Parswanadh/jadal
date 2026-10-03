/**
 * The read side of the store.
 *
 * This file is a barrel: the queries live in `repo/*` grouped by domain, and every module maps
 * projection rows to the **contract shapes** in `@jadal/contracts/entities` — the same objects
 * `routes.*.response` validates — rather than leaking SQL column names to callers. Routes hand these
 * straight to `c.json()`, so a shape drift shows up as a contract-test failure instead of a silent
 * `undefined`.
 *
 *  * `repo/canal.ts`        — canal and outlet reads.
 *  * `repo/farmers.ts`      — farmer, plot and crop-plan reads.
 *  * `repo/entitlements.ts` — entitlement and season reads.
 *  * `repo/roster.ts`       — release-window and roster reads.
 *  * `repo/requests.ts`     — water-request reads.
 *  * `repo/contacts.ts`     — contact reads.
 *  * `repo/ledger.ts`       — ledger-entry reads.
 *  * `repo/clock.ts`        — clock and weather reads.
 *  * `repo/shared.ts`       — row/boolean/JSON conversions and `WHERE` plumbing.
 *
 * ## Naming convention
 *
 * A read function's verb says what it returns, so a call site can be read without opening the module:
 *
 *   * `get*`  — a single item looked up **by its id** (`getCanal`, `getFarmer`, `getSeason`,
 *               `getReleaseWindow`, `getRoster`, `getRequest`, `getContact`). `getClockNow` is the one
 *               singleton accessor: the clock is a single row, not an id lookup.
 *   * `list*` — a **collection** query, with or without a filter (`listOutlets`, `listFarmers`,
 *               `listEntitlements`, `listReleaseWindows`, `listRosters`, `listRequests`,
 *               `listContacts`).
 *   * `read*` — a **complex** read that joins tables or assembles a snapshot spanning more than one
 *               projection (`readEvents`, `readRequestSnapshot`, `readEventLog`). These deliberately
 *               live outside `repo/` — in `db/store.ts` and `routes/read.ts` — because they are not a
 *               single-table projection read.
 *
 * New readers follow the rule. Three collection readers predate it and keep their historical names
 * (`getEntitlementsForWeek`, `getLedgerEntries`, `getWeather`); they are exceptions to the `list*`
 * rule, not a second convention.
 *
 * Nothing here writes. All state changes go through `appendEvent` (`store.ts`).
 */

export { getCanal, listOutlets } from "./repo/canal";
export { getFarmer, listFarmers, listVerifiedCropPlans } from "./repo/farmers";
export type { FarmerRecord } from "./repo/farmers";
export { getEntitlementsForWeek, getSeason, listEntitlements } from "./repo/entitlements";
export type { EntitlementFilter, SeasonRecord } from "./repo/entitlements";
export { getReleaseWindow, getRoster, listReleaseWindows, listRosters } from "./repo/roster";
export type { RosterFilter, RosterRecord } from "./repo/roster";
export { getRequest, listRequests } from "./repo/requests";
export type { RequestFilter } from "./repo/requests";
export { getContact, listContacts } from "./repo/contacts";
export type { ContactFilter, ContactRecord } from "./repo/contacts";
export { getLedgerEntries } from "./repo/ledger";
export type { LedgerFilter } from "./repo/ledger";
export { getClockNow, getWeather } from "./repo/clock";
