import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import Compliwa, {
  AuthenticationError,
  ConnectionError,
  InvalidRequestError,
  NotFoundError,
  RateLimitError,
  APIError,
  CompliwaError,
  OPERATIONS,
} from '../src/index.js';
import { mockFetch, client, TEST_KEY } from './helpers.js';

test('the key: required, shaped, never printed', () => {
  const before = process.env.COMPLIWA_API_KEY;
  delete process.env.COMPLIWA_API_KEY;
  try {
    assert.throws(() => new Compliwa(), /no API key/);
    assert.throws(() => new Compliwa('sk_live_123'), /starts with cw_test_ or cw_live_/);
    assert.throws(() => new Compliwa('whsec_abcdefghijkl'), /webhook signing secret/);
    process.env.COMPLIWA_API_KEY = TEST_KEY;
    const fromEnv = new Compliwa({ fetch: async () => new Response('{}') });
    assert.equal(fromEnv.environment, 'test');
  } finally {
    if (before === undefined) delete process.env.COMPLIWA_API_KEY;
    else process.env.COMPLIWA_API_KEY = before;
  }
  const live = new Compliwa(`cw_live_${'b'.repeat(40)}`, { fetch: async () => new Response('{}') });
  assert.equal(live.environment, 'live');
  assert.equal(live.baseUrl, 'https://api.compliwa.com');
  assert.ok(!inspect(live).includes('bbbb'), 'inspect never shows the key');
  assert.ok(!JSON.stringify(live).includes('bbbb'), 'JSON never shows the key');
});

