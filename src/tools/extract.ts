/**
 * Content Extraction Tools
 * Fetch posts, pages, CPTs, terms, authors, media, menus, widgets,
 * comments, settings from WordPress REST API.
 * Also: cache terms/authors to SQLite, content audit.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { siteManager } from '../config/sites.js';
import { wpClient } from '../services/wp-rest-client.js';
import { database } from '../config/database.js';
import { analyzeContent, aggregateAnalysis } from '../services/content-analyzer.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';
import {
  extractPostsSchema,
  extractPostSchema,
  extractTermsSchema,
  extractAuthorsSchema,
  extractMediaSchema,
  extractMenusSchema,
  extractCommentsSchema,
  extractSettingsSchema,
  extractWidgetsSchema,
  cacheTermsSchema,
  cacheAuthorsSchema,
  extractAllIdsSchema,
  contentAuditSchema,
} from '../schemas/extract.js';
import logger from '../utils/logger.js';

export const extractTools: Tool[] = [
  {
    name: 'extract_posts',
    description:
      'Fetch posts from WordPress with pagination. Supports any post type, status filters, date filters. Returns posts with embedded author, featured image, and terms.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        post_type: { type: 'string', description: 'Post type slug (default: post)' },
        page: { type: 'number', description: 'Page number' },
        per_page: { type: 'number', description: 'Posts per page (max 100)' },
        status: { type: 'string', description: 'Status filter (publish, draft, any)' },
        after: { type: 'string', description: 'After date (ISO 8601)' },
        before: { type: 'string', description: 'Before date (ISO 8601)' },
        search: { type: 'string', description: 'Search query' },
        fields: { type: 'string', description: 'Comma-separated fields to return' },
      },
    },
  },
  {
    name: 'extract_post',
    description:
      'Fetch a single post by ID with full content (edit context), embedded data, and content analysis (shortcodes, blocks, page builder detection).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        post_id: { type: 'number', description: 'WordPress post ID' },
        post_type: { type: 'string', description: 'Post type slug (default: post)' },
      },
      required: ['post_id'],
    },
  },
  {
    name: 'extract_all_ids',
    description:
      'Fetch all post IDs for a post type (lightweight). Used for two-phase fetch strategy on large sites.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        post_type: { type: 'string', description: 'Post type slug (default: post)' },
        status: { type: 'string', description: 'Post status (default: any)' },
      },
    },
  },
  {
    name: 'extract_terms',
    description: 'Fetch taxonomy terms (categories, tags, or custom taxonomies) with pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        taxonomy: { type: 'string', description: 'Taxonomy slug (default: category)' },
        page: { type: 'number', description: 'Page number' },
        per_page: { type: 'number', description: 'Per page (max 100)' },
      },
    },
  },
  {
    name: 'extract_authors',
    description: 'Fetch all authors/users from the site.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
      },
    },
  },
  {
    name: 'extract_media',
    description: 'Fetch media items. Either a specific item by ID or paginated list.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        media_id: { type: 'number', description: 'Specific media ID' },
        page: { type: 'number', description: 'Page number' },
        per_page: { type: 'number', description: 'Per page (max 100)' },
      },
    },
  },
  {
    name: 'extract_menus',
    description: 'Fetch navigation menus and menu items. Works with WP 5.9+ navigation blocks and classic menus.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
      },
    },
  },
  {
    name: 'extract_comments',
    description: 'Fetch approved comments, optionally filtered by post ID.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        post_id: { type: 'number', description: 'Filter by post ID' },
        page: { type: 'number', description: 'Page number' },
        per_page: { type: 'number', description: 'Per page (max 100)' },
      },
    },
  },
  {
    name: 'extract_settings',
    description: 'Fetch site settings (title, tagline, timezone, date/time formats, permalink structure, language).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
      },
    },
  },
  {
    name: 'extract_widgets',
    description: 'Fetch sidebar/widget areas and their widgets (WP 5.8+).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
      },
    },
  },
  {
    name: 'cache_terms',
    description:
      'Fetch ALL terms for ALL taxonomies and cache them in SQLite. Should be run before a full export for fast term lookups.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
      },
    },
  },
  {
    name: 'cache_authors',
    description:
      'Fetch ALL authors and cache them in SQLite. Should be run before a full export for fast author lookups.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
      },
    },
  },
  {
    name: 'content_audit',
    description:
      'Sample posts and analyze content patterns: detect shortcodes, Gutenberg blocks, page builders, embeds, galleries, tables, forms, complexity distribution. Essential for planning migration.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        sample_size: { type: 'number', description: 'Number of posts to sample (default: 10, max: 50)' },
      },
    },
  },
];

export const extractHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
  extract_posts: async (params: unknown) => {
    try {
      const parsed = extractPostsSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);

      // Resolve rest_base from post_type
      const postType = parsed.post_type || 'post';
      const ptInfo = site.post_types?.find((pt) => pt.slug === postType);
      const restBase = ptInfo?.rest_base || (postType === 'post' ? 'posts' : postType === 'page' ? 'pages' : postType);

      const { posts, pagination } = await wpClient.fetchPosts(siteId, {
        restBase,
        page: parsed.page,
        perPage: parsed.per_page,
        status: parsed.status,
        after: parsed.after,
        before: parsed.before,
        fields: parsed.fields,
      });

      // Slim down response — strip raw HTML for listing
      const slimPosts = posts.map((p) => ({
        id: p.id,
        title: p.title?.rendered,
        slug: p.slug,
        status: p.status,
        date: p.date,
        modified: p.modified,
        type: p.type,
        link: p.link,
        author: p._embedded?.author?.[0]?.name || p.author,
        featured_image: p._embedded?.['wp:featuredmedia']?.[0]?.source_url || null,
        categories: p._embedded?.['wp:term']?.[0]?.map((t) => t.name) || [],
        tags: p._embedded?.['wp:term']?.[1]?.map((t) => t.name) || [],
        excerpt: p.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim().substring(0, 200),
      }));

      return formatSuccessResponse({
        site_id: siteId,
        post_type: postType,
        posts: slimPosts,
        pagination,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  extract_post: async (params: unknown) => {
    try {
      const parsed = extractPostSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);

      const postType = parsed.post_type || 'post';
      const ptInfo = site.post_types?.find((pt) => pt.slug === postType);
      const restBase = ptInfo?.rest_base || (postType === 'post' ? 'posts' : postType === 'page' ? 'pages' : postType);

      const post = await wpClient.fetchPost(siteId, parsed.post_id, restBase);

      // Analyze content
      const analysis = analyzeContent(post);

      // Extract embedded data
      const author = post._embedded?.author?.[0];
      const featuredMedia = post._embedded?.['wp:featuredmedia']?.[0];
      const terms = post._embedded?.['wp:term']?.flat() || [];

      return formatSuccessResponse({
        site_id: siteId,
        post: {
          id: post.id,
          title: post.title,
          slug: post.slug,
          status: post.status,
          date: post.date,
          modified: post.modified,
          type: post.type,
          link: post.link,
          format: post.format,
          sticky: post.sticky,
          template: post.template,
          parent: post.parent,
          menu_order: post.menu_order,
          content_raw: post.content?.raw || null,
          content_rendered: post.content?.rendered,
          excerpt: post.excerpt,
          author: author
            ? { id: author.id, name: author.name, slug: author.slug }
            : { id: post.author },
          featured_image: featuredMedia
            ? {
                id: featuredMedia.id,
                url: featuredMedia.source_url,
                alt: featuredMedia.alt_text,
                width: featuredMedia.media_details?.width,
                height: featuredMedia.media_details?.height,
              }
            : null,
          categories: terms.filter((t) => t.taxonomy === 'category').map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
          tags: terms.filter((t) => t.taxonomy === 'post_tag').map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
          custom_taxonomies: terms.filter((t) => !['category', 'post_tag'].includes(t.taxonomy)),
          meta: post.meta,
          acf: post.acf,
          yoast: post.yoast_head_json,
          rank_math: post.rank_math_seo,
        },
        content_analysis: analysis,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  extract_all_ids: async (params: unknown) => {
    try {
      const parsed = extractAllIdsSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);

      const postType = parsed.post_type || 'post';
      const ptInfo = site.post_types?.find((pt) => pt.slug === postType);
      const restBase = ptInfo?.rest_base || (postType === 'post' ? 'posts' : postType === 'page' ? 'pages' : postType);

      const ids = await wpClient.fetchAllPostIds(siteId, restBase, parsed.status || 'any');

      return formatSuccessResponse({
        site_id: siteId,
        post_type: postType,
        total: ids.length,
        ids,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  extract_terms: async (params: unknown) => {
    try {
      const parsed = extractTermsSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);

      const taxonomy = parsed.taxonomy || 'category';
      const taxInfo = site.taxonomies?.find((t) => t.slug === taxonomy);
      const restBase = taxInfo?.rest_base || taxonomy;

      const { terms, pagination } = await wpClient.fetchTerms(
        siteId,
        restBase,
        parsed.page || 1,
        parsed.per_page || 100
      );

      return formatSuccessResponse({
        site_id: siteId,
        taxonomy,
        terms: terms.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          parent: t.parent,
          count: t.count,
          description: t.description,
        })),
        pagination,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  extract_authors: async (params: unknown) => {
    try {
      const parsed = extractAuthorsSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);

      const authors = await wpClient.fetchAuthors(siteId);

      return formatSuccessResponse({
        site_id: siteId,
        total: authors.length,
        authors: authors.map((a) => ({
          id: a.id,
          name: a.name,
          slug: a.slug,
          description: a.description,
          avatar: a.avatar_urls?.['96'] || a.avatar_urls?.['48'],
        })),
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  extract_media: async (params: unknown) => {
    try {
      const parsed = extractMediaSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);

      if (parsed.media_id) {
        const media = await wpClient.fetchMedia(siteId, parsed.media_id);
        return formatSuccessResponse({ site_id: siteId, media });
      }

      // List media with pagination
      const { posts: mediaItems, pagination } = await wpClient.fetchPosts(siteId, {
        restBase: 'media',
        page: parsed.page || 1,
        perPage: parsed.per_page || 20,
        embed: false,
      });

      return formatSuccessResponse({
        site_id: siteId,
        media: mediaItems.map((m) => ({
          id: m.id,
          title: m.title?.rendered,
          source_url: (m as unknown as { source_url?: string }).source_url,
          mime_type: (m as unknown as { mime_type?: string }).mime_type,
          date: m.date,
        })),
        pagination,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  extract_menus: async (params: unknown) => {
    try {
      const parsed = extractMenusSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);

      const menus = await wpClient.fetchMenus(siteId);

      return formatSuccessResponse({
        site_id: siteId,
        menus,
        hint: menus.length === 0
          ? 'No menus found via REST API. The site may need the WP REST API Menus plugin, or menus can be extracted from a WXR export.'
          : undefined,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  extract_comments: async (params: unknown) => {
    try {
      const parsed = extractCommentsSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);

      const { comments, pagination } = await wpClient.fetchComments(
        siteId,
        parsed.post_id,
        parsed.page || 1,
        parsed.per_page || 100
      );

      return formatSuccessResponse({
        site_id: siteId,
        comments,
        pagination,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  extract_settings: async (params: unknown) => {
    try {
      const parsed = extractSettingsSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);

      const settings = await wpClient.fetchSettings(siteId);

      // Update site config with detected settings
      const updates: Record<string, unknown> = {};
      if (settings.title) updates.site_title = settings.title;
      if (settings.description) updates.site_tagline = settings.description;
      if (settings.timezone_string) updates.timezone = settings.timezone_string;
      if (settings.language) updates.site_language = settings.language;
      if (settings.permalink_structure) updates.permalink_structure = settings.permalink_structure;

      if (Object.keys(updates).length > 0) {
        siteManager.updateSite(siteId, updates);
      }

      return formatSuccessResponse({
        site_id: siteId,
        settings: {
          title: settings.title,
          tagline: settings.description,
          url: settings.url,
          timezone: settings.timezone_string,
          date_format: settings.date_format,
          time_format: settings.time_format,
          language: settings.language,
          permalink_structure: settings.permalink_structure,
          posts_per_page: settings.posts_per_page,
          default_category: settings.default_category,
          default_comment_status: settings.default_comment_status,
        },
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  extract_widgets: async (params: unknown) => {
    try {
      const parsed = extractWidgetsSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);

      const widgets = await wpClient.fetchWidgets(siteId);

      return formatSuccessResponse({
        site_id: siteId,
        sidebars: widgets,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  cache_terms: async (params: unknown) => {
    try {
      const parsed = cacheTermsSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);

      const db = database.getDatabase();
      const insert = db.prepare(
        `INSERT OR REPLACE INTO cached_terms (site_id, term_id, taxonomy, name, slug, parent, count, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );

      let totalCached = 0;
      const taxonomyCounts: Record<string, number> = {};

      const taxonomies = site.taxonomies || [
        { slug: 'category', rest_base: 'categories', name: 'Categories', hierarchical: true, post_types: ['post'] },
        { slug: 'post_tag', rest_base: 'tags', name: 'Tags', hierarchical: false, post_types: ['post'] },
      ];

      for (const tax of taxonomies) {
        try {
          const terms = await wpClient.fetchAllTerms(siteId, tax.rest_base);
          const insertMany = db.transaction((terms) => {
            for (const term of terms) {
              insert.run(siteId, term.id, tax.slug, term.name, term.slug, term.parent || 0, term.count || 0, term.description || '');
            }
          });
          insertMany(terms);
          taxonomyCounts[tax.slug] = terms.length;
          totalCached += terms.length;
        } catch (error) {
          logger.warn('Failed to cache terms for taxonomy', { siteId, taxonomy: tax.slug, error: error instanceof Error ? error.message : String(error) });
          taxonomyCounts[tax.slug] = 0;
        }
      }

      database.audit(siteId, 'cache_terms', { total: totalCached, taxonomies: taxonomyCounts });

      return formatSuccessResponse({
        site_id: siteId,
        total_cached: totalCached,
        taxonomies: taxonomyCounts,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  cache_authors: async (params: unknown) => {
    try {
      const parsed = cacheAuthorsSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);

      const authors = await wpClient.fetchAuthors(siteId);

      const db = database.getDatabase();
      const insert = db.prepare(
        `INSERT OR REPLACE INTO cached_authors (site_id, author_id, name, slug, description, avatar_url)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

      const insertAll = db.transaction(() => {
        for (const author of authors) {
          insert.run(
            siteId,
            author.id,
            author.name,
            author.slug,
            author.description || '',
            author.avatar_urls?.['96'] || author.avatar_urls?.['48'] || ''
          );
        }
      });
      insertAll();

      database.audit(siteId, 'cache_authors', { total: authors.length });

      return formatSuccessResponse({
        site_id: siteId,
        total_cached: authors.length,
        authors: authors.map((a) => ({ id: a.id, name: a.name, slug: a.slug })),
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  content_audit: async (params: unknown) => {
    try {
      const parsed = contentAuditSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const sampleSize = parsed.sample_size || 10;

      logger.info('Starting content audit', { siteId, sampleSize });

      // Sample posts from different pages for variety
      const analyses = [];
      const postTypes = site.post_types?.filter(
        (pt) => !['attachment', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles'].includes(pt.slug)
      ) || [{ slug: 'post', rest_base: 'posts', name: 'Posts', hierarchical: false, has_archive: true }];

      for (const pt of postTypes) {
        try {
          // Fetch a sample from the first page
          const perPage = Math.min(sampleSize, 25);
          const { posts } = await wpClient.fetchPosts(siteId, {
            restBase: pt.rest_base,
            perPage,
            status: 'publish',
          });

          for (const post of posts.slice(0, sampleSize)) {
            // Fetch full post for analysis (need edit context)
            try {
              const fullPost = await wpClient.fetchPost(siteId, post.id, pt.rest_base);
              analyses.push(analyzeContent(fullPost));
            } catch (_e: unknown) {
              // If individual fetch fails, analyze the list version
              analyses.push(analyzeContent(post));
            }
          }
        } catch (_e: unknown) {
          logger.warn('Could not sample post type', { siteId, postType: pt.slug });
        }
      }

      if (analyses.length === 0) {
        return formatSuccessResponse({
          site_id: siteId,
          warning: 'No posts could be sampled. Check site connection and post type configuration.',
        });
      }

      const summary = aggregateAnalysis(analyses);

      database.audit(siteId, 'content_audit', {
        sampled: summary.totalPosts,
        complexity: summary.complexityBreakdown,
        shortcodes: summary.allShortcodes.length,
        blocks: summary.allBlocks.length,
      });

      // Build migration recommendations
      const recommendations: string[] = [];
      if (Object.keys(summary.pageBuilders).length > 0) {
        recommendations.push(
          `Page builder detected: ${Object.entries(summary.pageBuilders).map(([k, v]) => `${k} (${v} posts)`).join(', ')}. Content will be extracted as clean HTML.`
        );
      }
      if (summary.allShortcodes.length > 0) {
        const topShortcodes = summary.allShortcodes.slice(0, 5).map((s) => `[${s.tag}] (${s.totalCount}x)`).join(', ');
        recommendations.push(`${summary.allShortcodes.length} shortcodes found. Top: ${topShortcodes}. Configure shortcode handling before export.`);
      }
      if (summary.featureUsage.forms > 0) {
        recommendations.push(`${summary.featureUsage.forms} posts contain forms. Plan form replacement (e.g., Astro + React form components).`);
      }
      if (summary.featureUsage.galleries > 0) {
        recommendations.push(`Galleries detected. These will be converted to image grids.`);
      }
      if (summary.complexityBreakdown.complex > summary.totalPosts * 0.3) {
        recommendations.push('Over 30% of content is complex. Consider a dry-run export first.');
      }

      return formatSuccessResponse({
        site_id: siteId,
        site_name: site.name,
        sample_size: summary.totalPosts,
        complexity: summary.complexityBreakdown,
        shortcodes: summary.allShortcodes,
        gutenberg_blocks: summary.allBlocks.slice(0, 20),
        page_builders: summary.pageBuilders,
        embed_types: summary.embedTypes,
        feature_usage: summary.featureUsage,
        media: { total_urls_found: summary.totalMediaUrls },
        internal_links: { total_found: summary.totalInternalLinks },
        avg_word_count: summary.avgWordCount,
        recommendations,
        next_steps: [
          'Review shortcodes and configure handling via shortcode_map',
          'Run cache_terms and cache_authors before export',
          'Run export_preview to see sample converted Markdown',
        ],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },
};
