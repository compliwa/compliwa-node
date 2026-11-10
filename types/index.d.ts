// Types for @compliwa/node — written by hand; the resources and their data are in ./generated.d.ts.
import type { CompliwaResources } from './generated.js';

export * from './generated.js';

export interface ClientOptions {
  /** Default https://api.compliwa.com. For local development: http://localhost:5010 */
  baseUrl?: string;
  /** One attempt's deadline. Default 30 000 ms. */
  timeoutMs?: number;
  /** Retries after the first attempt, when retrying is safe. Default 2. */
  maxRetries?: number;
  /** Your own fetch (a proxy, a test double). Default: Node's global fetch. */
  fetch?: typeof fetch;
  /** Added to the User-Agent, e.g. { name: 'acmepay-onboarding', version: '3.1.0' }. */
  appInfo?: { name: string; version?: string };
  /** Accept-Language for error titles and details: en, fr, es or ar. */
  language?: 'en' | 'fr' | 'es' | 'ar' | (string & {});
}

export interface RequestOptions {
  /** Your own Idempotency-Key (8–255 visible ASCII characters). One is made for you when the operation is idempotent. */
  idempotencyKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Abort the call (and any retries). */
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/** Facts about the HTTP answer, on every result as a non-enumerable property. */
export interface LastResponse {
  status: number;
  /** X-Request-Id — quote it to Compliwa support. */
  requestId: string | null;
  /** test or live: which data the key reached. */
  environment: 'test' | 'live' | null;
  apiVersion: string | null;
  /** true when this is the stored answer to an earlier call with the same Idempotency-Key. */
  idempotentReplayed: boolean;
  headers: Record<string, string>;
}

export type WithResponse<T> = T & { readonly lastResponse: LastResponse };

/** A page of a list — await it for the first page, or `for await` it for every item. */
export interface PagePromise<Item, Page> extends Promise<WithResponse<Page>>, AsyncIterable<Item> {
  pages(): AsyncIterableIterator<WithResponse<Page>>;
  toArray(options?: { max?: number }): Promise<Item[]>;
}

export declare class Compliwa {
  static readonly VERSION: string;
  /** The API contract version this SDK was generated from. */
  static readonly API_VERSION: string;

  /** @param apiKey cw_test_… or cw_live_… — defaults to process.env.COMPLIWA_API_KEY */
  constructor(apiKey?: string, options?: ClientOptions);
  constructor(options?: ClientOptions);

  /** Decided by the key: cw_test_ → 'test' (sandbox, never charged), cw_live_ → 'live'. */
  readonly environment: 'test' | 'live';
  readonly baseUrl: string;

  /** Any endpoint, with the same key, retries and errors. */
  request<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: `/${string}`,
    options?: RequestOptions & { body?: unknown; query?: Record<string, unknown>; idempotent?: boolean },
  ): Promise<WithResponse<T>>;
}

export interface Compliwa extends CompliwaResources {}

export default Compliwa;

export declare const VERSION: string;
export declare const API_VERSION: string;
export declare const DEFAULT_BASE_URL: string;
export declare const SIGNATURE_HEADER: 'Compliwa-Signature';
export declare const OPERATIONS: ReadonlyArray<{
  name: string;
  http: string;
  path: string;
  pathParams: string[];
  body?: true;
  query?: true;
  paginated?: true;
  idempotent?: true;
}>;

export interface FieldError {
  path: string;
  message: string;
}

export declare class CompliwaError extends Error {
  /** The HTTP status; 0 when no answer came. */
  readonly status: number;
  /** Compliwa's stable code — switch on this. */
  readonly code: string | null;
  readonly title: string | null;
  readonly detail: string | null;
  /** For a 400: what is wrong with each field. */
  readonly errors: FieldError[];
  readonly requestId: string | null;
  /** Seconds to wait, when the API said. */
  readonly retryAfter: number | null;
  /** The answer's body as sent. */
  readonly raw: unknown;
}
export declare class AuthenticationError extends CompliwaError {}
export declare class PermissionError extends CompliwaError {}
export declare class NotFoundError extends CompliwaError {}
export declare class ConflictError extends CompliwaError {}
export declare class InvalidRequestError extends CompliwaError {}
export declare class RateLimitError extends CompliwaError {}
export declare class APIError extends CompliwaError {}
export declare class ConnectionError extends CompliwaError {}
export declare class WebhookSignatureError extends CompliwaError {}

/** The body of every webhook Compliwa sends. */
export interface WebhookEvent {
  id: string;
  object: 'event';
  type: string;
  api_version: string;
  created_at: string;
  environment: 'test' | 'live';
  data: { object: { object: string; id: string; [field: string]: unknown } };
}

/**
 * Check a webhook's Compliwa-Signature and return its event — or throw WebhookSignatureError.
 * Pass the RAW body (a Buffer or the exact string received).
 */
export declare function verifyWebhook(
  payload: string | Uint8Array | ArrayBuffer,
  header: string | string[] | null | undefined,
  secret: string,
  options?: { toleranceSeconds?: number; now?: number },
): WebhookEvent;

/** Sign a payload as Compliwa does — for testing your own webhook handler. */
export declare function signWebhook(
  payload: string | object,
  secret: string,
  options?: { timestamp?: number },
): string;
