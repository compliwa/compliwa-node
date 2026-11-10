/**
 * compliwa-node — src/client.js
 *
 * One request to the Compliwa API, done properly:
 *
 *   - Authorization: Bearer <your key>; a cw_test_ key reaches the sandbox, a cw_live_ key real
 *     customers (the key decides — there is no separate test address)
 *   - a write the API makes idempotent (x-sdk idempotent: verifications.create, screenings.create …)
 *     carries an Idempotency-Key — made for you, or yours — the SAME on every retry, so a retry can
 *     never check, charge or create twice
 *   - retried, with exponential back-off and jitter, only when retrying is safe and can help:
 *       reads and idempotent writes   no answer (network, timeout), 429, 409 idempotency_key_in_use,
 *                                     500 / 502 / 503 / 504
 *       any other write               429 only (refused before it ran) — after a lost answer the SDK
 *                                     cannot know whether it ran, so it says so (ConnectionError)
 *     waiting as long as Retry-After says (at most a minute). Never on another 4xx: fix the request.
 *   - one deadline per attempt (timeoutMs), and your AbortSignal ends it all
 *   - a failure is a typed CompliwaError (errors.js); a success is the parsed JSON, with the answer's
 *     facts on a hidden `lastResponse` property: status, requestId, environment, apiVersion, headers
 *
 * Node.js only: an API key in a browser would be a key anyone can read.
 */
import { randomUUID } from 'node:crypto';
import { ConnectionError, errorFromResponse } from './errors.js';
import { API_VERSION } from './generated/meta.js';

export const VERSION = '0.1.0';
export const DEFAULT_BASE_URL = 'https://api.compliwa.com';
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 60_000;

const realSleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

function queryString(params) {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, String(v)));
    else search.append(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

function retryAfterMs(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

export class HttpClient {
  /**
   * @param {string} apiKey
   * @param {{ baseUrl?: string, timeoutMs?: number, maxRetries?: number, fetch?: typeof fetch,
   *           sleep?: (ms: number, signal?: AbortSignal) => Promise<void>, appInfo?: { name: string, version?: string },
   *           language?: string }} options
   */
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? realSleep;
    this.language = options.language ?? null;
    const app = options.appInfo
      ? ` ${options.appInfo.name}${options.appInfo.version ? `/${options.appInfo.version}` : ''}`
      : '';
    this.userAgent = `compliwa-node/${VERSION} node/${process.versions.node}${app}`;
    if (typeof this.fetch !== 'function')
      throw new TypeError('compliwa: fetch is not available (Node.js 20.19 or newer is needed)');
  }

  /** Back-off before retry `n` (1, 2 …): 0.5 s, 1 s, 2 s … at most 8 s, ±25%. */
  backoff(n) {
    const base = Math.min(500 * 2 ** (n - 1), 8000);
    return Math.round(base * (0.75 + Math.random() * 0.5));
  }

  /**
   * @param {'GET'|'POST'|'PATCH'|'PUT'|'DELETE'} method
   * @param {string} path               e.g. /v1/verifications
   * @param {{ body?: unknown, query?: Record<string, unknown>, idempotent?: boolean,
   *           options?: { idempotencyKey?: string, timeoutMs?: number, maxRetries?: number, signal?: AbortSignal, headers?: Record<string, string> } }} request
   */
  async request(method, path, { body, query, idempotent = false, options = {} } = {}) {
    method = method.toUpperCase();
    const url = `${this.baseUrl}${path}${queryString(query)}`;
    const safe = method === 'GET' || method === 'HEAD';
    const idempotencyKey = safe
      ? undefined
      : (options.idempotencyKey ?? (idempotent ? randomUUID() : undefined));
    const retrySafe = safe || idempotent;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': this.userAgent,
      ...(this.language && { 'Accept-Language': this.language }),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
      ...options.headers,
    };
    const payload = body === undefined ? undefined : JSON.stringify(body);

    for (let attempt = 0; ; attempt += 1) {
      options.signal?.throwIfAborted();
      // One deadline for the whole attempt — the answer's headers and its body.
      const deadline = new AbortController();
      const timer = setTimeout(
        () => deadline.abort(new DOMException('The attempt timed out', 'TimeoutError')),
        timeoutMs,
      );
      const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
      let response;
      let text;
      try {
        response = await this.fetch(url, { method, headers, body: payload, signal });
        text = await response.text();
      } catch (cause) {
        if (options.signal?.aborted) throw cause;
        if (retrySafe && attempt < maxRetries) {
          await this.sleep(this.backoff(attempt + 1), options.signal);
          continue;
        }
        const timedOut = deadline.signal.aborted;
        const unknown = retrySafe
          ? ''
          : ' — it may or may not have run: read it back before sending it again';
        throw new ConnectionError(
          (timedOut
            ? `No answer from the Compliwa API within ${timeoutMs} ms`
            : `Could not reach the Compliwa API: ${cause?.message ?? cause}`) + unknown,
          { cause, code: timedOut ? 'timeout' : 'connection_failed' },
        );
      } finally {
        clearTimeout(timer);
      }

      const requestId = response.headers.get('x-request-id');
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      if (response.ok) {
        const result = parsed ?? {};
        if (result && typeof result === 'object') {
          Object.defineProperty(result, 'lastResponse', {
            value: {
              status: response.status,
              requestId,
              environment: response.headers.get('compliwa-environment'),
              apiVersion: response.headers.get('compliwa-api-version'),
              idempotentReplayed: response.headers.get('idempotent-replayed') === 'true',
              headers: Object.fromEntries(response.headers.entries()),
            },
            enumerable: false,
          });
        }
        return result;
      }

      const wait = retryAfterMs(response.headers.get('retry-after'));
      const retryable =
        response.status === 429 ||
        (retrySafe &&
          (RETRY_STATUSES.has(response.status) ||
            (response.status === 409 && parsed?.code === 'idempotency_key_in_use')));
      if (retryable && attempt < maxRetries && (wait === null || wait <= MAX_RETRY_AFTER_MS)) {
        await this.sleep(wait ?? this.backoff(attempt + 1), options.signal);
        continue;
      }
      throw errorFromResponse(response.status, parsed, {
        requestId,
        retryAfter: wait === null ? null : Math.ceil(wait / 1000),
      });
    }
  }
}

export { API_VERSION };
