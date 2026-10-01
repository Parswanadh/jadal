/** Twilio request validation (X-Twilio-Signature): base64(HMAC-SHA1(authToken, url + sorted(key+value)...)). */

const enc = new TextEncoder();

export function twilioSigningString(url: string, params: Iterable<[string, string]>): string {
  const sorted = [...params].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  );
  return url + sorted.map(([k, v]) => k + v).join("");
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Iterable<[string, string]>,
): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(twilioSigningString(url, params)));
  return toBase64(mac);
}

function safeEqual(a: string, b: string): boolean {
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export async function validateTwilioSignature(
  authToken: string,
  signature: string | null | undefined,
  url: string,
  params: Iterable<[string, string]>,
): Promise<boolean> {
  if (!signature || !authToken) return false;
  return safeEqual(await computeTwilioSignature(authToken, url, params), signature);
}