test('an OAuth access token works like a key (step 12.7 of the API)', async () => {
  const token = `cwat_live_${'c'.repeat(40)}`;
  let sent;
  const app = new Compliwa(token, {
    fetch: async (_url, init) => {
      sent = new Headers(init.headers).get('authorization');
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal(app.environment, 'live');
  await app.request('GET', '/v1/api-key');
  assert.equal(sent, `Bearer ${token}`);
  assert.equal(
    new Compliwa(`cwat_test_${'c'.repeat(40)}`, { fetch: async () => new Response('{}') }).environment,
    'test',
  );
  assert.throws(() => new Compliwa(`cwrt_test_${'c'.repeat(40)}`), /starts with cw_test_ or cw_live_/);
});

test('every operation in the contract is a method', () => {
  const compliwa = client(mockFetch([]));
  assert.ok(OPERATIONS.length >= 60);
  for (const op of OPERATIONS) {
    const fn = op.name.split('.').reduce((node, part) => node?.[part], compliwa);
    assert.equal(typeof fn, 'function', op.name);
  }
});

test('a create: the body, the key, an Idempotency-Key, the answer and its facts', async () => {
  const api = mockFetch([
    {
      status: 201,
      body: { id: 'ver_1', object: 'verification' },
      headers: { 'x-request-id': 'req_1', 'compliwa-environment': 'test', 'compliwa-api-version': '0.3.0' },
    },
  ]);
  const compliwa = client(api, { appInfo: { name: 'acme', version: '1.0' } });
  const result = await compliwa.verifications.create({ check: 'NG:NIN', id_number: '12345678901' });

  assert.deepEqual({ ...result }, { id: 'ver_1', object: 'verification' });
  assert.equal(result.lastResponse.status, 201);
  assert.equal(result.lastResponse.requestId, 'req_1');
  assert.equal(result.lastResponse.environment, 'test');
  assert.ok(!Object.keys(result).includes('lastResponse'), 'lastResponse is hidden');

  const [call] = api.calls;
  assert.equal(call.method, 'POST');
  assert.equal(call.url.href, 'https://api.test/v1/verifications');
  assert.equal(call.headers.Authorization, `Bearer ${TEST_KEY}`);
  assert.match(call.headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
  assert.match(call.headers['User-Agent'], /^compliwa-node\/\d+\.\d+\.\d+ node\/.+ acme\/1\.0$/);
  assert.deepEqual(call.body, { check: 'NG:NIN', id_number: '12345678901' });
});

test('path ids go in the path, encoded; params after them', async () => {
  const api = mockFetch([{ body: { id: 'trt_1' } }, { body: { id: 'cas_1' } }]);
  const compliwa = client(api);
  await compliwa.travelRule.transfers.confirm('trt_1', { txid: 'abc' });
  await compliwa.cases.retrieve('cas_1/../x');
  assert.equal(api.calls[0].url.pathname, '/v1/travel-rule/transfers/trt_1/confirm');
  assert.deepEqual(api.calls[0].body, { txid: 'abc' });
  assert.equal(api.calls[1].url.pathname, '/v1/cases/cas_1%2F..%2Fx');
  assert.throws(() => compliwa.cases.retrieve(), /caseId \(argument 1\) should be an id string/);
  assert.throws(() => compliwa.cases.retrieve(42), /should be an id string/);
  assert.throws(() => compliwa.verifications.create('oops'), /params should be an object/);
});

test('filters become the query; empty ones are left out', async () => {
  const api = mockFetch([{ body: { object: 'list', data: [], has_more: false, next_cursor: null } }]);
  const compliwa = client(api);
  await compliwa.screenings.list({ outcome: 'possible_match', reference: undefined, limit: 5 });
  assert.equal(api.calls[0].url.search, '?outcome=possible_match&limit=5');
  assert.equal(api.calls[0].headers['Idempotency-Key'], undefined, 'reads carry no key');
});

test('your own Idempotency-Key is used, and the same on every retry', async () => {
  const api = mockFetch([
    { status: 503, body: {} },
    { status: 500, body: {} },
    { status: 201, body: { id: 'scr_1' } },
  ]);
  const compliwa = client(api);
  await compliwa.screenings.create({ type: 'person', name: 'Ada' }, { idempotencyKey: 'onboarding-ada-1' });
  assert.deepEqual(
    api.calls.map((c) => c.headers['Idempotency-Key']),
    ['onboarding-ada-1', 'onboarding-ada-1', 'onboarding-ada-1'],
  );
  assert.equal(compliwa.sleeps.length, 2);
});

test('a generated key is also kept across retries', async () => {
  const api = mockFetch([{ throws: new TypeError('fetch failed') }, { status: 201, body: { id: 'ver_1' } }]);
  const compliwa = client(api);
  await compliwa.verifications.create({ check: 'NG:NIN', id_number: '12345678901' });
  assert.equal(api.calls.length, 2);
  assert.equal(api.calls[0].headers['Idempotency-Key'], api.calls[1].headers['Idempotency-Key']);
});

test('Retry-After is honoured; 409 idempotency_key_in_use waits and retries', async () => {
  const api = mockFetch([
    { status: 429, body: { code: 'rate_limited' }, headers: { 'retry-after': '3' } },
    { status: 409, body: { code: 'idempotency_key_in_use' }, headers: { 'retry-after': '1' } },
    { status: 200, body: { id: 'ver_1' } },
  ]);
  const compliwa = client(api);
  await compliwa.verifications.create({});
  assert.deepEqual(compliwa.sleeps, [3000, 1000]);
});

test('a write the API does not make idempotent: no key, no retry after a lost answer', async () => {
  const api = mockFetch([{ throws: new TypeError('fetch failed') }]);
  const compliwa = client(api);
  const error = await compliwa.transactions.create({ transaction_id: 't1' }).catch((e) => e);
  assert.ok(error instanceof ConnectionError);
  assert.match(error.message, /may or may not have run/);
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].headers['Idempotency-Key'], undefined);

  const api2 = mockFetch([{ status: 502, body: {} }]);
  const error2 = await client(api2)
    .transactions.create({})
    .catch((e) => e);
  assert.ok(error2 instanceof APIError);
  assert.equal(api2.calls.length, 1, 'a 5xx on such a write is not retried');

  const api3 = mockFetch([
    { status: 429, body: {} },
    { status: 201, body: { id: 'txn_1' } },
  ]);
  await client(api3).transactions.create({});
  assert.equal(api3.calls.length, 2, 'a 429 is retried: the request never ran');
});

test('reads retry on 5xx and network errors, up to maxRetries', async () => {
  const api = mockFetch([{ status: 500 }, { status: 502 }, { status: 503, body: { code: 'unavailable' } }]);
  const compliwa = client(api);
  const error = await compliwa.verifications.retrieve('ver_1').catch((e) => e);
  assert.ok(error instanceof APIError);
  assert.equal(error.status, 503);
  assert.equal(api.calls.length, 3);

  const once = mockFetch([{ status: 500 }]);
  await client(once)
    .verifications.retrieve('ver_1', { maxRetries: 0 })
    .catch(() => {});
  assert.equal(once.calls.length, 1);
});

test('a long Retry-After is not waited out: the error says how long', async () => {
  const api = mockFetch([
    { status: 429, body: { code: 'rate_limited' }, headers: { 'retry-after': '3600' } },
  ]);
  const error = await client(api)
    .verifications.list()
    .catch((e) => e);
  assert.ok(error instanceof RateLimitError);
  assert.equal(error.retryAfter, 3600);
  assert.equal(api.calls.length, 1);
});

test('errors carry what the API said', async () => {
  const problem = {
    type: 'https://compliwa.com/errors/validation_failed',
    title: 'Some fields need fixing',
    status: 400,
    code: 'validation_failed',
    detail: 'id_number: 11 digits',
    errors: [{ path: 'id_number', message: '11 digits' }],
  };
  const api = mockFetch([
    { status: 400, body: problem, headers: { 'x-request-id': 'req_9' } },
    { status: 401, body: { code: 'api_key_revoked', title: 'This key was revoked' } },
    { status: 404, body: { code: 'not_found' } },
    { status: 502, body: '<html>bad gateway</html>', headers: { 'content-type': 'text/html' } },
  ]);
  const compliwa = client(api, { maxRetries: 0 });

  const invalid = await compliwa.verifications.create({}).catch((e) => e);
  assert.ok(invalid instanceof InvalidRequestError && invalid instanceof CompliwaError);
  assert.equal(invalid.code, 'validation_failed');
  assert.equal(invalid.requestId, 'req_9');
  assert.deepEqual(invalid.errors, problem.errors);
  assert.equal(invalid.message, 'Some fields need fixing: id_number: 11 digits');
  assert.equal(invalid.name, 'InvalidRequestError');

  const auth = await compliwa.apiKey.retrieve().catch((e) => e);
  assert.ok(auth instanceof AuthenticationError);
  assert.equal(auth.code, 'api_key_revoked');

  assert.ok((await compliwa.cases.retrieve('cas_x').catch((e) => e)) instanceof NotFoundError);

  const gateway = await compliwa.cases.retrieve('cas_x').catch((e) => e);
  assert.ok(gateway instanceof APIError);
  assert.match(gateway.detail, /bad gateway/);
});

test('a timeout is a ConnectionError with code timeout', async () => {
  const slow = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  const compliwa = new Compliwa(TEST_KEY, { fetch: slow, timeoutMs: 20, maxRetries: 0 });
  const error = await compliwa.apiKey.retrieve().catch((e) => e);
  assert.ok(error instanceof ConnectionError);
  assert.equal(error.code, 'timeout');
});

test('your AbortSignal stops the call and its retries', async () => {
  const controller = new AbortController();
  const api = mockFetch([{ status: 503 }, { status: 503 }]);
  const compliwa = new Compliwa(TEST_KEY, {
    fetch: api,
    sleep: async () => controller.abort(new Error('stopped')),
  });
  const error = await compliwa.verifications.retrieve('ver_1', { signal: controller.signal }).catch((e) => e);
  assert.equal(error.message, 'stopped');
  assert.equal(api.calls.length, 1);
});

test('request(): any endpoint, the same machinery', async () => {
  const api = mockFetch([{ body: { object: 'sandbox' } }]);
  const compliwa = client(api);
  const answer = await compliwa.request('get', '/v1/sandbox', { query: { a: 1 } });
  assert.equal(answer.object, 'sandbox');
  assert.equal(api.calls[0].url.href, 'https://api.test/v1/sandbox?a=1');
  assert.throws(() => compliwa.request('GET', 'v1/x'), /starts with \//);
});

test('Accept-Language when you choose a language', async () => {
  const api = mockFetch([{ body: {} }]);
  await client(api, { language: 'fr' }).apiKey.retrieve();
  assert.equal(api.calls[0].headers['Accept-Language'], 'fr');
});
