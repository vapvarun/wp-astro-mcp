/**
 * HTML-to-Markdown Conversion Pipeline
 * 13-step conversion using Turndown with custom WordPress-specific rules.
 *
 * Pipeline steps:
 * 1. Sanitize HTML (DOMPurify)
 * 2. Resolve shortcodes
 * 3. Clean page builder markup
 * 4. Process Gutenberg block comments
 * 5. Normalize HTML structure
 * 6. Convert to Markdown (Turndown + GFM)
 * 7. Rewrite internal links
 * 8. Rewrite media URLs
 * 9. Clean up Markdown artifacts
 * 10. Process embeds
 * 11. Handle galleries
 * 12. Fix whitespace and spacing
 * 13. Final validation
 */

import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import * as cheerio from 'cheerio';
import DOMPurify from 'isomorphic-dompurify';
import he from 'he';
const { decode } = he;

import type { WPPost, SiteConfig, ConversionResult, ConversionIssue } from '../types/index.js';
import { resolveShortcodes } from './shortcode-resolver.js';
import { rewriteContentLinks } from './link-rewriter.js';
import { buildFrontmatter, serializeFrontmatter } from './frontmatter-builder.js';

// Helper to safely get attribute from a Turndown node
function getAttr(node: TurndownService.Node, attr: string): string {
  if (node && typeof (node as unknown as Record<string, unknown>).getAttribute === 'function') {
    return ((node as unknown as { getAttribute(a: string): string | null }).getAttribute(attr)) || '';
  }
  return '';
}

function getClassName(node: TurndownService.Node): string {
  return getAttr(node, 'class');
}

function getTagName(node: TurndownService.Node): string {
  return ((node as unknown as { tagName?: string }).tagName || '').toUpperCase();
}

function querySelector(node: TurndownService.Node, selector: string): TurndownService.Node | null {
  if (typeof (node as unknown as Record<string, unknown>).querySelector === 'function') {
    return (node as unknown as { querySelector(s: string): TurndownService.Node | null }).querySelector(selector);
  }
  return null;
}

function querySelectorAll(node: TurndownService.Node, selector: string): TurndownService.Node[] {
  if (typeof (node as unknown as Record<string, unknown>).querySelectorAll === 'function') {
    const result = (node as unknown as { querySelectorAll(s: string): ArrayLike<TurndownService.Node> }).querySelectorAll(selector);
    return Array.from(result);
  }
  return [];
}

function getTextContent(node: TurndownService.Node): string {
  return (node as unknown as { textContent?: string }).textContent || '';
}

function getOuterHTML(node: TurndownService.Node): string {
  return (node as unknown as { outerHTML?: string }).outerHTML || '';
}

/**
 * Create a configured Turndown instance with WordPress-specific rules
 */
