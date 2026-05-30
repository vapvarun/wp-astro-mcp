import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  formatErrorResponse,
  formatSuccessResponse,
  WPAstroError,
  SiteNotFoundError,
  ValidationError,
} from '../src/utils/errors.js';

/** Parse a failing schema to obtain a real ZodError. */
function makeZodError() {
  const schema = z.object({
    site_id: z.string(),
    count: z.number().int().positive(),
  });
  const result = schema.safeParse({ count: -1 });
  expect(result.success).toBe(false);
  if (result.success) throw new Error('unreachable');
  return result.error;
}

/** Pull the parsed JSON payload out of an MCP tool response. */
function payload(resp: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(resp.content[0].text);
}

describe('formatErrorResponse', () => {
  it('maps a ZodError to VALIDATION_ERROR with field-level details', () => {
    const resp = formatErrorResponse(makeZodError());
    expect(resp.isError).toBe(true);
    expect(resp.content[0].type).toBe('text');

    const body = payload(resp);
    expect(body.error).toBe(true);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.details)).toBe(true);
    // missing required string `site_id` + invalid `count` => 2 field issues
    expect(body.details.length).toBeGreaterThanOrEqual(2);
    for (const d of body.details) {
      expect(typeof d.field).toBe('string');
      expect(typeof d.message).toBe('string');
    }
    const fields = body.details.map((d: { field: string }) => d.field);
    expect(fields).toContain('site_id');
    expect(fields).toContain('count');
    expect(body.message).toContain('Invalid input');
  });

  it('uses "(root)" as field name for top-level (empty path) issues', () => {
    // A schema whose root fails type validation produces an empty path.
    const schema = z.string();
    const r = schema.safeParse(123);
    expect(r.success).toBe(false);
    if (r.success) throw new Error('unreachable');
    const body = payload(formatErrorResponse(r.error));
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details[0].field).toBe('(root)');
  });

  it('preserves the code of a WPAstroError and includes its details', () => {
    const err = new WPAstroError('boom', 'CUSTOM_CODE', 500, { extra: 'x' });
    const body = payload(formatErrorResponse(err));
    expect(body.error).toBe(true);
    expect(body.code).toBe('CUSTOM_CODE');
    expect(body.message).toBe('boom');
    expect(body.details).toEqual({ extra: 'x' });
  });

  it('preserves the code of a WPAstroError subclass', () => {
    const body = payload(formatErrorResponse(new SiteNotFoundError('blog')));
    expect(body.code).toBe('SITE_NOT_FOUND');
    expect(body.message).toContain('blog');
  });

  it('a ValidationError subclass keeps VALIDATION_ERROR code (not treated as ZodError)', () => {
    const body = payload(formatErrorResponse(new ValidationError('bad', [{ field: 'x' }])));
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details).toEqual([{ field: 'x' }]);
  });

  it('maps a plain Error to UNKNOWN_ERROR with its message', () => {
    const body = payload(formatErrorResponse(new Error('plain failure')));
    expect(body.error).toBe(true);
    expect(body.code).toBe('UNKNOWN_ERROR');
    expect(body.message).toBe('plain failure');
  });

  it('maps a non-Error thrown value to UNKNOWN_ERROR with String() message', () => {
    const body = payload(formatErrorResponse('just a string'));
    expect(body.code).toBe('UNKNOWN_ERROR');
    expect(body.message).toBe('just a string');
  });
});

describe('formatSuccessResponse', () => {
  it('wraps data as JSON text content with isError:false', () => {
    const resp = formatSuccessResponse({ ok: true, items: [1, 2, 3] });
    expect(resp.isError).toBe(false);
    expect(resp.content).toHaveLength(1);
    expect(resp.content[0].type).toBe('text');
    expect(payload(resp)).toEqual({ ok: true, items: [1, 2, 3] });
  });

  it('pretty-prints the JSON (2-space indent)', () => {
    const resp = formatSuccessResponse({ a: 1 });
    expect(resp.content[0].text).toContain('\n  "a": 1');
  });
});
