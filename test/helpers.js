/**
 * A fetch that answers from a script and remembers every request — no network in the unit tests.
 *
 *   const api = mockFetch([{ status: 200, body: { id: 'ver_1' } }]);
 *   const compliwa = client(api);
 *   api.calls[0]  → { url, method, headers, body }
 */
import Compliwa from '../src/index.js';

export const TEST_KEY = `cw_test_${'a'.repeat(40)}`;

export function mockFetch(script) {
  const queue = [...script];
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({
      url: new URL(url),
      method: init.method,
      headers: init.headers ?? {},
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      signal: init.signal,
    });
    const step = queue.shift();
    if (!step) throw new Error(`mockFetch: no answer scripted for ${init.method} ${url}`);
    if (step.throws) throw step.throws;
    const headers = new Headers({ 'content-type': 'application/json', ...step.headers });
    const text =
      step.body === undefined ? '' : typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
    return new Response(text || null, { status: step.status ?? 200, headers });
  };
  fetch.calls = calls;
  fetch.remaining = () => queue.length;
  return fetch;
}

export function client(fetch, options = {}) {
  const sleeps = [];
  const compliwa = new Compliwa(TEST_KEY, {
    baseUrl: 'https://api.test',
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...options,
  });
  compliwa.sleeps = sleeps;
  return compliwa;
}