function createTurndownService(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full',
  });

  // Add GFM support (tables, strikethrough, task lists)
  td.use(gfm);

  // Rule: WordPress captions → figure/figcaption
  td.addRule('wpCaption', {
    filter: (node) => {
      return getTagName(node) === 'DIV' && getClassName(node).includes('wp-caption');
    },
    replacement: (_content, node) => {
      const img = querySelector(node, 'img');
      const captionEl = querySelector(node, '.wp-caption-text');
      if (!img) return _content;

      const src = getAttr(img, 'src');
      const captionText = captionEl ? getTextContent(captionEl) : '';
      const alt = getAttr(img, 'alt') || captionText;

      return captionText
        ? `\n![${alt}](${src})\n*${captionText}*\n`
        : `\n![${alt}](${src})\n`;
    },
  });

  // Rule: WordPress gallery → image grid
  td.addRule('wpGallery', {
    filter: (node) => {
      return getTagName(node) === 'DIV' && (
        getClassName(node).includes('gallery') ||
        getClassName(node).includes('wp-block-gallery')
      );
    },
    replacement: (_content, node) => {
      const images = querySelectorAll(node, 'img');
      const lines: string[] = ['\n'];
      for (const img of images) {
        const src = getAttr(img, 'src');
        const alt = getAttr(img, 'alt');
        lines.push(`![${alt}](${src})`);
      }
      lines.push('');
      return lines.join('\n');
    },
  });

  // Rule: figure with figcaption
  td.addRule('figure', {
    filter: 'figure',
    replacement: (_content, node) => {
      const img = querySelector(node, 'img');
      const figcaption = querySelector(node, 'figcaption');

      if (img) {
        const src = getAttr(img, 'src');
        const captionText = figcaption ? getTextContent(figcaption) : '';
        const alt = getAttr(img, 'alt') || captionText;
        return captionText
          ? `\n![${alt}](${src})\n*${captionText}*\n`
          : `\n![${alt}](${src})\n`;
      }

      // Non-image figure (video, embed, etc.)
      return `\n${_content}\n`;
    },
  });

  // Rule: WordPress buttons
  td.addRule('wpButton', {
    filter: (node) => {
      return getTagName(node) === 'DIV' && getClassName(node).includes('wp-block-button');
    },
    replacement: (_content, node) => {
      const link = querySelector(node, 'a');
      if (link) {
        const href = getAttr(link, 'href') || '#';
        const text = getTextContent(link) || 'Link';
        return `\n[${text}](${href})\n`;
      }
      return _content;
    },
  });

  // Rule: WordPress columns — flatten to sequential content
  td.addRule('wpColumns', {
    filter: (node) => {
      return getTagName(node) === 'DIV' && (
        getClassName(node).includes('wp-block-columns') ||
        getClassName(node).includes('wp-block-column')
      );
    },
    replacement: (content) => `\n${content}\n`,
  });

  // Rule: WordPress separator/spacer
  td.addRule('wpSeparator', {
    filter: (node) => {
      const tag = getTagName(node);
      return tag === 'HR' || (tag === 'DIV' && (
        getClassName(node).includes('wp-block-separator') ||
        getClassName(node).includes('wp-block-spacer')
      ));
    },
    replacement: () => '\n---\n',
  });

  // Rule: embed containers — extract iframe src or keep content
  td.addRule('embedContainer', {
    filter: (node) => {
      return getTagName(node) === 'DIV' && getClassName(node).includes('wp-block-embed');
    },
    replacement: (_content, node) => {
      const iframe = querySelector(node, 'iframe');
      if (iframe) {
        const src = getAttr(iframe, 'src');
        return `\n${src}\n`;
      }
      const figcaption = querySelector(node, 'figcaption');
      const caption = figcaption ? getTextContent(figcaption) : '';
      return caption ? `\n${_content}\n*${caption}*\n` : `\n${_content}\n`;
    },
  });

  // Rule: details/summary → keep as HTML
  td.addRule('details', {
    filter: 'details',
    replacement: (_content, node) => {
      const outerHtml = getOuterHTML(node) || `<details>${_content}</details>`;
      return `\n${outerHtml}\n`;
    },
  });

  // Rule: WordPress code block with language
  td.addRule('wpCodeBlock', {
    filter: (node) => {
      return getTagName(node) === 'PRE' && getClassName(node).includes('wp-block-code');
    },
    replacement: (_content, node) => {
      const code = querySelector(node, 'code');
      const text = code ? getTextContent(code) : getTextContent(node);
      const codeClass = code ? getAttr(code, 'class') : '';
      const langMatch = codeClass.match(/language-(\w+)/);
      const lang = langMatch ? langMatch[1] : '';
      return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
    },
  });

  // Rule: preserve iframes (YouTube, etc.)
  td.addRule('iframe', {
    filter: 'iframe',
    replacement: (_content, node) => {
      const src = getAttr(node, 'src');
      if (src.includes('youtube.com/embed/') || src.includes('youtu.be')) {
        const videoId = src.match(/embed\/([^?&]+)/)?.[1] || src;
        return `\nhttps://www.youtube.com/watch?v=${videoId}\n`;
      }
      if (src.includes('player.vimeo.com')) {
        const videoId = src.match(/video\/(\d+)/)?.[1] || src;
        return `\nhttps://vimeo.com/${videoId}\n`;
      }
      return `\n<iframe src="${src}"></iframe>\n`;
    },
  });

  // Remove empty links and spans
  td.addRule('emptyInline', {
    filter: (node) => {
      const tag = getTagName(node);
      return (tag === 'SPAN' || tag === 'A') &&
        !getTextContent(node).trim() && !querySelector(node, 'img');
    },
    replacement: () => '',
  });

  // Remove WordPress admin/editor artifacts
  td.addRule('wpArtifacts', {
    filter: (node) => {
      const className = getClassName(node);
      return className.includes('screen-reader-text') ||
        className.includes('wp-block-spacer') ||
        className.includes('sharedaddy') ||
        className.includes('jp-relatedposts');
    },
    replacement: () => '',
  });

  return td;
}

// Singleton turndown instance
let turndownInstance: TurndownService | null = null;
function getTurndown(): TurndownService {
  if (!turndownInstance) {
    turndownInstance = createTurndownService();
  }
  return turndownInstance;
}

/**
 * Main conversion pipeline: WordPress post → Markdown with frontmatter
 */
