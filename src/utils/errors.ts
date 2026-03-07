/**
 * Custom error classes and response formatters
 */

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
 * Format a success response
 */
export function formatSuccessResponse(data: unknown): ToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
    isError: false,
  };
}
