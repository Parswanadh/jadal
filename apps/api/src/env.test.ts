/**
 * Tests for the canonical Worker environment helpers (worker-entry).
 *
 * These cover the pure flag logic that decides whether the deployment runs the offline demo path
 * and whether real PSTN calling is allowed. Both must stay key-free: every credential is optional
 * (B-SPEC §4), so the safe path is always the default.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { routes } from "@jadal/contracts";

import { call, createEnv, type TestEnv } from "../test/harness";
import { createApp } from "./app";
import { isDemo, isRealTelephony, layaEndpoint } from "./env";

describe("layaEndpoint", () => {
  it("returns undefined when unset or blank, so Laya is skipped rather than attempted", () => {
    expect(layaEndpoint({})).toBeUndefined();
    expect(layaEndpoint({ LAYA_ENDPOINT: "" })).toBeUndefined();
    expect(layaEndpoint({ LAYA_ENDPOINT: "   " })).toBeUndefined();
  });

  it("accepts the documented sidecar URL verbatim", () => {
    expect(layaEndpoint({ LAYA_ENDPOINT: "http://127.0.0.1:8099/decide" })).toBe("http://127.0.0.1:8099/decide");
    expect(layaEndpoint({ LAYA_ENDPOINT: "  http://127.0.0.1:8099/decide  " })).toBe("http://127.0.0.1:8099/decide");
    expect(layaEndpoint({ LAYA_ENDPOINT: "https://laya.internal/decide" })).toBe("https://laya.internal/decide");
  });

  it("trims a trailing slash so one URL cannot produce two request paths", () => {
    expect(layaEndpoint({ LAYA_ENDPOINT: "http://127.0.0.1:8099/decide/" })).toBe("http://127.0.0.1:8099/decide");
    expect(layaEndpoint({ LAYA_ENDPOINT: "http://127.0.0.1:8099/" })).toBe("http://127.0.0.1:8099");
  });

  it("rejects a non-http(s) or unparseable value instead of fetching it", () => {
    expect(layaEndpoint({ LAYA_ENDPOINT: "127.0.0.1:8099/decide" })).toBeUndefined();
    expect(layaEndpoint({ LAYA_ENDPOINT: "ftp://127.0.0.1/decide" })).toBeUndefined();
    expect(layaEndpoint({ LAYA_ENDPOINT: "file:///etc/passwd" })).toBeUndefined();
  });
});

describe("isDemo", () => {
  it("defaults to demo mode when DEMO_MODE is unset", () => {
    expect(isDemo({})).toBe(true);
  });

  it("accepts every truthy spelling", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on", " true "]) {
      expect(isDemo({ DEMO_MODE: value })).toBe(true);
    }
  });

  it("opts out for every falsy spelling", () => {
    for (const value of ["0", "false", "FALSE", "no", "off", ""]) {
      expect(isDemo({ DEMO_MODE: value })).toBe(false);
    }
  });

  it("falls back to demo for an unrecognised value", () => {
    expect(isDemo({ DEMO_MODE: "maybe" })).toBe(true);
  });
});

describe("isRealTelephony", () => {
  const credentials = {
    TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
    TWILIO_AUTH_TOKEN: "test-token",
    TWILIO_FROM_NUMBER: "+10000000000",
    PUBLIC_BASE_URL: "https://jadal.example.dev",
  };

  it("is off with no configuration", () => {
    expect(isRealTelephony({})).toBe(false);
  });

  it("is off unless REAL_TELEPHONY is explicitly enabled", () => {
    expect(isRealTelephony({ ...credentials })).toBe(false);
    expect(isRealTelephony({ ...credentials, REAL_TELEPHONY: "0" })).toBe(false);
    expect(isRealTelephony({ ...credentials, REAL_TELEPHONY: "false" })).toBe(false);
  });

  it("is off when any Twilio credential is missing or blank", () => {
    expect(isRealTelephony({ REAL_TELEPHONY: "true", TWILIO_ACCOUNT_SID: "AC1" })).toBe(false);
    expect(
      isRealTelephony({ REAL_TELEPHONY: "true", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok" }),
    ).toBe(false);
    expect(
      isRealTelephony({ REAL_TELEPHONY: "true", TWILIO_ACCOUNT_SID: "AC1", TWILIO_FROM_NUMBER: "+10000000000" }),
    ).toBe(false);
    expect(
      isRealTelephony({ ...credentials, REAL_TELEPHONY: "true", TWILIO_ACCOUNT_SID: "  " }),
    ).toBe(false);
  });

  it("is off without a public base URL, because Twilio could not fetch the TwiML", () => {
    const { PUBLIC_BASE_URL: _omitted, ...withoutBase } = credentials;
    expect(isRealTelephony({ ...withoutBase, REAL_TELEPHONY: "true" })).toBe(false);
    expect(isRealTelephony({ ...credentials, REAL_TELEPHONY: "true", PUBLIC_BASE_URL: "  " })).toBe(false);
  });

  it("is on only with the flag and the full credential set", () => {
    expect(isRealTelephony({ ...credentials, REAL_TELEPHONY: "true" })).toBe(true);
    expect(isRealTelephony({ ...credentials, REAL_TELEPHONY: "1" })).toBe(true);
  });
});

describe("createApp wiring", () => {
  it("mounts the contract's /api/health route", async () => {
    const app = createApp() as unknown as Hono<{ Bindings: TestEnv }>;
    const result = await call(app, "GET", "/api/health", { env: createEnv() });
    expect(result.status).toBe(200);
    expect(routes.health.response.parse(result.body)).toBeTruthy();
  });
});
