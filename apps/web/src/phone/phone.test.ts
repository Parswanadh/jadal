import { describe, expect, it } from "vitest";
import { fetchContacts, postPhoneReply } from "./api";
import {
  CALLER_ID,
  ackLabel,
  ackTone,
  base64ByteLength,
  base64Encode,
  formatTime,
  makeToneWavBase64,
  toAudioDataUrl,
} from "./helpers";
import type { ContactStatus } from "./helpers";

const STATUSES: ContactStatus[] = ["queued", "sent", "delivered", "acknowledged", "failed", "escalated"];

describe("phone helpers", () => {
  it("caller ID is the Water Committee", () => {
    expect(CALLER_ID).toBe("Jadal Water Committee");
  });

  it("ackLabel covers every status in both languages", () => {
    expect(ackLabel("acknowledged", "en")).toBe("Confirmed");
    for (const s of STATUSES) {
      expect(ackLabel(s, "en").length).toBeGreaterThan(0);
      expect(ackLabel(s, "te").length).toBeGreaterThan(0);
    }
  });

  it("ackTone maps statuses to badge tones", () => {
    expect(ackTone("acknowledged")).toBe("ok");
    expect(ackTone("failed")).toBe("bad");
    expect(ackTone("escalated")).toBe("bad");
    expect(ackTone("queued")).toBe("wait");
    expect(ackTone("delivered")).toBe("wait");
  });

  it("toAudioDataUrl builds a playable URL", () => {
    expect(toAudioDataUrl("QUJD")).toBe("data:audio/wav;base64,QUJD");
    expect(toAudioDataUrl("QUJD", "audio/mpeg")).toBe("data:audio/mpeg;base64,QUJD");
  });

  it("base64Encode matches known vectors", () => {
    const enc = (s: string) => base64Encode(new TextEncoder().encode(s));
    expect(enc("")).toBe("");
    expect(enc("M")).toBe("TQ==");
    expect(enc("Ma")).toBe("TWE=");
    expect(enc("Man")).toBe("TWFu");
    expect(base64ByteLength(enc("hello world"))).toBe(11);
  });

  it("base64ByteLength decodes padding and rejects bad length", () => {
    expect(base64ByteLength("")).toBe(0);
    expect(base64ByteLength("TQ==")).toBe(1);
    expect(base64ByteLength("TWE=")).toBe(2);
    expect(() => base64ByteLength("ABC")).toThrow(/invalid base64/);
  });

  it("formatTime reads as a human date and time in India time", () => {
    expect(formatTime("2026-03-15T16:30:00.000Z", "en")).toBe("Sun 15 Mar, 10:00 pm");
    expect(formatTime("2026-03-15T16:30:00.000Z", "te")).toBe("ఆది 15 మార్చి, రాత్రి 10:00");
    expect(formatTime("not-a-date", "en")).toBe("unknown");
  });

  it("makeToneWavBase64 returns a valid tiny WAV", () => {
    const b64 = makeToneWavBase64(440, 0.5, 8000);
    expect(b64.startsWith("UklGR")).toBe(true);
    expect(base64ByteLength(b64)).toBe(44 + 4000 * 2);
  });
});

describe("phone api adapter (mock mode)", () => {
  it("lists contacts incl. a voice contact and WhatsApp alerts", async () => {
    const { contacts, source } = await fetchContacts();
    expect(source).toBe("mock");
    expect(contacts.some((c) => c.channel === "voice")).toBe(true);
    expect(contacts.some((c) => c.channel === "whatsapp")).toBe(true);
  });

  it("acknowledges a reply and attaches simulated audio offline", async () => {
    const { contacts } = await fetchContacts();
    const first = contacts[0];
    if (!first) throw new Error("no contacts");
    const { result, source } = await postPhoneReply(first, { text: "సరే" });
    expect(source).toBe("mock");
    expect(result.contact.status).toBe("acknowledged");
    expect(result.agent_reply_te.length).toBeGreaterThan(0);
    expect(result.agent_reply_en.length).toBeGreaterThan(0);
    expect((result.audio_base64 ?? "").startsWith("UklGR")).toBe(true);
  });
});