export function convertPost(
  post: WPPost,
  site: SiteConfig,
  options: {
    parentSlug?: string;
    fullPath?: string;
  } = {}
): ConversionResult {
  const startTime = Date.now();
  const issues: ConversionIssue[] = [];

  const rawHtml = post.content?.raw || post.content?.rendered || '';
  const inputSize = Buffer.byteLength(rawHtml, 'utf-8');

  if (!rawHtml.trim()) {
    const frontmatter = buildFrontmatter(post, site, options);
    const output = serializeFrontmatter(frontmatter) + '\n';
    return {
      frontmatter,
      body: '',
      issues: [{ severity: 'info', code: 'EMPTY_CONTENT', message: 'Post has no content' }],
      inputSize,
      outputSize: Buffer.byteLength(output, 'utf-8'),
      conversionMs: Date.now() - startTime,
    };
  }

  let html = rawHtml;

  // Step 1: Sanitize HTML
  html = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup',
      'a', 'img', 'figure', 'figcaption', 'picture', 'source', 'video', 'audio',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
      'blockquote', 'pre', 'code', 'kbd', 'samp', 'var',
      'div', 'span', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
      'details', 'summary',
      'iframe',
      'abbr', 'cite', 'q', 'time', 'address',
    ],
    ALLOWED_ATTR: [
      'href', 'src', 'alt', 'title', 'class', 'id', 'width', 'height',
      'target', 'rel', 'type', 'start', 'reversed',
      'colspan', 'rowspan', 'scope', 'headers',
      'loading', 'decoding', 'srcset', 'sizes',
      'controls', 'autoplay', 'loop', 'muted', 'poster', 'preload',
      'datetime', 'data-src', 'data-srcset',
      'allow', 'allowfullscreen', 'frameborder',
      'open',
    ],
    ALLOW_DATA_ATTR: false,
  });

  // Step 2: Resolve shortcodes
  const shortcodeResult = resolveShortcodes(html, site.id);
  html = shortcodeResult.content;
  if (shortcodeResult.unresolved.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'UNRESOLVED_SHORTCODES',
      message: `Unresolved shortcodes: ${shortcodeResult.unresolved.join(', ')}`,
      context: shortcodeResult.unresolved.join(', '),
    });
  }

  // Step 3: Clean page builder markup
  html = cleanPageBuilderMarkup(html, issues);

  // Step 4: Process Gutenberg block comments
  html = processGutenbergComments(html);

  // Step 5: Normalize HTML structure
  html = normalizeHtml(html);

  // Step 6: Convert to Markdown
  const td = getTurndown();
  let markdown = td.turndown(html);

  // Step 7 & 8: Rewrite links and media URLs
  const linkResult = rewriteContentLinks(markdown, site);
  markdown = linkResult.content;

  // Step 9: Clean up Markdown artifacts
  markdown = cleanMarkdownArtifacts(markdown);

  // Step 10: Process embeds
  markdown = processEmbeds(markdown);

  // Step 12: Fix whitespace
  markdown = fixWhitespace(markdown);

  // Step 13: Final validation
  const validationIssues = validateMarkdown(markdown, post);
  issues.push(...validationIssues);

  // Build frontmatter
  const frontmatter = buildFrontmatter(post, site, {
    ...options,
    bodyText: markdown,
  });

  if (issues.length > 0) {
    frontmatter.conversionIssues = issues;
  }

  const fullOutput = serializeFrontmatter(frontmatter) + '\n' + markdown;

  return {
    frontmatter,
    body: markdown,
    issues,
    inputSize,
    outputSize: Buffer.byteLength(fullOutput, 'utf-8'),
    conversionMs: Date.now() - startTime,
  };
}

/**
 * Step 3: Clean page builder markup — strip wrapper divs, keep content
 */
function cleanPageBuilderMarkup(html: string, issues: ConversionIssue[]): string {
  // Elementor wrapper classes
  const elementorClasses = [
    'elementor-section', 'elementor-column', 'elementor-widget-container',
    'elementor-widget-wrap', 'elementor-element', 'elementor-container',
    'elementor-row',
  ];

  // WPBakery classes
  const wpbakeryClasses = [
    'vc_row', 'vc_column', 'vc_column_inner', 'wpb_wrapper',
    'wpb_text_column', 'vc_row-fluid',
  ];

  // Divi classes
  const diviClasses = [
    'et_pb_section', 'et_pb_row', 'et_pb_column', 'et_pb_module',
    'et_pb_text_inner',
  ];

  const allBuilderClasses = [...elementorClasses, ...wpbakeryClasses, ...diviClasses];

  // Check if any builder classes exist before loading cheerio
  const hasBuilder = allBuilderClasses.some((cls) => html.includes(cls));
  if (!hasBuilder) return html;

  const $ = cheerio.load(html);
  let cleaned = false;

  // Unwrap builder wrapper divs (keep inner content)
  for (const cls of allBuilderClasses) {
    const elements = $(`.${cls}`);
    if (elements.length > 0) {
      elements.each(function () {
        // Use 'this' context from cheerio each callback
        const el = $(this);
        el.replaceWith(el.html() || '');
      });
      cleaned = true;
    }
  }

  if (cleaned) {
    issues.push({
      severity: 'info',
      code: 'PAGE_BUILDER_CLEANED',
      message: 'Page builder wrapper markup stripped, content preserved',
    });
  }

  return $.html() || html;
}

