import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import te from '../i18n/te.json';
import { ALERT_DELIVERY_KEY, alertDeliveryState } from './alertDelivery';

/** Resolve a dotted i18n path in one dictionary. */
function lookup(dict: unknown, path: string): string {
  let node: unknown = dict;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return '';
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : '';
}

describe('coordinator alert delivery state', () => {
  it('never labels an sms or whatsapp alert as sent, whatever the API says', () => {
    for (const channel of ['sms', 'whatsapp'] as const) {
      // The API's own `simulated` flag is true today; the UI must not depend on
      // that. A stale or future response with simulated:false still means the
      // messaging channels sent nothing, because no transport exists.
      expect(alertDeliveryState(channel, true)).toBe('not-sent');
      expect(alertDeliveryState(channel, false)).toBe('not-sent');
      expect(ALERT_DELIVERY_KEY[alertDeliveryState(channel, false)]).toBe('coord.alert.notSent');
    }
  });

  it('still tells a real call from a simulated one', () => {
    expect(alertDeliveryState('call', false)).toBe('sent');
    expect(ALERT_DELIVERY_KEY.sent).toBe('coord.alert.sent');
    expect(alertDeliveryState('call', true)).toBe('simulated');
    expect(ALERT_DELIVERY_KEY.simulated).toBe('coord.alert.simulated');
  });

  it('points the not-sent state at a label that exists in both languages', () => {
    const key = ALERT_DELIVERY_KEY['not-sent'];
    expect(key).toBe('coord.alert.notSent');

    const english = lookup(en, key);
    const telugu = lookup(te, key);
    expect(english).toContain('Not sent');
    expect(english.toLowerCase()).toContain('nothing was sent');
    // Telugu label is present and actually Telugu (parity is checked wholesale
    // in i18n.test.ts; this pins the one string the alert result depends on).
    expect(telugu.length).toBeGreaterThan(0);
    expect(telugu).toMatch(/[\u0C00-\u0C7F]/);
  });
});
