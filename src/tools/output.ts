/**
 * Output & Media Tools
 * Scaffold Astro projects, write content to disk, generate redirects,
 * audit and rewrite media URLs.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import { siteManager } from '../config/sites.js';
import { wpClient } from '../services/wp-rest-client.js';
import { database } from '../config/database.js';
import { scaffoldProject } from '../services/astro-scaffolder.js';
import {
  writePost,
  writeBatch,
  generateRedirects,
  auditMedia,
  rewriteMediaInFiles,
} from '../services/content-writer.js';
import { formatSuccessResponse, formatErrorResponse, ValidationError } from '../utils/errors.js';
import type { SiteConfig } from '../types/index.js';
import {
  scaffoldProjectSchema,
  writePostSchema,
  writeBatchSchema,
  generateRedirectsSchema,
  mediaAuditSchema,
  mediaRewriteSchema,
  listOutputSchema,
} from '../schemas/output.js';
import logger from '../utils/logger.js';

function resolveOutputDir(siteId: string, paramDir?: string): string {
  const site = siteManager.getSite(siteId);
  const dir = paramDir || site.export?.output_dir;
  if (!dir) {
    throw new ValidationError('No output directory specified. Set it via site_export_config or pass output_dir parameter.');
  }
  return dir;
}

export const outputTools: Tool[] = [
  {
    name: 'scaffold_project',
    description:
      'Create an Astro project structure: package.json, astro.config, layouts, content collections, pages, RSS feed, deploy config. Uses site export config for component library and deploy platform.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        output_dir: { type: 'string', description: 'Output directory (uses site export config if omitted)' },
        force: { type: 'boolean', description: 'Overwrite existing files (default: false)' },
      },
    },
  },
  {
    name: 'write_post',
    description:
      'Convert a single WordPress post and write it as a Markdown file to the Astro content directory. Supports dry_run mode.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        post_id: { type: 'number', description: 'WordPress post ID' },
        post_type: { type: 'string', description: 'Post type slug (default: post)' },
        output_dir: { type: 'string', description: 'Output directory (uses site export config if omitted)' },
        dry_run: { type: 'boolean', description: 'Preview without writing (default: false)' },
      },
      required: ['post_id'],
    },
  },
  {
    name: 'write_batch',
    description:
      'Convert and write a page of posts to disk. Use with pagination for incremental writing. Supports dry_run mode.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        post_type: { type: 'string', description: 'Post type slug (default: post)' },
        page: { type: 'number', description: 'Page number (default: 1)' },
        per_page: { type: 'number', description: 'Posts per page (default: 25, max 100)' },
        output_dir: { type: 'string', description: 'Output directory (uses site export config if omitted)' },
        dry_run: { type: 'boolean', description: 'Preview without writing (default: false)' },
      },
    },
  },
  {
    name: 'generate_redirects',
    description:
      'Generate a redirects file from the WordPress→Astro URL map. Supports Netlify, Vercel, Cloudflare, Apache, and Nginx formats.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        output_dir: { type: 'string', description: 'Output directory (uses site export config if omitted)' },
        format: {
          type: 'string',
          enum: ['netlify', 'vercel', 'cloudflare', 'apache', 'nginx'],
          description: 'Redirect format (default: based on deploy platform)',
        },
      },
    },
  },
  {
    name: 'media_audit',
    description:
      'Scan exported Markdown files for media references. Reports domains, counts, and broken references. Use before going live to verify media URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        output_dir: { type: 'string', description: 'Output directory to scan' },
      },
    },
  },
  {
    name: 'media_rewrite',
    description:
      'Bulk rewrite media URLs in all exported content files. Replaces one domain with another (e.g., example.com → app.example.com for go-live).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        output_dir: { type: 'string', description: 'Output directory to process' },
        old_domain: { type: 'string', description: 'Domain to replace (default: site URL domain)' },
        new_domain: { type: 'string', description: 'New domain for media URLs' },
      },
      required: ['new_domain'],
    },
  },
  {
    name: 'list_output',
    description:
      'List all files in the output directory with stats (file count, total size, content types).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        output_dir: { type: 'string', description: 'Output directory to inspect' },
      },
    },
  },
];

export const outputHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
  scaffold_project: async (params: unknown) => {
    try {
      const parsed = scaffoldProjectSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const outputDir = resolveOutputDir(siteId, parsed.output_dir);

      const result = scaffoldProject(site, outputDir, parsed.force);

      database.audit(siteId, 'scaffold_project', {
        output_dir: outputDir,
        created: result.filesCreated.length,
        skipped: result.filesSkipped.length,
      });

      return formatSuccessResponse({
        message: `Astro project scaffolded at ${outputDir}`,
        site_id: siteId,
        files_created: result.filesCreated,
        files_skipped: result.filesSkipped,
        next_steps: [
          'Run write_batch to export content',
          'Run generate_redirects to create redirect rules',
          `cd ${outputDir} && npm install && npm run dev`,
        ],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  write_post: async (params: unknown) => {
    try {
      const parsed = writePostSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const outputDir = resolveOutputDir(siteId, parsed.output_dir);

      const postType = parsed.post_type || 'post';
      const ptInfo = site.post_types?.find((pt) => pt.slug === postType);
      const restBase = ptInfo?.rest_base || (postType === 'post' ? 'posts' : postType === 'page' ? 'pages' : postType);

      const post = await wpClient.fetchPost(siteId, parsed.post_id, restBase);
      const result = writePost(post, site, outputDir, { dryRun: parsed.dry_run });

      return formatSuccessResponse({
        site_id: siteId,
        ...result,
        mode: parsed.dry_run ? 'dry_run' : 'written',
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  write_batch: async (params: unknown) => {
    try {
      const parsed = writeBatchSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const outputDir = resolveOutputDir(siteId, parsed.output_dir);

      const postType = parsed.post_type || 'post';
      const ptInfo = site.post_types?.find((pt) => pt.slug === postType);
      const restBase = ptInfo?.rest_base || (postType === 'post' ? 'posts' : postType === 'page' ? 'pages' : postType);

      const perPage = parsed.per_page || 25;
      const page = parsed.page || 1;

      logger.info('Writing batch', { siteId, postType, page, perPage });

      const { posts, pagination } = await wpClient.fetchPosts(siteId, {
        restBase,
        page,
        perPage,
        status: site.export?.include_statuses?.join(',') || 'publish',
      });

      // Fetch full posts (need edit context for raw content)
      const fullPosts = [];
      for (const post of posts) {
        try {
          const full = await wpClient.fetchPost(siteId, post.id, restBase);
          fullPosts.push(full);
        } catch {
          fullPosts.push(post);
        }
      }

      const { results, summary } = writeBatch(fullPosts, site, outputDir, {
        dryRun: parsed.dry_run,
      });

      database.audit(siteId, 'write_batch', {
        post_type: postType,
        page,
        ...summary,
      });

      return formatSuccessResponse({
        site_id: siteId,
        post_type: postType,
        mode: parsed.dry_run ? 'dry_run' : 'written',
        pagination,
        summary,
        posts: results.map((r) => ({
          post_id: r.postId,
          title: r.title,
          slug: r.slug,
          output_path: r.outputPath,
          issues: r.issueCount,
          written: r.written,
        })),
        has_more: page < pagination.totalPages,
        next_page: page < pagination.totalPages ? page + 1 : null,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  generate_redirects: async (params: unknown) => {
    try {
      const parsed = generateRedirectsSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const outputDir = resolveOutputDir(siteId, parsed.output_dir);

      // Determine format from deploy platform if not specified
      const format = parsed.format || platformToRedirectFormat(site.export?.deploy_platform);

      const result = generateRedirects(siteId, outputDir, format);

      if (result.redirectCount === 0) {
        return formatSuccessResponse({
          message: 'No URL mappings found. Export content first to generate URL mappings.',
          site_id: siteId,
        });
      }

      database.audit(siteId, 'generate_redirects', {
        format,
        count: result.redirectCount,
      });

      return formatSuccessResponse({
        site_id: siteId,
        format,
        file: result.filePath,
        redirect_count: result.redirectCount,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  media_audit: async (params: unknown) => {
    try {
      const parsed = mediaAuditSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const outputDir = resolveOutputDir(siteId, parsed.output_dir);

      const result = auditMedia(outputDir, site.url);

      return formatSuccessResponse({
        site_id: siteId,
        output_dir: outputDir,
        ...result,
        recommendations: buildMediaRecommendations(result, site),
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  media_rewrite: async (params: unknown) => {
    try {
      const parsed = mediaRewriteSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const outputDir = resolveOutputDir(siteId, parsed.output_dir);

      const oldDomain = parsed.old_domain || new URL(site.url).hostname;
      const newDomain = parsed.new_domain;

      const result = rewriteMediaInFiles(outputDir, oldDomain, newDomain);

      database.audit(siteId, 'media_rewrite', {
        old_domain: oldDomain,
        new_domain: newDomain,
        ...result,
      });

      return formatSuccessResponse({
        site_id: siteId,
        old_domain: oldDomain,
        new_domain: newDomain,
        files_modified: result.filesModified,
        replacements: result.replacements,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  list_output: async (params: unknown) => {
    try {
      const parsed = listOutputSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const outputDir = resolveOutputDir(siteId, parsed.output_dir);

      if (!fs.existsSync(outputDir)) {
        return formatSuccessResponse({
          site_id: siteId,
          output_dir: outputDir,
          exists: false,
          message: 'Output directory does not exist. Run scaffold_project first.',
        });
      }

      const stats = getOutputStats(outputDir);

      return formatSuccessResponse({
        site_id: siteId,
        output_dir: outputDir,
        exists: true,
        ...stats,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },
};

function platformToRedirectFormat(
  platform?: string
): 'netlify' | 'vercel' | 'cloudflare' | 'apache' | 'nginx' {
  switch (platform) {
    case 'vercel': return 'vercel';
    case 'netlify': return 'netlify';
    case 'cloudflare': return 'cloudflare';
    default: return 'netlify';
  }
}

function buildMediaRecommendations(
  audit: { totalMediaRefs: number; domains: Record<string, number>; brokenRefs: string[] },
  site: SiteConfig
): string[] {
  const recs: string[] = [];
  const siteDomain = new URL(site.url).hostname;

  if (audit.domains[siteDomain]) {
    const count = audit.domains[siteDomain];
    if (site.export?.media_domain) {
      recs.push(
        `${count} media references still point to ${siteDomain}. Run media_rewrite to swap to ${site.export.media_domain}.`
      );
    } else {
      recs.push(
        `${count} media references point to ${siteDomain}. Set media_domain in site_export_config if the WordPress site will move to a subdomain.`
      );
    }
  }

  if (audit.brokenRefs.length > 0) {
    recs.push(`${audit.brokenRefs.length} broken media references found.`);
  }

  if (Object.keys(audit.domains).length > 2) {
    recs.push(`Media loaded from ${Object.keys(audit.domains).length} different domains. Review for external dependencies.`);
  }

  return recs;
}

function getOutputStats(dir: string): {
  total_files: number;
  content_files: number;
  total_size_bytes: number;
  collections: Record<string, number>;
} {
  let totalFiles = 0;
  let contentFiles = 0;
  let totalSize = 0;
  const collections: Record<string, number> = {};

  walkDir(dir, (filePath) => {
    totalFiles++;
    const stat = fs.statSync(filePath);
    totalSize += stat.size;

    if (filePath.endsWith('.md') || filePath.endsWith('.mdx')) {
      contentFiles++;
      // Determine collection from path
      const rel = path.relative(dir, filePath);
      const parts = rel.split(path.sep);
      if (parts[0] === 'src' && parts[1] === 'content' && parts.length >= 4) {
        const collection = parts[2];
        collections[collection] = (collections[collection] || 0) + 1;
      }
    }
  });

  return { total_files: totalFiles, content_files: contentFiles, total_size_bytes: totalSize, collections };
}

function walkDir(dir: string, callback: (filePath: string) => void): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, callback);
    } else {
      callback(fullPath);
    }
  }
}
