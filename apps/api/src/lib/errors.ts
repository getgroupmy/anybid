export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    override readonly message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
  toJSON() {
    return {
      statusCode: this.statusCode,
      error: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Sign in to continue') =>
  new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have access to this') =>
  new HttpError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, 'CONFLICT', message, details);
export const unprocessable = (message: string, details?: unknown) =>
  new HttpError(422, 'UNPROCESSABLE', message, details);
export const tooMany = (message = 'Slow down — too many requests') =>
  new HttpError(429, 'RATE_LIMITED', message);
