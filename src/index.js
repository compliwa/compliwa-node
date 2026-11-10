/**
 * compliwa-node — the official Node.js library for the Compliwa API.
 *
 *   import Compliwa from '@compliwa/node';
 *
 *   const compliwa = new Compliwa(process.env.COMPLIWA_API_KEY);   // cw_test_… or cw_live_…
 *   const verification = await compliwa.verifications.create({ … });
 *
 * Every method is generated from the API's contract (src/generated/operations.js):
 *   compliwa.<resource>.<method>(...ids, params?, options?)
 *     ids       the path ids, in order:      compliwa.travelRule.transfers.confirm('trt_…', { txid })
 *     params    the body (POST/PATCH) or the filters (GET)
 *     options   { idempotencyKey, timeoutMs, maxRetries, signal, headers }
 */
import { HttpClient, DEFAULT_BASE_URL, VERSION } from './client.js';
import { OPERATIONS } from './generated/operations.js';
import { API_VERSION } from './generated/meta.js';
import { PagePromise } from './pagination.js';

const KEY_SHAPE = /^cw_(test|live)_[A-Za-z0-9_-]{8,}$/;
const camel = (text) => text.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** One SDK method for one operation. */
function methodFor(http, op) {
  const takesParams = Boolean(op.body || op.query);
  const label = `compliwa.${op.name}()`;
  return function compliwaMethod(...args) {
    const ids = args.slice(0, op.pathParams.length);
    op.pathParams.forEach((param, i) => {
      if (typeof ids[i] !== 'string' || ids[i] === '') {
        throw new TypeError(`${label}: ${camel(param)} (argument ${i + 1}) should be an id string`);
      }
    });
    const rest = args.slice(op.pathParams.length);
    const params = takesParams ? rest[0] : undefined;
    const options = (takesParams ? rest[1] : rest[0]) ?? {};
    if (params !== undefined && !isPlainObject(params)) {
      throw new TypeError(`${label}: params should be an object`);
    }
    if (!isPlainObject(options)) throw new TypeError(`${label}: options should be an object`);
    if (!takesParams && rest.length > 1) {
      throw new TypeError(
        `${label} takes no params — only ${op.pathParams.length ? 'the id and ' : ''}options`,
      );
    }

    const path = op.path.replace(/\{([^}]+)\}/g, (_, name) =>
      encodeURIComponent(ids[op.pathParams.indexOf(name)]),
    );
    const send = (query) =>
      http.request(op.http, path, {
        body: op.body ? (params ?? {}) : undefined,
        query: op.query ? query : undefined,
        idempotent: Boolean(op.idempotent),
        options,
      });
    if (op.paginated) return new PagePromise(send, params ?? {});
    return send(params);
  };
}

function buildResources(target, http) {
  for (const op of OPERATIONS) {
    let node = target;
    for (const part of op.name.split('.').slice(0, -1)) {
      if (!Object.hasOwn(node, part)) {
        Object.defineProperty(node, part, { value: {}, enumerable: true });
      }
      node = node[part];
    }
    const method = op.name.split('.').at(-1);
    Object.defineProperty(node, method, { value: methodFor(http, op), enumerable: true });
  }
}

export class Compliwa {
  static VERSION = VERSION;
  static API_VERSION = API_VERSION;

  /**
   * @param {string} [apiKey]  cw_test_… or cw_live_… — defaults to process.env.COMPLIWA_API_KEY
   * @param {object} [options]  { baseUrl, timeoutMs, maxRetries, fetch, appInfo, language }
   */
  constructor(apiKey, options = {}) {
    if (isPlainObject(apiKey) && options && Object.keys(options).length === 0) {
      options = apiKey;
      apiKey = undefined;
    }
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      throw new Error(
        'compliwa: this library runs on your server. An API key in a browser can be read by anyone who opens the page — use the hosted flow or the widget there.',
      );
    }
    const key = apiKey ?? process.env.COMPLIWA_API_KEY;
    if (!key) {
      throw new Error(
        'compliwa: no API key — pass one, or set COMPLIWA_API_KEY (create one in the dashboard: API keys).',
      );
    }
    if (!KEY_SHAPE.test(key)) {
      const hint = key.startsWith('whsec_')
        ? ' That is a webhook signing secret — it goes to verifyWebhook(), not here.'
        : '';
      throw new Error(`compliwa: an API key starts with cw_test_ or cw_live_.${hint}`);
    }
    const http = new HttpClient(key, options);
    Object.defineProperty(this, 'http', { value: http, enumerable: false });
    /** 'test' (sandbox data, never charged) or 'live' — decided by the key. */
    this.environment = key.startsWith('cw_live_') ? 'live' : 'test';
    this.baseUrl = http.baseUrl;
    buildResources(this, http);
  }

  /**
   * Any endpoint, for what the SDK does not name yet: the same key, retries and errors.
   *   await compliwa.request('GET', '/v1/verifications', { query: { limit: 5 } })
   */
  request(method, path, { body, query, idempotent = false, ...options } = {}) {
    if (!path.startsWith('/'))
      throw new TypeError('compliwa.request(): the path starts with /, e.g. /v1/verifications');
    return this.http.request(method, path, { body, query, idempotent, options });
  }

  /** Never print the key: console.log(compliwa) shows what it is, not the secret. */
  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `Compliwa { environment: '${this.environment}', baseUrl: '${this.baseUrl}' }`;
  }

  toJSON() {
    return { environment: this.environment, baseUrl: this.baseUrl };
  }
}

export default Compliwa;
export { DEFAULT_BASE_URL, VERSION, API_VERSION, OPERATIONS, PagePromise };
export * from './errors.js';
export { verifyWebhook, signWebhook, SIGNATURE_HEADER } from './webhooks.js';
