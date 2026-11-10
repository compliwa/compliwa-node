/**
 * The SDK against a real Compliwa API — your local one, with a TEST key (sandbox data, never charged).
 *
 *   set COMPLIWA_API_KEY=cw_test_…                 (Windows Command Prompt; export … on macOS/Linux)
 *   set COMPLIWA_BASE_URL=http://localhost:5010    (the default)
 *   npm run test:e2e
 *
 * Refuses a live key: these calls create verifications and screenings.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Compliwa, { InvalidRequestError, NotFoundError, AuthenticationError } from '../src/index.js';

const KEY = process.env.COMPLIWA_API_KEY;
const BASE_URL = process.env.COMPLIWA_BASE_URL ?? 'http://localhost:5010';

if (!KEY?.startsWith('cw_test_')) {
  console.error(
    'Set COMPLIWA_API_KEY to a cw_test_ key (dashboard → API keys → Create key, environment Test).',
  );
  process.exit(1);
}

const compliwa = new Compliwa(KEY, { baseUrl: BASE_URL, appInfo: { name: 'compliwa-node-e2e' } });
let sandbox;

before(async () => {
  sandbox = await compliwa.request('GET', '/v1/sandbox');
});

test('the key: test environment, its scopes', async () => {
  const key = await compliwa.apiKey.retrieve();
  assert.equal(key.environment, 'test');
  assert.equal(key.lastResponse.status, 200);
  assert.equal(key.lastResponse.environment, 'test');
  assert.match(key.lastResponse.requestId ?? '', /\S/);
  assert.equal(
    key.lastResponse.apiVersion,
    Compliwa.API_VERSION,
    'the SDK was generated from this API version',
  );
});

test('a verification: create, replay with the same Idempotency-Key, read back, find in the list', async () => {
  const nin = sandbox.identity.checks.find((c) => c.check === 'NG:NIN');
  const found = nin.entries.find((e) => e.effect === 'found_example');
  const reference = `sdk-e2e-${randomUUID().slice(0, 8)}`;
  const idempotencyKey = randomUUID();
  const params = {
    check: 'NG:NIN',
    id_number: found.id_number,
    ...sandbox.identity.example_person,
    reference,
    consent: true,
  };
  delete params.middle_name;

  const created = await compliwa.verifications.create(params, { idempotencyKey });
  assert.match(created.id, /^ver_/);
  assert.equal(created.lastResponse.status, 201);

  const replay = await compliwa.verifications.create(params, { idempotencyKey });
  assert.equal(replay.id, created.id);
  assert.equal(replay.lastResponse.idempotentReplayed, true);

  const read = await compliwa.verifications.retrieve(created.id);
  assert.equal(read.id, created.id);

  const ids = [];
  for await (const verification of compliwa.verifications.list({ reference, limit: 1 }))
    ids.push(verification.id);
  assert.deepEqual(ids, [created.id]);
});

test('every page of a list, one at a time', async () => {
  const first = await compliwa.verifications.list({ limit: 1 });
  const all = await compliwa.verifications.list({ limit: 1 }).toArray({ max: 100_000 });
  assert.ok(all.length >= first.data.length);
  if (first.has_more) assert.ok(all.length > 1);
});

test('a screening, and the lists it uses', async () => {
  const lists = await compliwa.screenings.lists.list();
  assert.ok(Array.isArray(lists.data ?? lists.lists));
  const screening = await compliwa.screenings.create({
    type: 'person',
    name: 'Ada Okafor',
    reference: `sdk-e2e-${randomUUID().slice(0, 8)}`,
  });
  assert.match(screening.id, /^scr_/);
  assert.equal((await compliwa.screenings.retrieve(screening.id)).id, screening.id);
});

test('errors: a field, an unknown id, a bad key', async () => {
  const invalid = await compliwa.verifications.create({ check: 'NG:NIN' }).catch((e) => e);
  assert.ok(invalid instanceof InvalidRequestError, invalid);
  assert.equal(invalid.status, 400);
  assert.ok(invalid.errors.length > 0);
  assert.ok(invalid.requestId);

  const missing = await compliwa.verifications
    .retrieve('ver_00000000000000000000000000000000')
    .catch((e) => e);
  assert.ok(missing instanceof NotFoundError, missing);

  const stranger = new Compliwa(`cw_test_${'x'.repeat(40)}`, { baseUrl: BASE_URL });
  const unauthorized = await stranger.apiKey.retrieve().catch((e) => e);
  assert.ok(unauthorized instanceof AuthenticationError, unauthorized);
  assert.equal(unauthorized.code, 'api_key_invalid');
});

test('errors in your language', async () => {
  const french = new Compliwa(KEY, { baseUrl: BASE_URL, language: 'fr' });
  const invalid = await french.verifications.create({}).catch((e) => e);
  assert.ok(invalid instanceof InvalidRequestError);
  assert.notEqual(invalid.title, null);
});
