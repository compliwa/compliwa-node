import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch, client } from './helpers.js';

const page = (ids, next) => ({
  object: 'list',
  data: ids.map((id) => ({ id })),
  has_more: Boolean(next),
  next_cursor: next ?? null,
});

test('await a list: the first page, as sent', async () => {
  const api = mockFetch([{ body: page(['ver_1', 'ver_2'], 'c2') }]);
  const first = await client(api).verifications.list({ limit: 2 });
  assert.equal(first.data.length, 2);
  assert.equal(first.has_more, true);
  assert.equal(first.lastResponse.status, 200);
  assert.equal(api.calls.length, 1);
});

test('for await: every item, page after page, with the same filters', async () => {
  const api = mockFetch([
    { body: page(['ver_1', 'ver_2'], 'c2') },
    { body: page(['ver_3', 'ver_4'], 'c3') },
    { body: page(['ver_5']) },
  ]);
  const ids = [];
  for await (const verification of client(api).verifications.list({ status: 'completed', limit: 2 })) {
    ids.push(verification.id);
  }
  assert.deepEqual(ids, ['ver_1', 'ver_2', 'ver_3', 'ver_4', 'ver_5']);
  assert.deepEqual(
    api.calls.map((c) => c.url.search),
    [
      '?status=completed&limit=2',
      '?status=completed&limit=2&cursor=c2',
      '?status=completed&limit=2&cursor=c3',
    ],
  );
});

test('pages are fetched only as they are read', async () => {
  const api = mockFetch([{ body: page(['a', 'b'], 'c2') }, { body: page(['c']) }]);
  for await (const item of client(api).cases.list()) {
    assert.equal(item.id, 'a');
    break;
  }
  assert.equal(api.calls.length, 1);
  assert.equal(api.remaining(), 1);
});

test('toArray, with a guard against a runaway read', async () => {
  const api = mockFetch([{ body: page(['a', 'b'], 'c2') }, { body: page(['c']) }]);
  const all = await client(api).consents.list().toArray();
  assert.deepEqual(
    all.map((x) => x.id),
    ['a', 'b', 'c'],
  );

  const many = mockFetch([{ body: page(['a', 'b', 'c'], 'c2') }]);
  await assert.rejects(client(many).consents.list().toArray({ max: 2 }), RangeError);
});

test('the first page is fetched once, however often it is awaited', async () => {
  const api = mockFetch([{ body: page(['a']) }]);
  const list = client(api).screenings.list();
  await list;
  await list;
  const items = [];
  for await (const item of list) items.push(item.id);
  assert.deepEqual(items, ['a']);
  assert.equal(api.calls.length, 1);
});

test('a list without pages is a plain answer', async () => {
  const api = mockFetch([{ body: { object: 'list', data: [{ chain: 'ethereum' }] } }]);
  const chains = await client(api).walletScreenings.chains.list();
  assert.equal(chains.data[0].chain, 'ethereum');
  assert.equal(typeof chains.toArray, 'undefined');
});
