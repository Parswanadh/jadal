/**
 * Wiring the B8 telephony module into the running Worker (B9).
 *
 * `apps/api/src/telephony/` is deliberately self-contained: it imports no database, no route and no
 * `Env`, and receives everything through `TelephonyDeps`. This module is the one place that builds
 * that object from the Worker's bindings, so the module stays decoupled and testable while the app
 * gets a mounted `/api/telephony`.
 *
 * Three things are worth knowing about the shape:
 *
 *  * **Every state change is an event.** `recordAck` and `updateContactStatus` append
 *    `contact.updated` through `appendEvent`, exactly like the caller agent's `record_ack` tool and
 *    the escalation ladder. Nothing writes a projection directly.
 *  * **`raiseRequest` is the same path as `POST /api/requests`** — literally the same function
 *    (`src/requests.ts`), so a request raised by a keypress and one raised by the web form produce
 *    identical events. The voice channel has no volume in the keypad signal, so the volume comes from
 *    `extractVolumeM3(reason)` and falls back to `0`, matching `POST /api/intake`.
 *  * **`detail` and `via` are accepted but not persisted.** The contract's `contact.updated` carries
 *    a `Contact` and nothing else — there is no field for a Twilio `CallSid`, a call duration or the
 *    acknowledgement channel. Contracts are immutable, so those two values are deliberately dropped
 *    rather than smuggled into `Contact.transcript`, which means speech. See the PR body for the
 *    contract gap this leaves open.
 */

import type { Contact, System1Result } from "@jadal/contracts";

import { now } from "./db/clock";
import { newId } from "./db/id";
import { getContact, getFarmer } from "./db/repo";
import { appendEvent } from "./db/store";
import { DEMO_CANAL_ID } from "./demo";
import type { Env } from "./env";
import { providerEnv } from "./http";
import { raiseRequest } from "./requests";
import { classify, extractVolumeM3 } from "./system1";
import type { AudioCache, RaiseRequestInput, StatusDetail, TelephonyDeps, TelephonyEnv } from "./telephony";
import { placeCall, type PlaceCallInput, type PlaceCallResult } from "./telephony";

/**
 * The bindings slice telephony needs.
 *
 * `Env` satisfies it structurally; the campaign modules pass their own narrower `CampaignEnv`, which
 * declares the same Twilio/Sarvam keys and `CACHE` but is not the Worker's `Env`. Declaring the slice
 * here keeps `campaigns/escalation.ts` from importing `Env` and keeps this module free of cycles.
 */
export interface TelephonyBindings extends TelephonyEnv {
  readonly CACHE?: KVNamespace | undefined;
  /** Injected only by tests; the Worker falls back to the runtime's global `fetch`. */
  readonly fetch?: unknown;
}

/** The runtime fetch, used when no test injected one. */
const runtimeFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

/**
 * Adapt a KV namespace to the telephony module's binary `AudioCache`.
 *
 * The ambient `KVNamespace` in `env.d.ts` (there is no `@cloudflare/workers-types` in this repo)
 * types `get` as `Promise<string | null>`, while the real binding returns an `ArrayBuffer` when asked
 * for `"arrayBuffer"`. The cast is confined to this lookup; `put` accepts an `ArrayBuffer` as-is.
 */
export function audioCacheFromKv(kv: KVNamespace | undefined): AudioCache {
  return {
    async get(key: string): Promise<ArrayBuffer | null> {
      if (kv === undefined) return null;
      const value = (await kv.get(key, "arrayBuffer")) as unknown as ArrayBuffer | null;
      return value ?? null;
    },
    async put(key: string, value: ArrayBuffer): Promise<void> {
      await kv?.put(key, value);
    },
  };
}

/** The `TelephonyEnv` view of a bindings object. Every key is optional, so this is the identity. */
export function telephonyEnvOf(env: TelephonyEnv): TelephonyEnv {
  return env;
}

/**
 * The `placeCall` slice of `TelephonyDeps`, built from any object carrying the telephony bindings.
 *
 * `fetch` is cast because `CampaignEnv.fetch` is the narrower `ProviderFetch` (string URL, small init)
 * while `placeCall` declares the DOM `typeof fetch`. The campaign callers only ever pass a URL and a
 * `RequestInit`, so the two shapes agree at every call site; the cast is documented rather than
 * duplicated by widening `ProviderFetch`.
 */
export function placeCallDeps(env: TelephonyBindings): Pick<TelephonyDeps, "env" | "fetch" | "cache"> {
  const injected = env.fetch;
  return {
    env: telephonyEnvOf(env),
    fetch: typeof injected === "function" ? (injected as typeof fetch) : runtimeFetch,
    cache: audioCacheFromKv(env.CACHE),
  };
}

