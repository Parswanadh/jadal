import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Live local integration suite (B9).
 *
 * These tests talk to the **real** Worker: `wrangler dev --local` running the actual Hono app on
 * workerd against a real local D1 database. Nothing here is mocked, which is the point — the whole
 * suite exists because the offline Vitest shim hid three integration bugs that only a real boot
 * exposes (a `wrangler.jsonc` compatibility date newer than the bundled workerd, non-handler values
 * exported from the Worker entry module, and `D1PreparedStatement.all()` returning a `{ results }`
 * envelope rather than a bare array).
 *
 * Safety. The live env sets `REAL_TELEPHONY=false` and holds no Twilio credentials, so `placeCall`
 * takes its `{ simulated: true }` branch and no outbound call is ever attempted. The telephony
 * webhooks driven below are *inbound*: they make the Worker respond, they never dial. The suite
 * asserts that property directly (see "never marks a contact sent or failed").
 *
 * Serial: every test shares one live database, and the first one resets it.
 */

test.describe.configure({ mode: 'serial' });

const CANAL_ID = 'c1';

/** POST JSON and return the parsed body plus status, so a failure shows the real payload. */
async function postJson(request: APIRequestContext, path: string, data: unknown) {
  const res = await request.post(path, { data });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status(), body };
}

test('the live Worker boots and answers /api/health', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, version: '0.1.0' });
});

test('POST /api/demo/reset seeds the scenario through the real D1', async ({ request }) => {
  const reset = await postJson(request, '/api/demo/reset', {});
  expect(reset.status).toBe(200);
  expect(reset.body).toEqual({ ok: true });

  const farmers = await (await request.get('/api/farmers')).json();
  expect(farmers).toHaveLength(8);
  expect(farmers[0].farmer.phone).toMatch(/^\+91/);

  const canal = await (await request.get('/api/canal')).json();
  expect(canal.canal.id).toBe(CANAL_ID);
  expect(canal.outlets.length).toBeGreaterThan(0);
});

test('every read route returns real rows, not an error envelope', async ({ request }) => {
  // The D1 `all()` regression 500'd all of these; asserting the shape (not just the status) is what
  // makes this test worth its runtime.
  const paths: Array<[string, (body: any) => void]> = [
    ['/api/canal', (b) => expect(b.canal.id).toBe(CANAL_ID)],
    ['/api/farmers', (b) => expect(b.length).toBe(8)],
    ['/api/release-windows', (b) => expect(Array.isArray(b)).toBe(true)],
    ['/api/requests', (b) => expect(Array.isArray(b)).toBe(true)],
    ['/api/ledger', (b) => expect(b.balances.conservation_ok).toBe(true)],
    ['/api/events', (b) => expect(b.length).toBeGreaterThan(0)],
    ['/api/contacts', (b) => expect(Array.isArray(b)).toBe(true)],
    ['/api/audit', (b) => expect(b.balances.canal_supply_m3).toBeGreaterThan(0)],
  ];

  for (const [path, assert] of paths) {
    const res = await request.get(path);
    expect(res.status(), `${path} should be 200`).toBe(200);
    assert(await res.json());
  }
});

test('the telephony module is mounted, with its signature guard closed', async ({ request }) => {
  // No telephony route matched: re-rendered as the app's ApiError shape by the mount in app.ts.
  const unknown = await request.get('/api/telephony/nope');
  expect(unknown.status()).toBe(404);
  expect(await unknown.json()).toMatchObject({ error: { code: 'not_found' } });

  // A real telephony route, reached: unknown contact => the module's own TwiML 404.
  const missing = await request.get('/api/telephony/twiml/ct-does-not-exist');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('xml');
});

test('a full outbound-campaign rung reaches the mounted telephony webhooks', async ({ request }) => {
  // 1. Approve entitlements and a roster, which queues a contact per farmer through the real store.
  const suggested = await postJson(request, '/api/entitlements/suggest', {});
  expect(suggested.status).toBe(200);

  const approved = await postJson(request, '/api/entitlements/approve', { edits: [] });
  expect(approved.status).toBe(200);
  expect((approved.body as { approved: number }).approved).toBeGreaterThan(0);

  const windows = await (await request.get('/api/release-windows')).json();
  const windowId = windows[0].id;

  const proposed = await postJson(request, '/api/rosters/propose', {
    release_window_id: windowId,
    mode: 'equal_water',
  });
  expect(proposed.status).toBe(200);
  const rosterId = (proposed.body as { roster: { id: string } }).roster.id;

  const rosterApproved = await postJson(request, `/api/rosters/${rosterId}/approve`, {});
  expect(rosterApproved.status).toBe(200);
  expect((rosterApproved.body as { contacts_queued: number }).contacts_queued).toBeGreaterThan(0);

  // 2. Pick the first voice contact and walk the TwiML -> DTMF acknowledgement loop against real D1.
  const contacts = await (await request.get('/api/contacts')).json();
  const voice = contacts.find((contact: { channel: string }) => contact.channel === 'voice');
  expect(voice, 'the roster approval should have queued at least one voice contact').toBeTruthy();

  const twiml = await request.get(`/api/telephony/twiml/${voice.id}`);
  expect(twiml.status()).toBe(200);
  const body = await twiml.text();
  expect(body).toContain('<Gather input="dtmf"');
  // No Sarvam key locally, so the module falls back to Twilio's own Telugu `<Say>`.
  expect(body).toContain('<Say language="te-IN">');
  expect(body).toContain(voice.message_te);

  const gathered = await request.post(`/api/telephony/gather/${voice.id}`, {
    form: { Digits: '1' },
  });
  expect(gathered.status()).toBe(200);

  const after = await (await request.get('/api/contacts')).json();
  const acked = after.find((contact: { id: string }) => contact.id === voice.id);
  expect(acked.status).toBe('acknowledged');
});

test('no contact was marked sent or failed: real calls stayed simulated', async ({ request }) => {
  // `placeCall` marks a contact `sent` only after Twilio accepts the call and `failed` when it
  // rejects one. With no Twilio credentials in the live env, the ladder must take its
  // `{ simulated: true }` branch and leave every contact `queued` (or acknowledged by the test
  // above). This is the safety assertion: if it ever fails, something is dialling.
  const contacts = await (await request.get('/api/contacts')).json();
  expect(contacts.length).toBeGreaterThan(0);
  const statuses = new Set(contacts.map((contact: { status: string }) => contact.status));
  expect([...statuses].every((status) => ['queued', 'acknowledged', 'escalated'].includes(status))).toBe(true);
  expect(statuses.has('sent')).toBe(false);
  expect(statuses.has('failed')).toBe(false);
});
