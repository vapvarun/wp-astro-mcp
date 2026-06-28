/**
 * Registry coverage — the drift guard for the McpServer migration.
 *
 * Every first-class tool is registered with the Zod schema from
 * `tools/registry.ts`, and the SDK advertises the JSON Schema generated from it.
 * If a new tool is added without a registry entry it would silently fall back to
 * a no-params schema (validating nothing). These tests fail in that case, so the
 * single-source-of-truth invariant can't rot.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wpastro-registry-'));
process.env.WP_ASTRO_CONFIG = path.join(tmpRoot, 'sites.json');
process.env.WP_ASTRO_DB = path.join(tmpRoot, 'wp-astro.db');

let allTools: import('../src/tools/index.js')['allTools'];
let routerTools: import('../src/tools/router.js')['routerTools'];
let INPUT_SCHEMAS: import('../src/tools/registry.js')['INPUT_SCHEMAS'];
let ROUTER_INPUT_SCHEMAS: import('../src/tools/registry.js')['ROUTER_INPUT_SCHEMAS'];

beforeAll(async () => {
  ({ allTools } = await import('../src/tools/index.js'));
  ({ routerTools } = await import('../src/tools/router.js'));
  ({ INPUT_SCHEMAS, ROUTER_INPUT_SCHEMAS } = await import('../src/tools/registry.js'));
});

describe('registry coverage', () => {
  it('every first-class tool has an INPUT_SCHEMAS entry', () => {
    const missing = allTools
      .map((t) => t.name)
      .filter((name) => !(name in INPUT_SCHEMAS));
    expect(missing).toEqual([]);
  });

  it('every router tool has a ROUTER_INPUT_SCHEMAS entry', () => {
    const missing = routerTools
      .map((t) => t.name)
      .filter((name) => !(name in ROUTER_INPUT_SCHEMAS));
    expect(missing).toEqual([]);
  });

  it('INPUT_SCHEMAS has no orphan keys (every entry maps to a real tool)', () => {
    const toolNames = new Set(allTools.map((t) => t.name));
    const orphans = Object.keys(INPUT_SCHEMAS).filter((name) => !toolNames.has(name));
    expect(orphans).toEqual([]);
  });

  it('locks the registered tool count (update intentionally when adding tools)', () => {
    expect(allTools.length).toBe(57);
    expect(Object.keys(INPUT_SCHEMAS).length).toBe(57);
  });

  it('every registered schema is a usable Zod schema (has safeParse)', () => {
    for (const [name, schema] of Object.entries(INPUT_SCHEMAS)) {
      expect(typeof schema.safeParse, `${name} schema`).toBe('function');
    }
  });
});
