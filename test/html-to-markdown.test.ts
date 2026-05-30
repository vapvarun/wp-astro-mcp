import { describe, it, expect } from 'vitest';
import { convertPost } from '../src/services/html-to-markdown.js';
import type { WPPost, SiteConfig, ConversionResult } from '../src/types/index.js';

// convertPost transitively calls rewriteContentLinks (link-rewriter), which
// reads an empty url_map from the in-memory DB configured in vitest.config.ts.
// No network, no real files.

function post(html: string, overrides: Partial<WPPost> = {}): WPPost {
  return {
    id: 1,
    date: '2026-01-01T00:00:00',
    date_gmt: '2026-01-01T00:00:00',
    modified: '2026-01-01T00:00:00',
    modified_gmt: '2026-01-01T00:00:00',
    slug: 'post',
    status: 'publish',
    type: 'post',
    link: 'https://example.com/post',
    title: { rendered: 'Title' },
    content: { rendered: html, protected: false },
    excerpt: { rendered: '', protected: false },
    author: 1,
    featured_media: 0,
    ...overrides,
  };
}

const site: SiteConfig = {
  id: 'site1',
  name: 'Site',
  url: 'https://example.com',
  username: 'admin',
  app_password: 'pw',
};

function convert(html: string, overrides: Partial<WPPost> = {}): ConversionResult {
  return convertPost(post(html, overrides), site);
}

function codes(result: ConversionResult): string[] {
  return result.issues.map((i) => i.code);
}

describe('convertPost — basic HTML→Markdown', () => {
  it('converts headings to ATX style', () => {
    const { body } = convert('<h2>Section Title</h2>');
    expect(body).toContain('## Section Title');
  });

  it('converts unordered lists with - bullets', () => {
    const { body } = convert('<ul><li>One</li><li>Two</li></ul>');
    // Turndown uses the configured "-" bullet marker (spacing may vary).
    expect(body).toMatch(/^-\s+One$/m);
    expect(body).toMatch(/^-\s+Two$/m);
  });

  it('converts ordered lists', () => {
    const { body } = convert('<ol><li>First</li><li>Second</li></ol>');
    expect(body).toMatch(/^1\.\s+First$/m);
    expect(body).toMatch(/^2\.\s+Second$/m);
  });

  it('converts links to inline Markdown', () => {
    const { body } = convert('<p>See <a href="https://other.com/page">the page</a></p>');
    expect(body).toContain('[the page](https://other.com/page)');
  });

  it('converts images to Markdown image syntax', () => {
    const { body } = convert('<p><img src="https://cdn.com/a.jpg" alt="An image" /></p>');
    expect(body).toContain('![An image](https://cdn.com/a.jpg)');
  });

  it('converts fenced code blocks and preserves language hint', () => {
    const { body } = convert('<pre class="wp-block-code"><code class="language-js">const x = 1;</code></pre>');
    expect(body).toContain('```js');
    expect(body).toContain('const x = 1;');
  });

  it('converts bold and emphasis', () => {
    const { body } = convert('<p><strong>bold</strong> and <em>italic</em></p>');
    expect(body).toContain('**bold**');
    expect(body).toContain('*italic*');
  });

  it('converts blockquotes', () => {
    const { body } = convert('<blockquote><p>A quote</p></blockquote>');
    expect(body).toContain('> A quote');
  });

  it('reports basic metrics (input/output size, ms)', () => {
    const result = convert('<p>hello world</p>');
    expect(result.inputSize).toBeGreaterThan(0);
    expect(result.outputSize).toBeGreaterThan(0);
    expect(result.conversionMs).toBeGreaterThanOrEqual(0);
    expect(result.frontmatter.wpPostId).toBe(1);
  });
});

