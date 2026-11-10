# Changelog

## 0.1.0 — 2026-11-09

The first release, generated from the Compliwa API contract 0.3.0.

- Every operation an API key can call (61), named from the contract's `x-sdk`, with TypeScript types
  for every request and answer.
- Retries only when safe, honouring `Retry-After`; an `Idempotency-Key` kept across retries for the
  creates the API makes idempotent.
- Lists you can await (one page) or iterate (every item, page by page), and `toArray()`.
- Typed errors carrying the API's problem details (`code`, `detail`, `errors`, `requestId`).
- `verifyWebhook()` for the `Compliwa-Signature` header, and `signWebhook()` for tests.
