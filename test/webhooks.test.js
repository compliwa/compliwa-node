import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhook, signWebhook, WebhookSignatureError } from '../src/index.js';

const SECRET = 'whsec_3q2-7wEXAMPLEu8Rp1yZ0nQK5Yc2vJmT4sHb9dLfGxA';
const OLD_SECRET = 'whsec_previousEXAMPLE0000000000000000000000000';
const NOW = 1_762_628_400;
const event = {
  id: 'wev_1',
  object: 'event',
  type: 'verification.completed',
  api_version: '0.3.0',
  created_at: '2025-11-08T19:00:00Z',
  environment: 'test',
  data: { object: { object: 'verification', id: 'ver_1' } },
};
const body = JSON.stringify(event);
// Exactly what the API's signer (compliwaAPI src/modules/webhooks/webhooks.sign.js) computes.
const sign = (secret, t, raw = body) => createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');

test('a genuine webhook: the event comes back', () => {
  const header = `t=${NOW},v1=${sign(SECRET, NOW)}`;
  assert.deepEqual(verifyWebhook(body, header, SECRET, { now: NOW }), event);
  assert.deepEqual(verifyWebhook(Buffer.from(body), header, SECRET, { now: NOW + 299 }), event);
});

test('while a rolled secret overlaps, either v1 may match', () => {
  const header = `t=${NOW},v1=${sign(SECRET, NOW)},v1=${sign(OLD_SECRET, NOW)}`;
  assert.equal(verifyWebhook(body, header, OLD_SECRET, { now: NOW }).id, 'wev_1');
  assert.equal(verifyWebhook(body, header, SECRET, { now: NOW }).id, 'wev_1');
});

test('refused: changed, wrong secret, too old, malformed, parsed body', () => {
  const header = `t=${NOW},v1=${sign(SECRET, NOW)}`;
  const refused = (fn, code) =>
    assert.throws(fn, (e) => e instanceof WebhookSignatureError && e.code === code, code);

  refused(
    () => verifyWebhook(body.replace('ver_1', 'ver_2'), header, SECRET, { now: NOW }),
    'webhook_signature_mismatch',
  );
  refused(() => verifyWebhook(body, header, OLD_SECRET, { now: NOW }), 'webhook_signature_mismatch');
  refused(() => verifyWebhook(body, header, SECRET, { now: NOW + 301 }), 'webhook_signature_expired');
  refused(() => verifyWebhook(body, header, SECRET, { now: NOW - 301 }), 'webhook_signature_expired');
  refused(
    () => verifyWebhook(body, `v1=${sign(SECRET, NOW)}`, SECRET, { now: NOW }),
    'webhook_signature_malformed',
  );
  refused(() => verifyWebhook(body, `t=${NOW},v1=xyz`, SECRET, { now: NOW }), 'webhook_signature_malformed');
  refused(() => verifyWebhook(body, undefined, SECRET, { now: NOW }), 'webhook_signature_missing');
  refused(() => verifyWebhook(event, header, SECRET, { now: NOW }), 'webhook_body_not_raw');
  refused(
    () => verifyWebhook(body, header, `cw_test_${'a'.repeat(40)}`, { now: NOW }),
    'webhook_secret_invalid',
  );
});

test('signWebhook signs as Compliwa does, for testing your handler', () => {
  const header = signWebhook(body, SECRET, { timestamp: NOW });
  assert.equal(header, `t=${NOW},v1=${sign(SECRET, NOW)}`);
  assert.equal(verifyWebhook(body, header, SECRET, { now: NOW }).type, 'verification.completed');
  assert.equal(verifyWebhook(body, signWebhook(event, SECRET), SECRET).id, 'wev_1');
});