describe('convertPost — empty content handling', () => {
  it('returns an EMPTY_CONTENT info issue and empty body for blank content', () => {
    const result = convert('   ');
    expect(result.body).toBe('');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ severity: 'info', code: 'EMPTY_CONTENT' });
    // frontmatter is still produced
    expect(result.frontmatter.wpPostId).toBe(1);
  });

  it('falls back to content.rendered when raw is absent (and converts)', () => {
    const p = post('<p>rendered body</p>');
    const result = convertPost(p, site);
    expect(result.body).toContain('rendered body');
  });
});

describe('convertPost — conversion issues reporting', () => {
  it('reports UNRESOLVED_SHORTCODES as a warning', () => {
    // self-closing unknown shortcode is reported unresolved by the resolver
    const result = convert('<p>[totally_unknown_xyz id="1" /]</p>');
    const issue = result.issues.find((i) => i.code === 'UNRESOLVED_SHORTCODES');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('warning');
    expect(issue!.message).toContain('totally_unknown_xyz');
  });

  it('reports CONTENT_LOST (error) when a long post collapses to almost nothing', () => {
    // Build content that sanitizes/strips to near-empty but is long originally.
    // A big block of disallowed/empty markup: many empty spans.
    const longEmpty = '<p></p>'.repeat(200); // > 500 chars, strips to nothing
    const html = '<div>' + longEmpty + '</div>';
    expect(html.length).toBeGreaterThan(500);
    const result = convert(html);
    const lost = result.issues.find((i) => i.code === 'CONTENT_LOST');
    expect(lost).toBeDefined();
    expect(lost!.severity).toBe('error');
  });

  it('attaches issues to frontmatter.conversionIssues when any exist', () => {
    const result = convert('<p>[totally_unknown_xyz id="1" /]</p>');
    expect(result.frontmatter.conversionIssues).toBeDefined();
    expect(result.frontmatter.conversionIssues!.some((i) => i.code === 'UNRESOLVED_SHORTCODES')).toBe(true);
  });

  it('clean content produces no warnings/errors (info-or-empty only)', () => {
    const result = convert('<h1>Hi</h1><p>This is a perfectly normal paragraph of text.</p>');
    const nonInfo = result.issues.filter((i) => i.severity !== 'info');
    expect(nonInfo).toHaveLength(0);
  });
});

describe('convertPost — internal link & media rewriting hooks', () => {
  // Regression: rewriteContentLinks now runs on the HTML BEFORE Turndown, so
  // internal links to the configured site URL are stripped to site-relative
  // paths (and date-permalink prefixes removed) in the final Markdown.
  it('rewrites internal links to site-relative paths', () => {
    const { body } = convert('<p><a href="https://example.com/about/">About</a></p>');
    expect(body).toContain('[About](/about)');
    expect(body).not.toContain('https://example.com/about');
  });

  it('leaves external links untouched', () => {
    const { body } = convert('<p><a href="https://external.org/x">Ext</a></p>');
    expect(body).toContain('https://external.org/x');
  });

  it('rewrites media domain when media_strategy=rewrite is configured', () => {
    const rewriteSite: SiteConfig = {
      ...site,
      export: { media_strategy: 'rewrite', media_domain: 'https://cdn.example.com' },
    };
    const result = convertPost(
      post('<p><img src="https://example.com/wp-content/uploads/2026/01/pic.jpg" alt="P" /></p>'),
      rewriteSite
    );
    expect(result.body).toContain('cdn.example.com/wp-content/uploads/2026/01/pic.jpg');
  });

  it('processes Gutenberg block comments out of the output', () => {
    const { body } = convert('<!-- wp:paragraph --><p>Gutenberg text</p><!-- /wp:paragraph -->');
    expect(body).toContain('Gutenberg text');
    expect(body).not.toContain('wp:paragraph');
  });

  it('strips page builder wrapper markup and reports PAGE_BUILDER_CLEANED', () => {
    const html = '<div class="elementor-widget-container"><p>Inner builder content</p></div>';
    const result = convert(html);
    expect(result.body).toContain('Inner builder content');
    expect(codes(result)).toContain('PAGE_BUILDER_CLEANED');
  });
});
