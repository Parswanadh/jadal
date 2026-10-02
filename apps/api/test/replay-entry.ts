/**
 * Replay-only Worker entry: the real Jadal app, with the two *external* providers stubbed.
 *
 * Why this exists
 * ---------------
 * Proving the inbound path end to end without buying a Twilio number means driving the real routes
 * (`/api/telephony/inbound*`) over a real socket with real signature validation, while the two calls
 * that would leave the machine — downloading a Twilio recording and calling Deepgram/Sarvam STT —
 * are served locally. `wrangler dev` cannot reach a local stub for `api.twilio.com` because the
 * recording host is allow-listed to `*.twilio.com` in `src/telephony/webhook.ts` (a security property
 * this file does not weaken), and `/etc/hosts` is not writable here.
 *
 * So the stub is injected at the same seam the test suite uses: `env.fetch`. Nothing else is faked.
 * The app, the D1 database, the signature check, `resolveCaller`, System-1 classification and
 * `raiseRequest` are all the production code paths.
 *
 * NOT for deployment — `wrangler.jsonc` still points `main` at `src/index.ts`.
 */

import { createApp } from "../src/app";
import type { Env } from "../src/env";

/** `wrangler.jsonc` binds these Workflows, so the entrypoint must export them (as `src/index.ts` does). */
export { CallCampaignWorkflow, UrgentRequestWorkflow } from "../src/campaigns/workflows";

/** A minimal silent WAV so the download is a real audio payload, not an empty buffer. */
const WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
  0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00,
  0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
]);

/** One Deepgram-shaped response carrying `transcript`; the engine order tries Deepgram first inbound. */
function deepgramBody(transcript: string): string {
  return JSON.stringify({
    results: { channels: [{ alternatives: [{ transcript }] }] },
  });
}

const app = createApp();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // The transcript this replay "hears". Telugu, and a phrase System-1's rules classify as urgent.
    // Overridable per run with `--var REPLAY_TRANSCRIPT:<text>` (read defensively: it is not part of `Env`).
    const transcript =
      (env as Env & { REPLAY_TRANSCRIPT?: string }).REPLAY_TRANSCRIPT ?? "నాకు అత్యవసరంగా నీళ్లు కావాలి";

    const stubbedFetch: typeof fetch = async (input, _init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      // The Twilio recording download — a real WAV, served locally.
      if (url.includes("twilio.com")) {
        return new Response(WAV, { status: 200, headers: { "Content-Type": "audio/wav" } });
      }
      // Deepgram nova-3 (first engine on the inbound path).
      if (url.includes("deepgram.com")) {
        return new Response(deepgramBody(transcript), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Sarvam STT/TTS: refused, so the replay exercises the *fallback* — Deepgram still wins the
      // transcript, and `<Say>` is used for speech (no Sarvam key). Recorded honestly in speech paths.
      if (url.includes("sarvam.ai")) {
        return new Response("stubbed: sarvam unavailable", { status: 503 });
      }
      return new Response("replay stub: no upstream allowed", { status: 502 });
    };

    return app.fetch(request, { ...env, fetch: stubbedFetch } as unknown as Env);
  },
};
