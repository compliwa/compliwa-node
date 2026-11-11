# Changelog

## 0.3.0 — 2026-11-10

Generated from the Compliwa API contract 0.6.0.

- OAuth access tokens: `new Compliwa('cwat_test_…')` works for an app your customers connected with
  OAuth — the same methods, retries and errors as an API key; `environment` comes from the token.
- `compliwa.apiKey.retrieve()` tells you the app (`oauth_app`) when you call with an access token.

## 0.2.0 — 2026-11-10

Generated from the Compliwa API contract 0.4.0.

- `compliwa.webhookEndpoints.list / create / retrieve / update / del`: subscribe to events from your
  server, in your key's environment (needs the key's `webhooks.manage` scope). `create` returns the
  signing secret once — pass it to `verifyWebhook()`.

## 0.1.0 — 2026-11-09

The first release, generated from the Compliwa API contract 0.3.0.

- Every operation an API key can call (61), named from the contract's `x-sdk`, with TypeScript types
  for every request and answer.
- Retries only when safe, honouring `Retry-After`; an `Idempotency-Key` kept across retries for the
  creates the API makes idempotent.
- Lists you can await (one page) or iterate (every item, page by page), and `toArray()`.
- Typed errors carrying the API's problem details (`code`, `detail`, `errors`, `requestId`).
- `verifyWebhook()` for the `Compliwa-Signature` header, and `signWebhook()` for tests.
