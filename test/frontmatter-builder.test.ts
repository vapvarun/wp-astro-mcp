import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { buildFrontmatter, serializeFrontmatter } from '../src/services/frontmatter-builder.js';
import type { WPPost, SiteConfig, AstroFrontmatter } from '../src/types/index.js';

function basePost(overrides: Partial<WPPost> = {}): WPPost {
  return {
    id: 123,
    date: '2026-01-01T10:00:00',
    date_gmt: '2026-01-01T10:00:00',
    modified: '2026-01-02T10:00:00',
    modified_gmt: '2026-01-02T10:00:00',
    slug: 'hello-world',
    status: 'publish',
    type: 'post',
    link: 'https://example.com/hello-world',
    title: { rendered: 'Hello &amp; Welcome' },
    content: { rendered: '<p>Some words here for counting reading time.</p>', protected: false },
    excerpt: { rendered: '<p>The excerpt.</p>', protected: false },
    author: 1,
    featured_media: 0,
    ...overrides,
  };
}

function site(overrides: Partial<SiteConfig> = {}): SiteConfig {
  return {
    id: 'site1',
    name: 'Site One',
    url: 'https://example.com',
    username: 'admin',
    app_password: 'xxxx',
    ...overrides,
  };
}

/** Strip the leading/trailing `---` and parse the YAML body. */
function parseFrontmatter(serialized: string): Record<string, unknown> {
  const lines = serialized.split('\n');
  expect(lines[0]).toBe('---');
  expect(lines[lines.length - 1]).toBe('---');
  const inner = lines.slice(1, -1).join('\n');
  return parseYaml(inner) as Record<string, unknown>;
}

describe('buildFrontmatter — core fields', () => {
  it('emits wpPostId, title (decoded), slug, status, postType, wpUrl', () => {
    const fm = buildFrontmatter(basePost(), site());
    expect(fm.wpPostId).toBe(123);
    expect(fm.title).toBe('Hello & Welcome'); // &amp; decoded
    expect(fm.slug).toBe('hello-world');
    expect(fm.status).toBe('publish');
    expect(fm.postType).toBe('post');
    expect(fm.wpUrl).toBe('https://example.com/hello-world');
  });

  it('computes wordCount and readingTime (min 1) from body text', () => {
    const fm = buildFrontmatter(basePost(), site(), { bodyText: 'one two three four five' });
    expect(fm.wordCount).toBe(5);
    expect(fm.readingTime).toBe(1);
  });

  it('scales reading time with word count (~200 wpm)', () => {
    const body = Array.from({ length: 600 }, (_, i) => `w${i}`).join(' ');
    const fm = buildFrontmatter(basePost(), site(), { bodyText: body });
    expect(fm.wordCount).toBe(600);
    expect(fm.readingTime).toBe(3);
  });

  it('marks non-published posts as draft', () => {
    const fm = buildFrontmatter(basePost({ status: 'draft' }), site());
    expect(fm.draft).toBe(true);
    expect(fm.status).toBe('draft');
  });

  it('omits modified when equal to date', () => {
    const fm = buildFrontmatter(basePost({ modified: '2026-01-01T10:00:00' }), site());
    expect(fm.modified).toBeUndefined();
  });

  it('extracts categories/tags and custom taxonomies from embedded terms', () => {
    const fm = buildFrontmatter(
      basePost({
        _embedded: {
          'wp:term': [
            [
              { id: 1, name: 'News', slug: 'news', taxonomy: 'category' },
              { id: 2, name: 'TagA', slug: 'tag-a', taxonomy: 'post_tag' },
              { id: 3, name: 'Genre X', slug: 'genre-x', taxonomy: 'genre' },
            ],
          ],
        },
      }),
      site()
    );
    expect(fm.categories).toEqual([{ name: 'News', slug: 'news' }]);
    expect(fm.tags).toEqual([{ name: 'TagA', slug: 'tag-a' }]);
    expect(fm.taxonomies).toEqual({ genre: [{ name: 'Genre X', slug: 'genre-x' }] });
  });

  it('builds Yoast SEO data when seo_plugin=yoast', () => {
    const fm = buildFrontmatter(
      basePost({
        yoast_head_json: {
          title: 'SEO Title',
          description: 'SEO desc',
          canonical: 'https://example.com/canon',
          robots: { index: 'noindex' },
        } as WPPost['yoast_head_json'],
      }),
      site({ seo_plugin: 'yoast' })
    );
    expect(fm.seo).toMatchObject({
      title: 'SEO Title',
      description: 'SEO desc',
      canonical: 'https://example.com/canon',
      noindex: true,
    });
  });
});

