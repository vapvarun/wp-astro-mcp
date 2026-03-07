/**
 * Frontmatter Builder Service
 * Constructs Astro-compatible frontmatter from WordPress post data.
 * Handles SEO (Yoast/RankMath), ACF fields, custom taxonomies, reading time.
 */

import type {
  WPPost,
  AstroFrontmatter,
  SiteConfig,
  WPTerm,
} from '../types/index.js';

/**
 * Build complete Astro frontmatter from a WordPress post
 */
export function buildFrontmatter(
  post: WPPost,
  site: SiteConfig,
  options: {
    bodyText?: string;
    parentSlug?: string;
    fullPath?: string;
  } = {}
): AstroFrontmatter {
  const embedded = post._embedded;
  const author = embedded?.author?.[0];
  const featuredMedia = embedded?.['wp:featuredmedia']?.[0];
  const allTerms = embedded?.['wp:term']?.flat() || [];

  const categories = allTerms
    .filter((t: WPTerm) => t.taxonomy === 'category')
    .map((t: WPTerm) => ({ name: t.name, slug: t.slug }));

  const tags = allTerms
    .filter((t: WPTerm) => t.taxonomy === 'post_tag')
    .map((t: WPTerm) => ({ name: t.name, slug: t.slug }));

  // Custom taxonomies
  const customTaxonomies: Record<string, Array<{ name: string; slug: string }>> = {};
  const standardTaxonomies = ['category', 'post_tag'];
  for (const term of allTerms) {
    if (!standardTaxonomies.includes(term.taxonomy)) {
      if (!customTaxonomies[term.taxonomy]) {
        customTaxonomies[term.taxonomy] = [];
      }
      customTaxonomies[term.taxonomy].push({ name: term.name, slug: term.slug });
    }
  }

  // Word count and reading time from body text
  const bodyText = options.bodyText || stripHtml(post.content?.rendered || '');
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  // Excerpt — clean up
  const rawExcerpt = post.excerpt?.rendered || post.excerpt?.raw || '';
  const excerpt = stripHtml(rawExcerpt).trim();

  // SEO data
  const seo = buildSeoData(post, site);

  // Title — decode HTML entities
  const title = decodeHtmlEntities(post.title?.rendered || post.title?.raw || 'Untitled');

  const frontmatter: AstroFrontmatter = {
    title,
    slug: post.slug,
    date: post.date,
    modified: post.modified !== post.date ? post.modified : undefined,
    status: post.status,
    wpPostId: post.id,
    wpUrl: post.link,
    postType: post.type,
    wordCount,
    readingTime,
  };

  // Author
  if (author) {
    frontmatter.author = {
      name: author.name,
      id: author.id,
      slug: author.slug,
      avatar: author.avatar_urls?.['96'] || author.avatar_urls?.['48'],
    };
  }

  // Categories & tags
  if (categories.length > 0) frontmatter.categories = categories;
  if (tags.length > 0) frontmatter.tags = tags;

  // Custom taxonomies
  if (Object.keys(customTaxonomies).length > 0) {
    frontmatter.taxonomies = customTaxonomies;
  }

  // Excerpt
  if (excerpt) frontmatter.excerpt = excerpt;

  // Featured image
  if (featuredMedia) {
    frontmatter.featuredImage = {
      url: featuredMedia.source_url,
      alt: featuredMedia.alt_text || title,
      width: featuredMedia.media_details?.width,
      height: featuredMedia.media_details?.height,
    };
  }

  // SEO
  if (seo && Object.keys(seo).length > 0) {
    frontmatter.seo = seo;
  }

  // Post format, sticky, template
  if (post.format && post.format !== 'standard') frontmatter.format = post.format;
  if (post.sticky) frontmatter.sticky = true;
  if (post.template) frontmatter.template = post.template;

  // Draft flag
  if (post.status !== 'publish') frontmatter.draft = true;

  // Hierarchical post data
  if (post.parent) frontmatter.parent = post.parent;
  if (options.parentSlug) frontmatter.parentSlug = options.parentSlug;
  if (options.fullPath) frontmatter.fullPath = options.fullPath;
  if (post.menu_order) frontmatter.menuOrder = post.menu_order;

  // ACF fields
  if (post.acf && Object.keys(post.acf).length > 0) {
    frontmatter.acf = normalizeAcfFields(post.acf);
  }

  // Custom meta fields (excluding internal WP meta)
  if (post.meta && Object.keys(post.meta).length > 0) {
    const customFields = filterCustomMeta(post.meta);
    if (Object.keys(customFields).length > 0) {
      frontmatter.customFields = customFields;
    }
  }

  return frontmatter;
}

/**
 * Build SEO data from Yoast or RankMath
 */
function buildSeoData(
  post: WPPost,
  site: SiteConfig
): AstroFrontmatter['seo'] | undefined {
  const seoPlugin = site.seo_plugin;

  if (seoPlugin === 'yoast' && post.yoast_head_json) {
    const yoast = post.yoast_head_json;
    const seo: NonNullable<AstroFrontmatter['seo']> = {};

    if (yoast.title) seo.title = yoast.title;
    if (yoast.description) seo.description = yoast.description;
    if (yoast.canonical) seo.canonical = yoast.canonical;
    if (yoast.og_image?.[0]?.url) seo.ogImage = yoast.og_image[0].url;
    if (yoast.robots?.index === 'noindex') seo.noindex = true;

    return Object.keys(seo).length > 0 ? seo : undefined;
  }

  if (seoPlugin === 'rankmath' && post.rank_math_seo) {
    const rm = post.rank_math_seo;
    const seo: NonNullable<AstroFrontmatter['seo']> = {};

    if (rm.title) seo.title = rm.title;
    if (rm.description) seo.description = rm.description;
    if (rm.canonical_url) seo.canonical = rm.canonical_url;
    if (rm.og_image) seo.ogImage = rm.og_image;
    if (rm.focus_keyword) seo.focusKeyword = rm.focus_keyword;
    if (rm.robots?.includes('noindex')) seo.noindex = true;

    return Object.keys(seo).length > 0 ? seo : undefined;
  }

  return undefined;
}

