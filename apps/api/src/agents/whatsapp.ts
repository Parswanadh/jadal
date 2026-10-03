/**
 * Meta WhatsApp Cloud API client.
 *
 * Sends a text message through the Meta Graph API when credentials are configured.
 * Falls back to event-log-only behavior when they are not.
 */

import type { ProviderFetch } from "../system1";

export interface WhatsAppResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export async function sendWhatsAppMessage(
  fetch: ProviderFetch,
  token: string,
  phoneNumberId: string,
  to: string,
  message: string,
): Promise<WhatsAppResult> {
  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`;
  const body = JSON.stringify({
    messaging_product: "whatsapp",
    to,
    text: { body: message },
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const data = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };
  if (!res.ok || data.error) {
    return { ok: false, error: data.error?.message ?? `meta whatsapp ${res.status}` };
  }
  return { ok: true, messageId: data.messages?.[0]?.id };
}
