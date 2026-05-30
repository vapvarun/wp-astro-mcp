import { describe, it, expect } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  annotateTool,
  TOOL_CATEGORIES,
  PROMOTED_ACTIONS,
  READ_ONLY_ACTIONS,
  DESTRUCTIVE_ACTIONS,
} from '../src/tools/metadata.js';

function tool(name: string, annotations?: Tool['annotations']): Tool {
  return { name, description: `desc ${name}`, inputSchema: { type: 'object' }, annotations };
}

describe('annotateTool — read-only classification', () => {
  it('stamps readOnlyHint:true on read-only actions and never destructiveHint', () => {
    for (const name of ['site_list', 'extract_posts', 'convert_post', 'sync_check', 'content_audit']) {
      const a = annotateTool(tool(name)).annotations!;
      expect(a.readOnlyHint).toBe(true);
      expect(a.destructiveHint).toBeUndefined();
    }
  });

  it('every action in READ_ONLY_ACTIONS gets readOnlyHint:true', () => {
    for (const name of READ_ONLY_ACTIONS) {
      expect(annotateTool(tool(name)).annotations!.readOnlyHint).toBe(true);
    }
  });
});

describe('annotateTool — destructive classification', () => {
  const destructive = ['sync_delete', 'sync_reset', 'export_cleanup', 'sync_full', 'site_remove', 'media_rewrite'];

  it('flags destructive actions with destructiveHint:true and readOnlyHint:false', () => {
    for (const name of destructive) {
      const a = annotateTool(tool(name)).annotations!;
      expect(a.destructiveHint).toBe(true);
      expect(a.readOnlyHint).toBe(false);
    }
  });

  it('all expected destructive actions are present in DESTRUCTIVE_ACTIONS', () => {
    for (const name of destructive) {
      expect(DESTRUCTIVE_ACTIONS.has(name)).toBe(true);
    }
  });

  it('no action is both read-only and destructive in the source sets', () => {
    for (const name of DESTRUCTIVE_ACTIONS) {
      expect(READ_ONLY_ACTIONS.has(name)).toBe(false);
    }
  });
});

describe('annotateTool — neutral / promoted', () => {
  it('a non-read-only, non-destructive action gets readOnlyHint:false and no destructiveHint', () => {
    const a = annotateTool(tool('github_push')).annotations!;
    expect(a.readOnlyHint).toBe(false);
    expect(a.destructiveHint).toBeUndefined();
  });

  it('promoted tools that have a configured title receive that title', () => {
    // sync_full is promoted AND destructive AND titled — title must survive.
    const a = annotateTool(tool('sync_full')).annotations!;
    expect(a.title).toBe('Full sync');
    expect(a.destructiveHint).toBe(true);
    expect(a.readOnlyHint).toBe(false);
  });

  it('a read-only promoted tool keeps its title and read-only hint', () => {
    const a = annotateTool(tool('site_list')).annotations!;
    expect(a.title).toBe('List sites');
    expect(a.readOnlyHint).toBe(true);
  });

  it('does not invent a title for an un-titled action', () => {
    expect(annotateTool(tool('extract_posts')).annotations!.title).toBeUndefined();
  });

  it('is non-mutating and preserves pre-existing annotations', () => {
    const original = tool('site_list', { idempotentHint: true });
    const snapshot = JSON.stringify(original);
    const out = annotateTool(original);
    expect(JSON.stringify(original)).toBe(snapshot); // input untouched
    expect(out).not.toBe(original);
    expect(out.annotations!.idempotentHint).toBe(true);
    expect(out.annotations!.readOnlyHint).toBe(true);
  });
});

describe('TOOL_CATEGORIES (derived from real tool arrays)', () => {
  it('is non-empty and every category has at least one tool', () => {
    const keys = Object.keys(TOOL_CATEGORIES);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(Array.isArray(TOOL_CATEGORIES[k])).toBe(true);
      expect(TOOL_CATEGORIES[k].length).toBeGreaterThan(0);
    }
  });

  it('contains the expected category groups', () => {
    for (const k of ['site', 'extract', 'transform', 'output', 'github', 'export', 'sync', 'wizard']) {
      expect(TOOL_CATEGORIES).toHaveProperty(k);
    }
  });

  it('every promoted action exists in some category', () => {
    const all = new Set(Object.values(TOOL_CATEGORIES).flat());
    for (const action of PROMOTED_ACTIONS) {
      expect(all.has(action)).toBe(true);
    }
  });

  it('every read-only and destructive action exists in some category', () => {
    const all = new Set(Object.values(TOOL_CATEGORIES).flat());
    for (const name of [...READ_ONLY_ACTIONS, ...DESTRUCTIVE_ACTIONS]) {
      expect(all.has(name)).toBe(true);
    }
  });
});
