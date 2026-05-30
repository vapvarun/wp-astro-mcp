/**
 * Regression tests for content-writer.ts critical audit fixes.
 *
 *  C4 — Atomic JSON write + corrupt-backup. writePostToJson must:
 *        - write a valid JSON array that accumulates posts across calls;
 *        - when the existing collection file is CORRUPT, NOT silently wipe it to
 *          [] — instead rename it to a `.corrupt-*` sibling AND still persist the
 *          new post.
 *
 *  M6 — Slug collision. writePost: two DIFFERENT posts whose slugs sanitize +
 *        lowercase to the same string must produce TWO files (the newcomer gets a
 *        `-{id}` suffix), never overwriting. Re-writing the SAME post keeps a
 *        stable filename (idempotent).
 *
 * Real DB + config are redirected to throwaway temp paths (content-writer calls
 * registerUrlMapping → DB). convertPost runs for real, so WPPost inputs are
 * constructed from the actual type (only fields the pipeline reads).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { WPPost, SiteConfig } from '../src/types/index.js';

// Throwaway config + DB BEFORE importing source singletons.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wpastro-writer-'));
process.env.WP_ASTRO_CONFIG = path.join(tmpRoot, 'sites.json');
process.env.WP_ASTRO_DB = path.join(tmpRoot, 'wp-astro.db');

type WriterModule = typeof import('../src/services/content-writer.js');
let writePost: WriterModule['writePost'];
let writePostToJson: WriterModule['writePostToJson'];
let removePostFromJson: WriterModule['removePostFromJson'];

const site: SiteConfig = {
  id: 'writer-test',
  name: 'Writer Test',
  url: 'https://example.test',
  username: 'admin',
  app_password: 'pw',
  is_active: true,
};

// Minimal valid WPPost: only fields the convert + write pipeline reads.
function makePost(overrides: Partial<WPPost> & { id: number; slug: string }): WPPost {
  const { id, slug } = overrides;
  return {
    id,
    date: '2026-01-01T00:00:00',
    date_gmt: '2026-01-01T00:00:00',
    modified: '2026-01-01T00:00:00',
    modified_gmt: '2026-01-01T00:00:00',
    slug,
    status: 'publish',
    type: 'post',
    link: `https://example.test/${slug}/`,
    title: { rendered: `Title ${id}` },
    content: { rendered: `<p>Body of ${id}</p>`, protected: false },
    excerpt: { rendered: `<p>Excerpt ${id}</p>`, protected: false },
    author: 1,
    featured_media: 0,
    ...overrides,
  };
}

let outputDir: string;

beforeAll(async () => {
  const mod = await import('../src/services/content-writer.js');
  writePost = mod.writePost;
  writePostToJson = mod.writePostToJson;
  removePostFromJson = mod.removePostFromJson;
});

beforeEach(() => {
  // Fresh output dir per test so files never bleed across cases.
  outputDir = fs.mkdtempSync(path.join(tmpRoot, 'out-'));
  vi.restoreAllMocks();
});

// 'post' → collection dir 'blog' → JSON at src/data/blog.json
const jsonPathFor = (dir: string) => path.join(dir, 'src', 'data', 'blog.json');

describe('C4: atomic JSON write accumulates posts', () => {
  it('writing two posts yields a valid JSON array containing both', () => {
    writePostToJson(makePost({ id: 1, slug: 'first' }), site, outputDir);
    writePostToJson(makePost({ id: 2, slug: 'second' }), site, outputDir);

    const jsonPath = jsonPathFor(outputDir);
    expect(fs.existsSync(jsonPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    const ids = parsed.map((p: { wpPostId: number }) => p.wpPostId).sort();
    expect(ids).toEqual([1, 2]);
  });

  it('re-writing the same post upserts (does not duplicate)', () => {
    writePostToJson(makePost({ id: 7, slug: 'foo' }), site, outputDir);
    writePostToJson(
      makePost({ id: 7, slug: 'foo', title: { rendered: 'Updated' } }),
      site,
      outputDir
    );
    const parsed = JSON.parse(fs.readFileSync(jsonPathFor(outputDir), 'utf-8'));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Updated');
  });
});

describe('C4: corrupt collection file is backed up, not silently wiped', () => {
  it('pre-seeded CORRUPT json is renamed to .corrupt-* and the new post is still written', () => {
    const jsonPath = jsonPathFor(outputDir);
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    // Garbage that JSON.parse cannot read.
    fs.writeFileSync(jsonPath, '{ this is : not valid json ]]', 'utf-8');

    writePostToJson(makePost({ id: 42, slug: 'survivor' }), site, outputDir);

    // A backup sibling must exist preserving the original corrupt bytes.
    const dir = path.dirname(jsonPath);
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith('blog.json.corrupt-'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
    expect(fs.readFileSync(path.join(dir, backups[0]), 'utf-8')).toContain('not valid json');

    // The live file is valid JSON containing the new post (NOT an empty array,
    // and NOT the corrupt bytes).
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].wpPostId).toBe(42);
  });

  it('removePostFromJson on a corrupt file bails out (returns false) and does not write []', () => {
    const jsonPath = jsonPathFor(outputDir);
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, 'definitely { not ] json', 'utf-8');

    const removed = removePostFromJson(999, 'post', site, outputDir);
    expect(removed).toBe(false);

    // Original file moved to backup; live path must NOT be an empty-array file.
    const dir = path.dirname(jsonPath);
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith('blog.json.corrupt-'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
    if (fs.existsSync(jsonPath)) {
      expect(fs.readFileSync(jsonPath, 'utf-8').trim()).not.toBe('[]');
    }
  });
});

describe('M6: slug-collision produces distinct files', () => {
  it('two different posts with identical slugs do NOT overwrite (newcomer suffixed -{id})', () => {
    const r1 = writePost(makePost({ id: 100, slug: 'foo' }), site, outputDir);
    const r2 = writePost(makePost({ id: 200, slug: 'foo' }), site, outputDir);

    // First keeps the clean slug; second is disambiguated.
    expect(r1.slug).toBe('foo');
    expect(r2.slug).toBe('foo-200');
    expect(r1.outputPath).not.toBe(r2.outputPath);

    const f1 = path.join(outputDir, r1.outputPath);
    const f2 = path.join(outputDir, r2.outputPath);
    expect(fs.existsSync(f1)).toBe(true);
    expect(fs.existsSync(f2)).toBe(true);
    // Both files survive — no clobber.
    expect(fs.readFileSync(f1, 'utf-8')).toContain('wpPostId: 100');
    expect(fs.readFileSync(f2, 'utf-8')).toContain('wpPostId: 200');
  });

  it('case-only slug difference (Foo vs foo) still collides → two files', () => {
    const r1 = writePost(makePost({ id: 11, slug: 'Foo' }), site, outputDir);
    const r2 = writePost(makePost({ id: 22, slug: 'foo' }), site, outputDir);
    expect(r1.slug).toBe('foo');
    expect(r2.slug).toBe('foo-22');
    expect(fs.existsSync(path.join(outputDir, r1.outputPath))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, r2.outputPath))).toBe(true);
  });

  it('re-writing the SAME post keeps a stable (un-suffixed) filename', () => {
    const first = writePost(makePost({ id: 300, slug: 'stable' }), site, outputDir);
    const second = writePost(makePost({ id: 300, slug: 'stable' }), site, outputDir);
    expect(first.slug).toBe('stable');
    expect(second.slug).toBe('stable'); // not 'stable-300'
    expect(second.outputPath).toBe(first.outputPath);
    // Exactly one file on disk for this slug.
    const dir = path.dirname(path.join(outputDir, first.outputPath));
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('stable'));
    expect(files).toEqual(['stable.md']);
  });
});