/**
 * Normalize ACF fields for frontmatter
 * Converts WP-specific structures to clean data
 */
function normalizeAcfFields(acf: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(acf)) {
    // Skip internal ACF fields
    if (key.startsWith('_') || key.startsWith('field_')) continue;

    if (value === null || value === undefined || value === '' || value === false) continue;

    if (Array.isArray(value)) {
      // Repeater fields or relationship fields
      normalized[key] = value.map((item) => {
        if (item && typeof item === 'object' && 'ID' in item) {
          // Post object — extract essentials
          const post = item as Record<string, unknown>;
          return { wpId: post.ID, slug: post.post_name, title: post.post_title };
        }
        if (item && typeof item === 'object') {
          return normalizeAcfFields(item as Record<string, unknown>);
        }
        return item;
      });
    } else if (value && typeof value === 'object') {
      // Could be image, file, post object, or nested group
      const obj = value as Record<string, unknown>;
      if ('ID' in obj && 'url' in obj && 'mime_type' in obj) {
        // Image/file field
        normalized[key] = {
          url: obj.url,
          alt: obj.alt || '',
          width: obj.width,
          height: obj.height,
          title: obj.title,
        };
      } else if ('ID' in obj && 'post_name' in obj) {
        // Post object
        normalized[key] = { wpId: obj.ID, slug: obj.post_name, title: obj.post_title };
      } else {
        // Nested group
        normalized[key] = normalizeAcfFields(obj);
      }
    } else {
      normalized[key] = value;
    }
  }

  return normalized;
}

/**
 * Filter out internal WordPress meta keys
 */
function filterCustomMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const internal = [
    '_edit_last', '_edit_lock', '_wp_page_template', '_wp_old_slug',
    '_thumbnail_id', '_pingme', '_encloseme', '_trackbackme',
    '_elementor_data', '_elementor_edit_mode', '_elementor_version',
    '_elementor_css', '_elementor_page_settings', '_elementor_controls_usage',
    '_fl_builder_data', '_fl_builder_draft', '_fl_builder_enabled',
    '_bricks_page_content_2', 'ct_builder_shortcodes',
    '_yoast_wpseo_', '_aioseo_', 'rank_math_',
  ];

  const custom: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (internal.some((prefix) => key.startsWith(prefix))) continue;
    if (key.startsWith('_')) continue; // Skip all private meta by default
    if (value === '' || value === null || value === undefined) continue;
    custom[key] = value;
  }
  return custom;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8216;/g, '\u2018')
    .replace(/&#8220;/g, '\u201C')
    .replace(/&#8221;/g, '\u201D')
    .replace(/&#8211;/g, '\u2013')
    .replace(/&#8212;/g, '\u2014')
    .replace(/&#8230;/g, '\u2026')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

/**
 * Serialize frontmatter to YAML string (for Markdown file header)
 */
export function serializeFrontmatter(fm: AstroFrontmatter): string {
  const lines: string[] = ['---'];

  const addField = (key: string, value: unknown, indent = 0) => {
    const prefix = '  '.repeat(indent);
    if (value === undefined || value === null) return;

    if (typeof value === 'string') {
      // Escape strings that need quoting
      if (value.includes(':') || value.includes('#') || value.includes("'") || value.includes('"') || value.includes('\n') || value.startsWith('[') || value.startsWith('{') || value === '') {
        lines.push(`${prefix}${key}: ${JSON.stringify(value)}`);
      } else {
        lines.push(`${prefix}${key}: ${value}`);
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${prefix}${key}: ${value}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) return;
      if (typeof value[0] === 'object') {
        lines.push(`${prefix}${key}:`);
        for (const item of value) {
          const entries = Object.entries(item as Record<string, unknown>);
          if (entries.length > 0) {
            const [firstKey, firstVal] = entries[0];
            lines.push(`${prefix}  - ${firstKey}: ${formatScalar(firstVal)}`);
            for (const [k, v] of entries.slice(1)) {
              lines.push(`${prefix}    ${k}: ${formatScalar(v)}`);
            }
          }
        }
      } else {
        lines.push(`${prefix}${key}:`);
        for (const item of value) {
          lines.push(`${prefix}  - ${formatScalar(item)}`);
        }
      }
    } else if (typeof value === 'object') {
      lines.push(`${prefix}${key}:`);
      for (const [k, v] of Object.entries(value)) {
        addField(k, v, indent + 1);
      }
    }
  };

  // Output fields in a logical order
  const orderedKeys: (keyof AstroFrontmatter)[] = [
    'title', 'slug', 'date', 'modified', 'author', 'status', 'draft',
    'categories', 'tags', 'taxonomies', 'excerpt', 'featuredImage',
    'seo', 'format', 'sticky', 'template', 'readingTime', 'wordCount',
    'wpPostId', 'wpUrl', 'postType', 'parent', 'parentSlug', 'fullPath',
    'menuOrder', 'customFields', 'acf', 'password', 'conversionIssues',
  ];

  for (const key of orderedKeys) {
    if (key in fm) {
      addField(key, fm[key]);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

function formatScalar(value: unknown): string {
  if (typeof value === 'string') {
    if (value.includes(':') || value.includes('#') || value.includes("'") || value.includes('"') || value === '') {
      return JSON.stringify(value);
    }
    return value;
  }
  if (value === null || value === undefined) return '""';
  return String(value);
}
