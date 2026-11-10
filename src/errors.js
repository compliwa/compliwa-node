/**
 * compliwa-node — src/errors.js
 *
 * Every failure is a CompliwaError, with what the API said (RFC 9457 problem details):
 *
 *   err.status       the HTTP status (0 when no answer came)
 *   err.code         Compliwa's stable code — switch on this ("api_key_invalid", "scope_missing" …)
 *   err.title        a short sentence, in the language you asked for (Accept-Language)
 *   err.detail       what went wrong and how to fix it
 *   err.errors       for a 400: [{ path, message }] per field
 *   err.requestId    X-Request-Id — quote it to Compliwa support
 *   err.retryAfter   seconds, when the API said to wait (429, 409 idempotency_key_in_use)
 *
 * Subclasses by kind, so you can `instanceof` them:
 *   AuthenticationError 401 · PermissionError 403 · NotFoundError 404 · ConflictError 409 ·
 *   InvalidRequestError 400 / 422 · RateLimitError 429 · APIError 5xx and anything else ·
 *   ConnectionError (no answer: network, timeout) · WebhookSignatureError (verifyWebhook)
 */

export class CompliwaError extends Error {
  constructor(
    message,
    {
      status = 0,
      code = null,
      title = null,
      detail = null,
      errors = [],
      requestId = null,
      retryAfter = null,
      raw = null,
      cause,
    } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.title = title;
    this.detail = detail;
    this.errors = errors;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
    Object.defineProperty(this, 'raw', { value: raw, enumerable: false });
  }
}

export class AuthenticationError extends CompliwaError {}
export class PermissionError extends CompliwaError {}
export class NotFoundError extends CompliwaError {}
export class ConflictError extends CompliwaError {}
export class InvalidRequestError extends CompliwaError {}
export class RateLimitError extends CompliwaError {}
export class APIError extends CompliwaError {}
export class ConnectionError extends CompliwaError {}
export class WebhookSignatureError extends CompliwaError {}

const BY_STATUS = {
  400: InvalidRequestError,
  401: AuthenticationError,
  403: PermissionError,
  404: NotFoundError,
  409: ConflictError,
  422: InvalidRequestError,
  429: RateLimitError,
};

/** The error for an answer that was not 2xx. */
export function errorFromResponse(status, body, { requestId, retryAfter }) {
  const problem = body && typeof body === 'object' ? body : {};
  const Kind = BY_STATUS[status] ?? APIError;
  const title = problem.title ?? null;
  const detail = problem.detail ?? (typeof body === 'string' && body ? body.slice(0, 300) : null);
  const message = [title, detail].filter(Boolean).join(': ') || `The Compliwa API answered ${status}`;
  return new Kind(message, {
    status,
    code: problem.code ?? null,
    title,
    detail,
    errors: Array.isArray(problem.errors) ? problem.errors : [],
    requestId,
    retryAfter,
    raw: body,
  });
}
