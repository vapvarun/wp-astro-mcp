/**
 * Scaffold smoke tests — guard the GENERATED Astro project against config that
 * Astro 5/6 rejects or that ships an XSS hole. The pre-existing suite covers the
 * TS conversion pipeline but never inspected the scaffolder's output, so an
 * `output: 'hybrid'`-class regression (which breaks `astro build` on every
 * deploy target) was invisible. These assertions lock in the 2026-06 fixes:
 *
 *   #1  no `output: 'hybrid'` (removed in Astro 5)
 *   #2  no malformed `experimental.fonts` block
 *   #3  Zod-4 `z.record(z.string(), z.unknown())` (two-arg form)
 *   #4  JSON-mode content is DOMPurify-sanitized before `set:html`
 *   #5  on-demand routes (hook/preview) only with an adapter + `prerender = false`
 *   #6  JSON-LD `set:html` escapes `<` to prevent `</script>` breakout
 *
 * Note: this asserts on generated file *contents* (fast, deterministic, runs in
 * CI without an Astro toolchain). A full `astro build` of a scaffold is the
 * stronger check but needs network + the Astro CLI; run it manually when
 * touching the scaffolder.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { SiteConfig, WPPost } from '../src/types/index.js';

// Throwaway config + DB BEFORE importing source singletons (content-writer →
// registerUrlMapping → DB).
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wpastro-scaffold-'));
process.env.WP_ASTRO_CONFIG = path.join(tmpRoot, 'sites.json');
process.env.WP_ASTRO_DB = path.join(tmpRoot, 'wp-astro.db');

type ScaffolderModule = typeof import('../src/services/astro-scaffolder.js');
type WriterModule = typeof import('../src/services/content-writer.js');
let scaffoldProject: ScaffolderModule['scaffoldProject'];
let sanitizeWpHtml: typeof import('../src/services/html-to-markdown.js')['sanitizeWpHtml'];
let writePostToJson: WriterModule['writePostToJson'];

function makeSite(overrides: Partial<SiteConfig> = {}): SiteConfig {
  return {
    id: 'scaffold-test',
    name: 'Scaffold Test',
    url: 'https://example.test',
    username: 'admin',
    app_password: 'pw',
    is_active: true,
    site_title: 'Scaffold Test',
    site_language: 'en',
    ...overrides,
  };
}

function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf-8');
}

beforeAll(async () => {
  ({ scaffoldProject } = await import('../src/services/astro-scaffolder.js'));
  ({ sanitizeWpHtml } = await import('../src/services/html-to-markdown.js'));
  ({ writePostToJson } = await import('../src/services/content-writer.js'));
});

describe('astro.config (Astro 5/6 validity)', () => {
  let dir: string;
  let config: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(tmpRoot, 'cf-'));
    scaffoldProject(makeSite({ export: { deploy_platform: 'cloudflare' } }), dir, true);
    config = read(dir, 'astro.config.mjs');
  });

  it('#1 does NOT emit output: hybrid (removed in Astro 5)', () => {
    expect(config).not.toContain('hybrid');
    expect(config).not.toMatch(/output:/);
  });

  it('keeps the adapter for a configured deploy platform', () => {
    expect(config).toContain('adapter: cloudflare()');
  });

  it('#2 does NOT emit a malformed experimental.fonts block', () => {
    expect(config).not.toContain('experimental');
    expect(config).not.toContain('family:');
    expect(config).not.toContain("provider: 'google'");
  });
});

describe('content.config.ts (Zod 4)', () => {
  it('#3 uses the two-argument z.record form', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'zod-'));
    scaffoldProject(makeSite(), dir, true);
    const content = read(dir, 'src/content.config.ts');
    expect(content).toContain('z.record(z.string(), z.unknown())');
    // The Zod-3-only single-arg form must be gone.
    expect(content).not.toContain('z.record(z.unknown())');
  });
});

describe('on-demand (SSR) routes', () => {
  it('#5 scaffolds hook + preview WITH an adapter, and hook opts out of prerender', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'ssr-'));
    scaffoldProject(makeSite({ export: { deploy_platform: 'vercel' } }), dir, true);
    const hookPath = path.join(dir, 'src/pages/api/hook.ts');
    expect(fs.existsSync(hookPath)).toBe(true);
    expect(fs.readFileSync(hookPath, 'utf-8')).toContain('export const prerender = false');
    expect(fs.existsSync(path.join(dir, 'src/pages/preview.astro'))).toBe(true);
  });

  it('#5 does NOT scaffold inert SSR routes without an adapter', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'noadapter-'));
    scaffoldProject(makeSite({ export: { deploy_platform: 'none' } }), dir, true);
    expect(fs.existsSync(path.join(dir, 'src/pages/api/hook.ts'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'src/pages/preview.astro'))).toBe(false);
  });
});

describe('JSON-LD injection', () => {
  it('#6 escapes < in the JSON-LD set:html to block </script> breakout', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'jsonld-'));
    scaffoldProject(makeSite(), dir, true);
    const base = read(dir, 'src/layouts/BaseLayout.astro');
    // Generated file must contain a literal `<` replacement (two
    // backslashes in the file → '\\\\u003c' in this test source).
    expect(base).toContain("replace(/</g, '\\\\u003c')");
  });
});

describe('JSON-mode content sanitization', () => {
  it('#4 strips scripts/handlers from rendered HTML before storing for set:html', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'jsonmode-'));
    const site = makeSite({ id: 'json-xss', export: { content_format: 'json' } });
    const malicious =
      '<p>ok</p><script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">x</a>';
    const post: WPPost = {
      id: 42,
      date: '2026-01-01T00:00:00',
      date_gmt: '2026-01-01T00:00:00',
      modified: '2026-01-01T00:00:00',
      modified_gmt: '2026-01-01T00:00:00',
      slug: 'xss-post',
      status: 'publish',
      type: 'post',
      link: 'https://example.test/xss-post/',
      title: { rendered: 'XSS Post' },
      content: { rendered: malicious, protected: false },
      excerpt: { rendered: '<p>x</p>', protected: false },
      author: 1,
      featured_media: 0,
    };

    writePostToJson(post, site, dir);
    const stored = read(dir, 'src/data/blog.json');
    expect(stored).not.toContain('<script');
    expect(stored).not.toContain('onerror');
    expect(stored).not.toContain('javascript:');
    // Benign content survives.
    expect(stored).toContain('ok');
  });

  it('sanitizeWpHtml is the shared allowlist used by both paths', () => {
    expect(sanitizeWpHtml('<script>alert(1)</script><p>hi</p>')).toBe('<p>hi</p>');
  });
});