describe('serializeFrontmatter — YAML escaping & round-trip', () => {
  it('quotes a title containing a colon, and it round-trips', () => {
    const fm = buildFrontmatter(basePost({ title: { rendered: 'Guide: Part One' } }), site());
    const out = serializeFrontmatter(fm);
    expect(out).toContain('title: "Guide: Part One"');
    expect(parseFrontmatter(out).title).toBe('Guide: Part One');
  });

  it('quotes a value containing a hash (#) so it is not read as a comment', () => {
    const fm = buildFrontmatter(basePost({ slug: 'a#b' }), site());
    const out = serializeFrontmatter(fm);
    const parsed = parseFrontmatter(out);
    expect(parsed.slug).toBe('a#b');
  });

  it('quotes a value containing double quotes and round-trips', () => {
    const fm = buildFrontmatter(basePost({ title: { rendered: 'She said "hi"' } }), site());
    const out = serializeFrontmatter(fm);
    expect(parseFrontmatter(out).title).toBe('She said "hi"');
  });

  it('quotes a value containing a single quote/apostrophe and round-trips', () => {
    const fm = buildFrontmatter(basePost({ excerpt: { rendered: "It's fine", protected: false } }), site());
    const out = serializeFrontmatter(fm);
    expect(parseFrontmatter(out).excerpt).toBe("It's fine");
  });

  it('quotes multiline strings via JSON encoding and round-trips', () => {
    // excerpt is stripHtml-normalized, so inject newline via a custom field instead.
    const fm = buildFrontmatter(basePost(), site());
    (fm as AstroFrontmatter).excerpt = 'line one\nline two';
    const out = serializeFrontmatter(fm);
    expect(out).toContain('excerpt: "line one\\nline two"');
    expect(parseFrontmatter(out).excerpt).toBe('line one\nline two');
  });

  it('emits wpPostId as a number and the whole document is valid YAML', () => {
    const fm = buildFrontmatter(basePost(), site());
    const out = serializeFrontmatter(fm);
    expect(out).toContain('wpPostId: 123');
    const parsed = parseFrontmatter(out);
    expect(parsed.wpPostId).toBe(123);
    expect(typeof parsed.readingTime).toBe('number');
  });

  it('serializes arrays-of-objects (categories) into valid, round-trippable YAML', () => {
    const fm = buildFrontmatter(
      basePost({
        _embedded: {
          'wp:term': [[{ id: 1, name: 'News', slug: 'news', taxonomy: 'category' }]],
        },
      }),
      site()
    );
    const parsed = parseFrontmatter(serializeFrontmatter(fm));
    expect(parsed.categories).toEqual([{ name: 'News', slug: 'news' }]);
  });

  it('emits conversionIssues when present and they round-trip', () => {
    const fm = buildFrontmatter(basePost(), site());
    fm.conversionIssues = [{ severity: 'warning', code: 'X', message: 'msg' }];
    const parsed = parseFrontmatter(serializeFrontmatter(fm));
    expect(Array.isArray(parsed.conversionIssues)).toBe(true);
    expect((parsed.conversionIssues as Array<Record<string, unknown>>)[0].code).toBe('X');
  });

  it('produces a parseable document for a richly-populated post', () => {
    const fm = buildFrontmatter(
      basePost({
        sticky: true,
        format: 'aside',
        menu_order: 5,
        _embedded: {
          author: [{ id: 7, name: 'Jane', slug: 'jane', avatar_urls: { '96': 'a.png' } }],
          'wp:featuredmedia': [
            { id: 9, source_url: 'https://example.com/img.jpg', alt_text: 'Alt', media_details: { width: 800, height: 600, file: 'img.jpg' }, mime_type: 'image/jpeg' },
          ],
        },
      }),
      site()
    );
    const parsed = parseFrontmatter(serializeFrontmatter(fm));
    expect((parsed.author as Record<string, unknown>).name).toBe('Jane');
    expect((parsed.featuredImage as Record<string, unknown>).url).toBe('https://example.com/img.jpg');
    expect(parsed.sticky).toBe(true);
    expect(parsed.menuOrder).toBe(5);
  });
});