/**
 * Step 4: Process Gutenberg block comments
 */
function processGutenbergComments(html: string): string {
  html = html.replace(/<!--\s*wp:[a-z][a-z0-9-/]*\s*(\{[^}]*\})?\s*-->/g, '');
  html = html.replace(/<!--\s*\/wp:[a-z][a-z0-9-/]*\s*-->/g, '');
  return html;
}

/**
 * Step 5: Normalize HTML before conversion
 */
function normalizeHtml(html: string): string {
  html = decode(html);
  html = html.replace(/<p>\s*<\/p>/gi, '');
  html = html.replace(/<p>&nbsp;<\/p>/gi, '');
  html = html.replace(/(<br\s*\/?>){2,}/gi, '</p><p>');
  html = html.replace(/\s*style="[^"]*"/gi, '');
  html = html.replace(/\s*class=""/g, '');
  html = html.replace(/\s+>/g, '>');
  return html;
}

/**
 * Step 9: Clean up Markdown artifacts
 */
function cleanMarkdownArtifacts(md: string): string {
  md = md.replace(/\n{4,}/g, '\n\n\n');

  md = md.replace(/\\([[\]()#*+\-.!_{}|`~>])/g, (match, char) => {
    if ('[]()'.includes(char as string)) return match;
    return char as string;
  });

  md = md.replace(/<!--\s*(?!Component:|Contact Form:|shortcode:)[^>]*?-->/g, '');
  md = md.replace(/&amp;(#?\w+;)/g, '&$1');

  return md;
}

/**
 * Step 10: Process embed URLs (kept as-is for Astro to handle)
 */
function processEmbeds(md: string): string {
  return md;
}

/**
 * Step 12: Fix whitespace and spacing
 */
function fixWhitespace(md: string): string {
  md = md.replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2');
  md = md.replace(/(#{1,6}\s[^\n]+)\n([^\n#])/g, '$1\n\n$2');
  md = md.replace(/([^\n\-*\d])\n([-*]\s)/g, '$1\n\n$2');
  md = md.replace(/([^\n])\n(```)/g, '$1\n\n$2');
  md = md.replace(/(```)\n([^\n])/g, '$1\n\n$2');
  md = md.replace(/([^\n>])\n(>\s)/g, '$1\n\n$2');
  md = md.replace(/[ \t]+$/gm, '');
  md = md.replace(/\n*$/, '\n');
  return md;
}

/**
 * Step 13: Validate final Markdown
 */
function validateMarkdown(md: string, post: WPPost): ConversionIssue[] {
  const issues: ConversionIssue[] = [];

  const remainingHtml = md.match(/<(?!details|summary|iframe|audio|video|source|br\s*\/?>)[a-z][^>]*>/gi);
  if (remainingHtml && remainingHtml.length > 3) {
    issues.push({
      severity: 'warning',
      code: 'REMAINING_HTML',
      message: `${remainingHtml.length} HTML tags remain in Markdown output`,
      context: remainingHtml.slice(0, 5).join(', '),
    });
  }

  const brokenImages = md.match(/!\[([^\]]*)\]\(\s*\)/g);
  if (brokenImages) {
    issues.push({
      severity: 'warning',
      code: 'BROKEN_IMAGES',
      message: `${brokenImages.length} images with empty src`,
    });
  }

  const brokenLinks = md.match(/\[([^\]]+)\]\(\s*\)/g);
  if (brokenLinks) {
    issues.push({
      severity: 'warning',
      code: 'BROKEN_LINKS',
      message: `${brokenLinks.length} links with empty href`,
    });
  }

  const originalLength = (post.content?.rendered || '').length;
  if (originalLength > 500 && md.trim().length < 50) {
    issues.push({
      severity: 'error',
      code: 'CONTENT_LOST',
      message: 'Converted content is much shorter than original — possible conversion failure',
      context: `Original: ${originalLength} chars, Output: ${md.trim().length} chars`,
    });
  }

  return issues;
}
