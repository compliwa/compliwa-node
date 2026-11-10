import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPERATIONS, API_VERSION } from '../src/index.js';

test('the generated table is sound', () => {
  assert.match(API_VERSION, /^\d+\.\d+\.\d+$/);
  const names = new Set();
  for (const op of OPERATIONS) {
    assert.ok(!names.has(op.name), `${op.name} appears once`);
    names.add(op.name);
    assert.match(op.path, /^\/v1\//);
    assert.ok(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(op.http), op.name);
    const inPath = [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    assert.deepEqual(op.pathParams, inPath, `${op.name}: path ids in order`);
    if (op.paginated) assert.ok(op.query && op.http === 'GET', `${op.name}: pages are GET lists`);
    if (op.idempotent) assert.notEqual(op.http, 'GET', op.name);
  }
});
