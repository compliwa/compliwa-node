# Compliwa for Node.js

The official Node.js library for the [Compliwa API](https://compliwa.com/developers/api): identity
checks, sanctions and PEP screening, business checks, consent records, monitoring, cases, the Travel
Rule and signed webhooks — from your server, in a few lines.

```js
import Compliwa from '@compliwa/node';

const compliwa = new Compliwa(process.env.COMPLIWA_API_KEY);

const verification = await compliwa.verifications.create({
  check: 'NG:NIN',
  id_number: '12345678901',
  first_name: 'Ada',
  last_name: 'Okafor',
  date_of_birth: '1990-05-14',
  consent: true,
});

console.log(verification.id, verification.status);
```

Every method is generated from the API's own contract, so it covers each endpoint an API key can
call, with TypeScript types for every request and answer.

## Install

```
npm install @compliwa/node
```

Node.js 20.19 or newer. No dependencies.

## Your API key

Create one in the dashboard under **API keys**. The key decides where your calls go:

| Key        | Reaches                                                        |
| ---------- | -------------------------------------------------------------- |
| `cw_test_` | The sandbox: test data that answers predictably, never charged |
| `cw_live_` | Real customers, counted against your plan                      |

Keep it in an environment variable or your secret manager — never in code, never in a browser.
`new Compliwa()` with no argument reads `COMPLIWA_API_KEY`. The library refuses to run in a browser.

The sandbox's test numbers (an ID that is found, one that is not, a provider that times out …) are
listed at `GET /v1/sandbox` and on the [Sandbox page](https://compliwa.com/developers/api/sandbox).

## An app your customers connect (OAuth)

If you build a product that other companies connect to their Compliwa workspace, they click
"Allow" on Compliwa's consent screen instead of pasting a key into your product. Your server then
holds an OAuth access token (`cwat_test_…` or `cwat_live_…`, one hour) for each customer. It works
everywhere a key does:

```js
const customer = new Compliwa(accessTokenFromYourDatabase);
const verifications = await customer.verifications.list({ limit: 10 });
```

When it expires the API answers `401 access_token_expired`: exchange your refresh token at
`POST /v1/oauth/token` (any OAuth library does this) and use the new access token. The flow, the
scopes and the token endpoint are in the API reference, under OAuth.

## How methods read

`compliwa.<resource>.<method>(...ids, params?, options?)`

```js
await compliwa.screenings.create({ type: 'person', name: 'Ada Okafor' });
await compliwa.screenings.retrieve('scr_…');
await compliwa.travelRule.transfers.confirm('trt_…', { txid: '…' });
await compliwa.cases.items.create('cas_…', { … });
```

- **ids** come first, in the order of the path.
- **params** is the body for a create or an action, the filters for a list.
- **options**: `idempotencyKey`, `timeoutMs`, `maxRetries`, `signal` (an `AbortSignal`), `headers`.

The full list, with every field, is in [the API reference](https://compliwa.com/developers/api);
each operation there shows its Node.js call.

## Lists and pages

Await a list for one page, exactly as the API sent it — or iterate it, and the library fetches the
next page only when you reach it:

```js
const page = await compliwa.verifications.list({ status: 'completed', limit: 50 });
page.data;
page.has_more;
page.next_cursor;

for await (const verification of compliwa.verifications.list({ status: 'completed' })) {
  // every verification, page after page
}

const all = await compliwa.monitoring.customers.list({ risk: 'high' }).toArray({ max: 5000 });
```

## Retries and idempotency

A call is retried — twice by default, with growing waits — only when retrying is safe and can help:
no answer, `429`, a `5xx`, or `409 idempotency_key_in_use`. It waits as long as `Retry-After` says.

Creates the API makes idempotent (verifications, screenings, identity sessions, business checks,
consents, cases, subject requests, signup checks, wallet screenings, Travel Rule transfers) carry an
`Idempotency-Key`, the same on every retry: a check is never run or charged twice. Pass your own to
make a retry across restarts safe too:

```js
await compliwa.verifications.create(params, { idempotencyKey: `onboarding-${customer.id}` });
```

Any other write is retried only after a `429` (it never ran). If its answer is lost, you get a
`ConnectionError` saying it may or may not have run — read it back before sending it again.

## Errors

Every failure is a `CompliwaError` with what the API said; switch on `code`, which never changes.

```js
import { CompliwaError, InvalidRequestError, RateLimitError } from '@compliwa/node';

try {
  await compliwa.verifications.create(params);
} catch (error) {
  if (error instanceof InvalidRequestError) {
    console.log(error.errors); // [{ path: 'id_number', message: '…' }]
  } else if (error instanceof CompliwaError) {
    console.log(error.status, error.code, error.detail, error.requestId);
  } else {
    throw error;
  }
}
```

| Class                 | When                                                   |
| --------------------- | ------------------------------------------------------ |
| `InvalidRequestError` | 400, 422 — fix the request                             |
| `AuthenticationError` | 401 — the key is missing, wrong, revoked or expired    |
| `PermissionError`     | 403 — the key lacks a scope (`scope_missing`)          |
| `NotFoundError`       | 404                                                    |
| `ConflictError`       | 409                                                    |
| `RateLimitError`      | 429 after the retries — `retryAfter` says how long     |
| `APIError`            | 5xx after the retries                                  |
| `ConnectionError`     | No answer — `code` is `timeout` or `connection_failed` |

Quote `error.requestId` when you contact support. Set `language: 'fr'` (or `es`, `ar`) on the
client to get titles and details in that language.

## The answer's facts

Every result has a hidden `lastResponse`:

```js
const screening = await compliwa.screenings.create(params);
screening.lastResponse.requestId; // X-Request-Id
screening.lastResponse.environment; // 'test' or 'live'
screening.lastResponse.idempotentReplayed; // true when this is the stored first answer
```

## Webhooks

Check every webhook's signature before you trust it. Pass the **raw** body:

```js
import express from 'express';
import { verifyWebhook } from '@compliwa/node';

const app = express();

app.post('/webhooks/compliwa', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = verifyWebhook(req.body, req.get('Compliwa-Signature'), process.env.COMPLIWA_WEBHOOK_SECRET);
  } catch {
    return res.status(400).end();
  }
  // Deliveries can repeat: skip an event.id you have already handled.
  if (event.type === 'verification.completed') {
    // read the verification with compliwa.verifications.retrieve(event.data.object.id)
  }
  res.status(204).end();
});
```

It accepts either signature while a rolled secret overlaps, and refuses one older than 5 minutes.
To test your handler, `signWebhook(payload, secret)` makes a header exactly as Compliwa does.

## Anything else

`compliwa.request(method, path, { body, query, ...options })` calls any endpoint with the same key,
retries and errors.

## Options

```js
new Compliwa(apiKey, {
  baseUrl: 'http://localhost:5010', // default https://api.compliwa.com
  timeoutMs: 30_000, // per attempt
  maxRetries: 2,
  language: 'en', // en · fr · es · ar
  appInfo: { name: 'acmepay-onboarding', version: '3.1.0' }, // added to the User-Agent
  fetch, // your own fetch
});
```

## Developing this library

```
npm install
npm run generate     # from ../compliwaAPI/openapi/dist/openapi.json, or --spec <file or URL>
npm test             # unit tests, no network
npm run typecheck
npm run test:e2e     # against a running API, with COMPLIWA_API_KEY=cw_test_…
```

`src/generated/` and `types/generated.d.ts` come from the contract and are never edited by hand.
The method names come from the contract too (`x-sdk`), so this library, the
[Python library](https://github.com/compliwa/compliwa-python) and the API reference always agree.

## License

MIT