/** Place an outbound call through the shared `placeCall`, for the escalation ladder (B9 step 2). */
export function placeCallFromCampaign(env: TelephonyBindings, input: PlaceCallInput): Promise<PlaceCallResult> {
  return placeCall(placeCallDeps(env), input);
}

/**
 * Append a `contact.updated` event for `contact`.
 *
 * The single writer used by every dep below, so the actor and the id convention stay consistent with
 * the rest of the API (`newId("evt")`, the caller agent as the actor).
 */
async function updateContact(env: Env, contact: Contact): Promise<void> {
  await appendEvent(env, {
    id: newId("evt"),
    at: await now(env),
    canal_id: DEMO_CANAL_ID,
    actor: { kind: "agent", id: "caller" },
    type: "contact.updated",
    contact,
  });
}

/** Strip the repo's extra columns so only the contract's `Contact` is written to the log. */
function plainContact(record: Contact): Contact {
  return {
    id: record.id,
    farmer_id: record.farmer_id,
    channel: record.channel,
    purpose: record.purpose,
    status: record.status,
    attempt: record.attempt,
    message_te: record.message_te,
    message_en: record.message_en,
    at: record.at,
    ...(record.transcript === undefined ? {} : { transcript: record.transcript }),
  };
}

/**
 * Build the full `TelephonyDeps` for one request's bindings.
 *
 * Called per request from `app.ts` because the Worker's bindings (`DB`, `CACHE`, secrets) arrive with
 * the request, not at module load. The object is cheap: closures over `env` and nothing else.
 */
export function buildTelephonyDeps(env: Env): TelephonyDeps {
  const bindings: TelephonyBindings = env;
  return {
    ...placeCallDeps(bindings),
    mountPath: "/api/telephony",

    async getContact(contactId: string): Promise<Contact | null> {
      const record = await getContact(env, contactId);
      return record === null ? null : plainContact(record);
    },

    /** The Telugu text spoken to the farmer; empty for an unknown contact rather than a throw. */
    async getMessage(contactId: string): Promise<string> {
      const record = await getContact(env, contactId);
      return record?.message_te ?? "";
    },

    /**
     * Record the farmer's DTMF acknowledgement.
     *
     * `via` ("dtmf:1") names how the acknowledgement arrived; the contract's `contact.updated` has no
     * field for it, so it is not persisted (see the module docstring). Only an affirmative answer
     * moves the status — a negative one keeps whatever the contact already had, mirroring the caller
     * agent's `record_ack` tool.
     */
    async recordAck(contactId: string, acknowledged: boolean, _via: string): Promise<void> {
      const record = await getContact(env, contactId);
      if (record === null) return;
      const current = plainContact(record);
      if (!acknowledged) return;
      await updateContact(env, { ...current, status: "acknowledged" });
    },

    /**
     * Apply a Twilio call-progress status to the contact.
     *
     * The route already refuses to touch an `acknowledged` or `escalated` contact; the guard is
     * repeated here so a direct caller (or a race between two late webhooks) cannot regress a
     * confirmed contact either.
     */
    async updateContactStatus(contactId: string, status: Contact["status"], _detail?: StatusDetail): Promise<void> {
      const record = await getContact(env, contactId);
      if (record === null) return;
      const current = plainContact(record);
      if (current.status === "acknowledged" || current.status === "escalated") return;
      await updateContact(env, { ...current, status });
    },

    async classify(transcript: string): Promise<System1Result> {
      return classify(providerEnv(env), transcript);
    },

    /**
     * Raise a request from a voice recording through the same path as `POST /api/requests`.
     *
     * A voice request carries no volume: the keypad signal says "urgent", not "how many m³". The
     * transcript is scanned for a spoken volume and defaults to `0`, which is exactly what
     * `POST /api/intake` does, so a coordinator sees the same shape either way.
     */
    async raiseRequest(input: RaiseRequestInput): Promise<void> {
      const farmer = await getFarmer(env, input.farmerId);
      if (farmer === null) return;
      await raiseRequest(env, {
        farmer_id: input.farmerId,
        type: input.type,
        volume_m3: extractVolumeM3(input.reason) ?? 0,
        reason: input.reason,
        channel: "voice",
      });
    },

    /** Persist the transcript and the engine that produced it onto the contact. */
    async onTranscript(contactId: string, transcript: string, _engine: "sarvam" | "deepgram"): Promise<void> {
      const record = await getContact(env, contactId);
      if (record === null) return;
      await updateContact(env, { ...plainContact(record), transcript });
    },
  };
}
