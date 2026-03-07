/**
 * Transform Tools
 * Convert WordPress content to Astro-compatible Markdown.
 * Includes preview, single post conversion, raw HTML conversion,
 * and shortcode management.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { siteManager } from '../config/sites.js';
import { wpClient } from '../services/wp-rest-client.js';
import { database } from '../config/database.js';
import { convertPost } from '../services/html-to-markdown.js';
import {
  findShortcodes,
  resolveShortcodes,
  configureShortcode,
  listShortcodeRules,
} from '../services/shortcode-resolver.js';
import { serializeFrontmatter } from '../services/frontmatter-builder.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';
import {
  convertPostSchema,
  convertPreviewSchema,
  convertHtmlSchema,
  shortcodeListSchema,
  shortcodeConfigureSchema,
  shortcodeScanSchema,
} from '../schemas/transform.js';
import logger from '../utils/logger.js';

// Lightweight Turndown for raw HTML conversion
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import DOMPurify from 'isomorphic-dompurify';

export const transformTools: Tool[] = [
  {
    name: 'convert_post',
    description:
      'Convert a single WordPress post to Astro Markdown. Returns full frontmatter + body with conversion issues report.',
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
    name: 'convert_preview',
    description:
      'Convert a sample of posts to preview Markdown output. Shows frontmatter structure and content quality before full export.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        post_type: { type: 'string', description: 'Post type to sample (default: post)' },
        count: { type: 'number', description: 'Number of posts (default: 3, max: 10)' },
      },
    },
  },
  {
    name: 'convert_html',
    description:
      'Convert raw HTML to Markdown. Useful for testing conversion rules or converting arbitrary HTML content.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID for link rewriting (optional)' },
        html: { type: 'string', description: 'HTML to convert' },
        title: { type: 'string', description: 'Title for frontmatter (optional)' },
      },
      required: ['html'],
    },
  },
  {
    name: 'shortcode_list',
    description: 'List all configured shortcode handling rules for a site.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'shortcode_configure',
    description:
      'Configure how a specific shortcode should be handled during conversion. Actions: strip (remove entirely), keep_content (unwrap), remove (delete including content), component (map to Astro component), html (convert to HTML).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID' },
        shortcode: { type: 'string', description: 'Shortcode tag name (e.g., "gallery")' },
        action: {
          type: 'string',
          enum: ['strip', 'keep_content', 'remove', 'component', 'html'],
          description: 'How to handle this shortcode',
        },
        component: { type: 'string', description: 'Astro component name (for action=component)' },
      },
      required: ['site_id', 'shortcode', 'action'],
    },
  },
  {
    name: 'shortcode_scan',
    description:
      'Scan posts for all shortcodes in use and return a report. Helps identify which shortcodes need configuration before export.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        sample_size: { type: 'number', description: 'Number of posts to scan (default: 20, max: 100)' },
      },
    },
  },
];

export const transformHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
  convert_post: async (params: unknown) => {
    try {
      const parsed = convertPostSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);

      const postType = parsed.post_type || 'post';
      const ptInfo = site.post_types?.find((pt) => pt.slug === postType);
      const restBase = ptInfo?.rest_base || (postType === 'post' ? 'posts' : postType === 'page' ? 'pages' : postType);

      const post = await wpClient.fetchPost(siteId, parsed.post_id, restBase);
      const result = convertPost(post, site);

      const fullMarkdown = serializeFrontmatter(result.frontmatter) + '\n' + result.body;

      return formatSuccessResponse({
        site_id: siteId,
        post_id: post.id,
        title: result.frontmatter.title,
        slug: result.frontmatter.slug,
        conversion: {
          input_size: result.inputSize,
          output_size: result.outputSize,
          conversion_ms: result.conversionMs,
          issues: result.issues,
        },
        markdown: fullMarkdown,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  convert_preview: async (params: unknown) => {
    try {
      const parsed = convertPreviewSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const count = parsed.count || 3;

      const postType = parsed.post_type || 'post';
      const ptInfo = site.post_types?.find((pt) => pt.slug === postType);
      const restBase = ptInfo?.rest_base || (postType === 'post' ? 'posts' : postType === 'page' ? 'pages' : postType);

      logger.info('Converting preview posts', { siteId, postType, count });

      const { posts } = await wpClient.fetchPosts(siteId, {
        restBase,
        perPage: count,
        status: 'publish',
      });

      const previews = [];
      const allIssues: Array<{ postId: number; title: string; issues: unknown[] }> = [];

      for (const post of posts) {
        // Fetch full post content
        let fullPost;
        try {
          fullPost = await wpClient.fetchPost(siteId, post.id, restBase);
        } catch {
          fullPost = post;
        }

        const result = convertPost(fullPost, site);
        const fullMarkdown = serializeFrontmatter(result.frontmatter) + '\n' + result.body;

        previews.push({
          post_id: post.id,
          title: result.frontmatter.title,
          slug: result.frontmatter.slug,
          input_size: result.inputSize,
          output_size: result.outputSize,
          conversion_ms: result.conversionMs,
          issue_count: result.issues.length,
          // Truncate markdown for preview
          markdown_preview: fullMarkdown.substring(0, 2000) + (fullMarkdown.length > 2000 ? '\n\n... [truncated]' : ''),
        });

        if (result.issues.length > 0) {
          allIssues.push({
            postId: post.id,
            title: result.frontmatter.title,
            issues: result.issues,
          });
        }
      }

      return formatSuccessResponse({
        site_id: siteId,
        post_type: postType,
        previews,
        issues_summary: allIssues,
        next_steps: [
          'Review the Markdown output for formatting quality',
          'Configure shortcode handling with shortcode_configure if needed',
          'Run export_start when satisfied with conversion quality',
        ],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  convert_html: async (params: unknown) => {
    try {
      const parsed = convertHtmlSchema.parse(params);

      // Sanitize
      let html = DOMPurify.sanitize(parsed.html);

      // Resolve shortcodes if present
      const siteId = parsed.site_id ? siteManager.resolveSiteId(parsed.site_id) : undefined;
      if (html.includes('[')) {
        const scResult = resolveShortcodes(html, siteId);
        html = scResult.content;
      }

      // Convert
      const td = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
      });
      td.use(gfm);

      const markdown = td.turndown(html);

      const response: Record<string, unknown> = { markdown };

      if (parsed.title) {
        response.with_frontmatter = `---\ntitle: ${parsed.title}\n---\n\n${markdown}`;
      }

      return formatSuccessResponse(response);
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  shortcode_list: async (params: unknown) => {
    try {
      const parsed = shortcodeListSchema.parse(params);
      const rules = listShortcodeRules(parsed.site_id);

      return formatSuccessResponse({
        site_id: parsed.site_id,
        rules,
        total: rules.length,
        available_actions: [
          { action: 'strip', description: 'Remove shortcode entirely (tag + content)' },
          { action: 'keep_content', description: 'Remove shortcode tags, keep inner content' },
          { action: 'remove', description: 'Remove shortcode and all content inside' },
          { action: 'component', description: 'Replace with Astro component placeholder' },
          { action: 'html', description: 'Convert shortcode to HTML equivalent' },
        ],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  shortcode_configure: async (params: unknown) => {
    try {
      const parsed = shortcodeConfigureSchema.parse(params);

      configureShortcode(parsed.site_id, parsed.shortcode, parsed.action, parsed.component);

      database.audit(parsed.site_id, 'shortcode_configure', {
        shortcode: parsed.shortcode,
        action: parsed.action,
        component: parsed.component,
      });

      return formatSuccessResponse({
        message: `Shortcode [${parsed.shortcode}] configured: ${parsed.action}`,
        site_id: parsed.site_id,
        rule: {
          shortcode: parsed.shortcode,
          action: parsed.action,
          component: parsed.component,
        },
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  shortcode_scan: async (params: unknown) => {
    try {
      const parsed = shortcodeScanSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const sampleSize = parsed.sample_size || 20;

      const postTypes = site.post_types?.filter(
        (pt) => !['attachment', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles'].includes(pt.slug)
      ) || [{ slug: 'post', rest_base: 'posts', name: 'Posts', hierarchical: false, has_archive: true }];

      // Aggregate shortcodes across sampled posts
      const shortcodeMap = new Map<string, { count: number; postsUsing: number; samples: string[] }>();
      let totalScanned = 0;

      for (const pt of postTypes) {
        try {
          const { posts } = await wpClient.fetchPosts(siteId, {
            restBase: pt.rest_base,
            perPage: Math.min(sampleSize, 100),
            status: 'publish',
          });

          for (const post of posts) {
            const content = post.content?.rendered || '';
            if (!content.includes('[')) continue;

            const matches = findShortcodes(content);
            for (const sc of matches) {
              const existing = shortcodeMap.get(sc.tag);
              if (existing) {
                existing.count++;
                if (existing.samples.length < 3) {
                  existing.samples.push(sc.full.substring(0, 100));
                }
              } else {
                shortcodeMap.set(sc.tag, {
                  count: 1,
                  postsUsing: 1,
                  samples: [sc.full.substring(0, 100)],
                });
              }
            }
            totalScanned++;
          }
        } catch {
          // Skip post type on error
        }
      }

      // Check existing rules
      const existingRules = listShortcodeRules(siteId);
      const configuredTags = new Set(existingRules.map((r) => r.shortcode));

      const shortcodes = Array.from(shortcodeMap.entries())
        .map(([tag, info]) => ({
          tag,
          count: info.count,
          samples: info.samples,
          configured: configuredTags.has(tag),
          current_action: existingRules.find((r) => r.shortcode === tag)?.action || null,
        }))
        .sort((a, b) => b.count - a.count);

      const unconfigured = shortcodes.filter((s) => !s.configured);

      return formatSuccessResponse({
        site_id: siteId,
        posts_scanned: totalScanned,
        shortcodes,
        unconfigured_count: unconfigured.length,
        unconfigured: unconfigured.map((s) => s.tag),
        hint: unconfigured.length > 0
          ? `${unconfigured.length} shortcodes have no configured action. Use shortcode_configure to set handling rules.`
          : 'All detected shortcodes have configured rules.',
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },
};
