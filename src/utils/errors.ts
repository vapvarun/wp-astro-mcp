/**
 * Custom error classes and response formatters
 */

import { ZodError } from 'zod';
import type { ToolResponse } from '../types/index.js';

export class WPAstroError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'WPAstroError';
  }
}

export class SiteNotFoundError extends WPAstroError {
  constructor(siteId: string) {
    super(
      `Site not found: ${siteId}. Use site_list to see available sites.`,
      'SITE_NOT_FOUND',
      404
    );
    this.name = 'SiteNotFoundError';
  }
}

export class SiteConnectionError extends WPAstroError {
  constructor(siteId: string, reason: string) {
    super(
      `Cannot connect to site "${siteId}": ${reason}`,
      'SITE_CONNECTION_ERROR',
      503
    );
    this.name = 'SiteConnectionError';
  }
}

export class AuthenticationError extends WPAstroError {
  constructor(siteId: string) {
    super(
      `Authentication failed for site "${siteId}". Check username and app_password.`,
      'AUTH_ERROR',
      401
    );
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends WPAstroError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends WPAstroError {
  constructor(resource: string, id: string | number) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class ExportError extends WPAstroError {
  constructor(message: string, details?: unknown) {
    super(message, 'EXPORT_ERROR', 500, details);
    this.name = 'ExportError';
  }
}

export class RateLimitError extends WPAstroError {
  constructor(siteId: string, retryAfter?: number) {
    super(
      `Rate limited by site "${siteId}". ${retryAfter ? `Retry after ${retryAfter}s.` : ''}`,
      'RATE_LIMIT',
      429,
      { retryAfter }
    );
    this.name = 'RateLimitError';
  }
}

/**
 * Format an error into an MCP tool response
 */
export function formatErrorResponse(error: unknown): ToolResponse {
  // Zod validation errors → field-level messages so the model can self-correct.
  // This matters in router mode, where per-action schemas aren't visible up front.
  if (error instanceof ZodError) {
    const fieldErrors = error.issues.map((i) => ({
      field: i.path.join('.') || '(root)',
      message: i.message,
    }));
    const summary = fieldErrors
      .map((f) => `${f.field}: ${f.message}`)
      .join('; ');
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: true,
              code: 'VALIDATION_ERROR',
              message: `Invalid input — ${summary}`,
              details: fieldErrors,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  if (error instanceof WPAstroError) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: true,
              code: error.code,
              message: error.message,
              details: error.details,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  if (error instanceof Error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: true,
              code: 'UNKNOWN_ERROR',
              message: error.message,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            error: true,
            code: 'UNKNOWN_ERROR',
            message: String(error),
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

/**
 * Coerce any handler payload into the object that MCP `structuredContent`
 * requires. Plain objects pass through; arrays and scalars (which the protocol's
 * object schema rejects) are wrapped under a `result` key.
 */
function toStructuredContent(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { result: data };
}

/**
 * Format a success response. The JSON is returned both as a text block (for
 * clients/models that read prose) and as `structuredContent` (machine-readable,
 * per the 2025-06-18 MCP spec) so callers don't have to re-parse JSON out of text.
 */
export function formatSuccessResponse(data: unknown): ToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: toStructuredContent(data),
    isError: false,
  };
}
