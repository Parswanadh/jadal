// @ts-nocheck
// C6 — unit tests for apps/web/src/phone/mock.ts (pure helpers + fixtures).
// Run with: node --test src/phone/
// (Only erasable-TypeScript syntax is used so plain node can run this file.)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALLER_ID,
  MOCK_AGENT_REPLY_EN,
  MOCK_AGENT_REPLY_TE,
  MOCK_VOICE_CONTACT,
  MOCK_WHATSAPP_ALERTS,
  ackLabel,
  ackTone,
  base64ByteLength,
  base64Encode,
  fetchContacts,
  formatTime,
  makeToneWavBase64,
  postPhoneReply,
  toAudioDataUrl,
} from "./mock.ts";

test("caller ID fixture is the Water Committee", () => {
  assert.equal(CALLER_ID, "Jadal \u2013 Water Committee");
  assert.equal(MOCK_VOICE_CONTACT.channel, "voice");
});

test("whatsapp fixtures are night-release alerts", () => {
  assert.equal(MOCK_WHATSAPP_ALERTS.length, 2);
  for (const alert of MOCK_WHATSAPP_ALERTS) {
    assert.equal(alert.channel, "whatsapp");
    assert.ok(alert.message_te.length > 0);
    assert.ok(alert.message_en.length > 0);
  }
});

test("mock agent replies are bilingual", () => {
  assert.ok(MOCK_AGENT_REPLY_TE.length > 0);
  assert.ok(MOCK_AGENT_REPLY_EN.length > 0);
});

test("ackLabel covers every status in both languages", () => {
  const statuses = [
    "queued",
    "sent",
    "delivered",
    "acknowledged",
    "failed",
    "escalated",
  ];
  assert.equal(ackLabel("acknowledged", "en"), "Acknowledged");
  assert.equal(ackLabel("delivered", "en"), "Delivered");
  for (const status of statuses) {
    assert.ok(ackLabel(status, "en").length > 0);
    assert.ok(ackLabel(status, "te").length > 0);
  }
});

test("ackTone maps statuses to badge tones", () => {
  assert.equal(ackTone("acknowledged"), "ok");
  assert.equal(ackTone("failed"), "bad");
  assert.equal(ackTone("escalated"), "bad");
  assert.equal(ackTone("queued"), "wait");
  assert.equal(ackTone("sent"), "wait");
  assert.equal(ackTone("delivered"), "wait");
});

test("toAudioDataUrl builds a playable URL", () => {
  assert.equal(toAudioDataUrl("QUJD"), "data:audio/wav;base64,QUJD");
  assert.equal(
    toAudioDataUrl("QUJD", "audio/mpeg"),
    "data:audio/mpeg;base64,QUJD",
  );
});

test("base64Encode matches known vectors", () => {
  const enc = (s) => base64Encode(new TextEncoder().encode(s));
  assert.equal(enc(""), "");
  assert.equal(enc("M"), "TQ==");
  assert.equal(enc("Ma"), "TWE=");
  assert.equal(enc("Man"), "TWFu");
  assert.equal(base64ByteLength(enc("hello world")), 11);
});

test("base64ByteLength decodes padding correctly", () => {
  assert.equal(base64ByteLength(""), 0);
  assert.equal(base64ByteLength("TQ=="), 1);
  assert.equal(base64ByteLength("TWE="), 2);
  assert.equal(base64ByteLength("TWFu"), 3);
  assert.throws(() => base64ByteLength("ABC"), /invalid base64/);
});

test("formatTime is deterministic UTC", () => {
  assert.equal(formatTime("2026-03-15T16:30:00.000Z", "en"), "16:30 UTC");
  assert.equal(formatTime("2026-03-15T16:30:00.000Z", "te"), "16:30 UTC");
  assert.equal(formatTime("not-a-date", "en"), "unknown");
});

test("makeToneWavBase64 returns a valid tiny WAV", () => {
  const b64 = makeToneWavBase64(440, 0.5, 8000);
  assert.ok(b64.startsWith("UklGR"), "must start with RIFF");
  // 0.5s @ 8kHz mono 16-bit = 4000 samples = 8000 bytes + 44 header.
  assert.equal(base64ByteLength(b64), 44 + 4000 * 2);
});

test("fetchContacts falls back to mocks offline", async () => {
  const { contacts, source } = await fetchContacts();
  assert.equal(source, "mock");
  assert.ok(contacts.length >= 3);
  assert.ok(contacts.some((c) => c.channel === "voice"));
});

test("postPhoneReply falls back to a mock acknowledgement offline", async () => {
  const { result, source } = await postPhoneReply(MOCK_VOICE_CONTACT, {
    text: "సరే",
  });
  assert.equal(source, "mock");
  assert.equal(result.contact.status, "acknowledged");
  assert.ok(result.agent_reply_te.length > 0);
  assert.ok(result.agent_reply_en.length > 0);
  assert.ok((result.audio_base64 ?? "").startsWith("UklGR"));
});
