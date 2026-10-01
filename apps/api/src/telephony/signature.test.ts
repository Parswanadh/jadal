import { describe, expect, it } from "vitest";
import { computeTwilioSignature, twilioSigningString, validateTwilioSignature } from "./signature";

// Twilio's documented validation example (twilio.com/docs/usage/security).
const DOC_URL = "https://mycompany.com/myapp.php?foo=1&bar=2";
const DOC_TOKEN = "12345";
const DOC_PARAMS: [string, string][] = [
  ["CallSid", "CA1234567890ABCDE"],
  ["Caller", "+14158675309"],
  ["Digits", "1234"],
  ["From", "+14158675309"],
  ["To", "+18005551212"],
];
const DOC_SIGNATURE = "RSOYDt4T1cUTdK1PDd93/VVr8B8=";

describe("twilio signature", () => {
  it("matches Twilio's documented example vector", async () => {
    expect(await computeTwilioSignature(DOC_TOKEN, DOC_URL, DOC_PARAMS)).toBe(DOC_SIGNATURE);
    expect(await validateTwilioSignature(DOC_TOKEN, DOC_SIGNATURE, DOC_URL, DOC_PARAMS)).toBe(true);
  });

  it("sorts params by key regardless of input order", async () => {
    const shuffled = [...DOC_PARAMS].reverse();
    expect(twilioSigningString(DOC_URL, shuffled)).toBe(twilioSigningString(DOC_URL, DOC_PARAMS));
    expect(await validateTwilioSignature(DOC_TOKEN, DOC_SIGNATURE, DOC_URL, shuffled)).toBe(true);
  });

  it("rejects tampered params, url, token and missing signature", async () => {
    const tampered = DOC_PARAMS.map(([k, v]): [string, string] => (k === "Digits" ? [k, "9999"] : [k, v]));
    expect(await validateTwilioSignature(DOC_TOKEN, DOC_SIGNATURE, DOC_URL, tampered)).toBe(false);
    expect(await validateTwilioSignature(DOC_TOKEN, DOC_SIGNATURE, DOC_URL + "&x=1", DOC_PARAMS)).toBe(false);
    expect(await validateTwilioSignature("wrong", DOC_SIGNATURE, DOC_URL, DOC_PARAMS)).toBe(false);
    expect(await validateTwilioSignature(DOC_TOKEN, "", DOC_URL, DOC_PARAMS)).toBe(false);
    expect(await validateTwilioSignature(DOC_TOKEN, null, DOC_URL, DOC_PARAMS)).toBe(false);
  });
});
