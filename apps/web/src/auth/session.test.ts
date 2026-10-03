import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_COORDINATOR_PASSWORD,
  DEFAULT_FARMER_PASSWORD,
  SESSION_KEY,
  configuredPassword,
  parseSession,
  passwordMatches,
  serializeSession,
} from "./session";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session persistence", () => {
  it("uses exactly one storage key", () => {
    expect(SESSION_KEY).toBe("jadal.session");
  });

  it("parses only a real session", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession("not json")).toBeNull();
    expect(parseSession("null")).toBeNull();
    expect(parseSession(JSON.stringify({ role: "admin", signedInAt: "2026-09-15T00:00:00Z" }))).toBeNull();
    expect(parseSession(JSON.stringify({ role: "farmer" }))).toBeNull();
    expect(parseSession(JSON.stringify({ role: "farmer", signedInAt: "" }))).toBeNull();
  });

  it("round-trips a session", () => {
    const session = { role: "coordinator" as const, signedInAt: "2026-09-15T00:00:00.000Z" };
    expect(parseSession(serializeSession(session))).toEqual(session);
  });
});

describe("role passwords", () => {
  it("falls back to the documented non-secret defaults", () => {
    expect(configuredPassword("farmer")).toBe(DEFAULT_FARMER_PASSWORD);
    expect(configuredPassword("coordinator")).toBe(DEFAULT_COORDINATOR_PASSWORD);
  });

  it("accepts only the matching role's password", () => {
    expect(passwordMatches("farmer", DEFAULT_FARMER_PASSWORD)).toBe(true);
    expect(passwordMatches("farmer", DEFAULT_COORDINATOR_PASSWORD)).toBe(false);
    expect(passwordMatches("coordinator", DEFAULT_COORDINATOR_PASSWORD)).toBe(true);
    expect(passwordMatches("coordinator", DEFAULT_FARMER_PASSWORD)).toBe(false);
    expect(passwordMatches("farmer", "")).toBe(false);
  });

  it("honours env overrides", () => {
    vi.stubEnv("VITE_FARMER_PASSWORD", "picked-by-the-operator");
    vi.stubEnv("VITE_COORDINATOR_PASSWORD", "another-operator-value");
    expect(passwordMatches("farmer", "picked-by-the-operator")).toBe(true);
    expect(passwordMatches("farmer", DEFAULT_FARMER_PASSWORD)).toBe(false);
    expect(passwordMatches("coordinator", "another-operator-value")).toBe(true);
  });

  it("treats an empty env value as unset", () => {
    vi.stubEnv("VITE_FARMER_PASSWORD", "");
    expect(configuredPassword("farmer")).toBe(DEFAULT_FARMER_PASSWORD);
  });
});
