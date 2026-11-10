/**
 * compliwa-node — src/webhooks.js
 *
 * Check that a webhook came from Compliwa, unchanged and recent, and read its event:
 *
 *   app.post('/webhooks/compliwa', express.raw({ type: 'application/json' }), (req, res) => {
 *     let event;
 *     try {
 *       event = verifyWebhook(req.body, req.get('Compliwa-Signature'), process.env.COMPLIWA_WEBHOOK_SECRET);
 *     } catch {
 *       return res.status(400).end();
 *     }
 *     // Deliveries can repeat: skip an event.id you have already handled.
 *     …
 *     res.status(204).end();
 *   });
 *
 * The header (step 12.3): Compliwa-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>]
 *   v1 = HMAC-SHA256("<t>.<raw body>") keyed with the whole "whsec_…" secret. While a rolled
 *   secret overlaps there are two v1 values: either may match. A t further than
 *   `toleranceSeconds` (5 minutes) from now is refused, so a captured request cannot be replayed.
 *
 * The body must be the exact bytes received (a Buffer or the string as sent) — JSON that was parsed
 * and stringified again no longer matches.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookSignatureError } from './errors.js';

export const SIGNATURE_HEADER = 'Compliwa-Signature';
export const DEFAULT_TOLERANCE_SECONDS = 300;

const fail = (code, message) => new WebhookSignatureError(message, { code });

function rawText(payload) {
  if (typeof payload === 'string') return payload;
  if (payload instanceof Uint8Array)
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString('utf8');
  if (payload instanceof ArrayBuffer) return Buffer.from(payload).toString('utf8');
  throw fail(
    'webhook_body_not_raw',
    'Pass the raw body (a Buffer or string) — e.g. express.raw({ type: "application/json" }). A parsed object cannot be checked.',
  );
}

/**
 * @param {string | Buffer | Uint8Array | ArrayBuffer} payload  the raw body
 * @param {string | string[] | null | undefined} header        the Compliwa-Signature header
 * @param {string} secret                                       the endpoint's whsec_… secret
 * @param {{ toleranceSeconds?: number, now?: number }} [options]  now: Unix seconds (tests)
 * @returns {object} the event
 * @throws {WebhookSignatureError}
 */
export function verifyWebhook(
  payload,
  header,
  secret,
  { toleranceSeconds = DEFAULT_TOLERANCE_SECONDS, now } = {},
) {
  if (typeof secret !== 'string' || !secret.startsWith('whsec_')) {
    throw fail(
      'webhook_secret_invalid',
      'The webhook secret should start with whsec_ (the endpoint’s signing secret, not an API key).',
    );
  }
  const value = Array.isArray(header) ? header.join(',') : header;
  if (!value) throw fail('webhook_signature_missing', `No ${SIGNATURE_HEADER} header.`);

  const pairs = String(value)
    .split(',')
    .map((part) => {
      const at = part.indexOf('=');
      return at === -1 ? [part.trim(), ''] : [part.slice(0, at).trim(), part.slice(at + 1).trim()];
    });
  const timestamp = Number(pairs.find(([k]) => k === 't')?.[1]);
  const signatures = pairs.filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/.test(v)).map(([, v]) => v);
  if (!Number.isInteger(timestamp) || signatures.length === 0) {
    throw fail('webhook_signature_malformed', `The ${SIGNATURE_HEADER} header is not t=…,v1=….`);
  }

  const current = now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(current - timestamp) > toleranceSeconds) {
    throw fail(
      'webhook_signature_expired',
      `The signature is ${Math.abs(current - timestamp)} s from now — more than ${toleranceSeconds} s. Check the server clock, or this is a replay.`,
    );
  }

  const body = rawText(payload);
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  const matches = signatures.some((hex) => timingSafeEqual(Buffer.from(hex, 'hex'), expected));
  if (!matches) {
    throw fail(
      'webhook_signature_mismatch',
      'No signature matches: check the secret (this endpoint’s, this environment’s) and that the body is the raw bytes received.',
    );
  }

  try {
    return JSON.parse(body);
  } catch {
    throw fail('webhook_body_invalid', 'The body is signed but is not JSON.');
  }
}

/**
 * Sign a payload as Compliwa does — for your own tests of a webhook handler.
 * @returns {string} the Compliwa-Signature header value
 */
export function signWebhook(payload, secret, { timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}
