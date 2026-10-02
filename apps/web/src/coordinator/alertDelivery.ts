// How the coordinator's alert result must be described on screen.
//
// The API accepts three channels but only `call` has a transport. `sms` and
// `whatsapp` are audited for the coordinator's list and returned simulated:
// nothing is sent. That is easy to drift away from: a later server (or a stale
// cached response) could return `simulated: false`, and a UI that keyed the
// wording only off `simulated` would then say the message had been sent.
//
// So the channel decides first. Non-call channels are *never* "sent" or even
// "simulated call"; they are "not sent". Only a `call` can be sent or simulated.
// This is a pure function with no API or i18n dependency, so it is cheap to pin
// with a test.

import type { AlertChannel } from '../api/extra';

/** The three honest states an alert result can be in. */
export type AlertDeliveryState = 'sent' | 'simulated' | 'not-sent';

/** The i18n key family value for each state. Kept next to the state it names. */
export const ALERT_DELIVERY_KEY: Record<AlertDeliveryState, string> = {
  sent: 'coord.alert.sent',
  simulated: 'coord.alert.simulated',
  'not-sent': 'coord.alert.notSent',
};

/**
 * The honest state of one alert result.
 *
 * `call` is the only channel this build can dispatch, so it alone may be
 * `sent` or `simulated`. `sms`/`whatsapp` have no transport at all: whatever
 * `simulated` says, the result is `not-sent`.
 */
export function alertDeliveryState(channel: AlertChannel, simulated: boolean): AlertDeliveryState {
  if (channel !== 'call') return 'not-sent';
  return simulated ? 'simulated' : 'sent';
}
