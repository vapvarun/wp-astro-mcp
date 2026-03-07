/**
 * Content Sync Tools
 * Keeps Astro site in sync with ongoing WordPress content changes.
 * Detects new, updated, and deleted posts/pages/CPTs and updates local files.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { siteManager } from '../config/sites.js';
import { wpClient } from '../services/wp-rest-client.js';
import { database } from '../config/database.js';
import { writePost } from '../services/content-writer.js';
import { formatSuccessResponse, formatErrorResponse, ValidationError } from '../utils/errors.js';
import {
  syncCheckSchema,
  syncPullSchema,
  syncDeleteSchema,
  syncFullSchema,
  syncStatusSchema,
  syncScheduleSchema,
  syncResetSchema,
} from '../schemas/sync.js';
import type { SiteConfig } from '../types/index.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

// ============================================================
// Tool Definitions
// ============================================================

export const syncTools: Tool[] = [
  {
    name: 'sync_check',
    description:
      'Compare WordPress content against local exported files. Reports new posts, updated posts (content/SEO/images changed), and deleted posts. Dry-run only — no files are modified.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        post_types: { type: 'array', items: { type: 'string' }, description: 'Post types to check (default: all exported types)' },
        since: { type: 'string', description: 'Check changes since this ISO date (default: last sync time)' },
        include_deleted: { type: 'boolean', description: 'Check for deleted posts (slower, queries WP per ID). Default: true' },
      },
    },
  },
  {
    name: 'sync_pull',
    description:
      'Fetch and write only changed content from WordPress. Creates new files for new posts, overwrites files for updated posts. Handles slug changes (deletes old file, writes new one). Updates URL map and content hashes.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        post_types: { type: 'array', items: { type: 'string' }, description: 'Post types to sync (default: all exported types)' },
        batch_size: { type: 'number', description: 'Posts to process per batch (default: 25)' },
        dry_run: { type: 'boolean', description: 'Preview changes without writing files' },
        force: { type: 'boolean', description: 'Force re-sync all posts, ignoring modified dates' },
      },
    },
  },
  {
    name: 'sync_delete',
    description:
      'Remove local Markdown files for posts that have been deleted or trashed in WordPress. Also cleans up URL map entries.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        confirm: { type: 'boolean', description: 'Must be true to delete local files' },
        dry_run: { type: 'boolean', description: 'Preview deletions without removing files' },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'sync_full',
    description:
      'Complete content sync: check for changes → pull new/updated posts → delete removed posts → update caches → optionally commit to git. One command to keep the Astro site current with WordPress.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        post_types: { type: 'array', items: { type: 'string' }, description: 'Post types to sync' },
        batch_size: { type: 'number', description: 'Posts per batch (default: 25)' },
        include_deleted: { type: 'boolean', description: 'Remove locally deleted posts. Default: true' },
        auto_commit: { type: 'boolean', description: 'Auto-commit changes to git after sync' },
        commit_message: { type: 'string', description: 'Custom commit message' },
      },
    },
  },
  {
    name: 'sync_status',
    description:
      'Show sync history: last sync time, number of posts synced, changes made. Helps track when the Astro site was last updated from WordPress.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        limit: { type: 'number', description: 'Number of recent syncs to show (default: 10)' },
      },
    },
  },
  {
    name: 'sync_schedule',
    description:
      'Generate automated sync configuration: GitHub Actions workflow, cron job, or platform-specific webhook. Keeps the Astro site automatically updated when WordPress content changes.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        platform: { type: 'string', enum: ['github-actions', 'cron', 'netlify', 'vercel'], description: 'Platform for scheduled sync' },
        interval: { type: 'string', enum: ['hourly', 'every-6h', 'every-12h', 'daily', 'weekly'], description: 'Sync frequency (default: daily)' },
        output_dir: { type: 'string', description: 'Output directory for config file' },
        branch: { type: 'string', description: 'Git branch to sync to (default: main)' },
      },
      required: ['platform'],
    },
  },
  {
    name: 'sync_reset',
    description:
      'Clear sync tracking data to force a full re-sync on next sync_pull. Does not delete content files.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        confirm: { type: 'boolean', description: 'Must be true to reset' },
      },
      required: ['confirm'],
    },
  },
];

// ============================================================
// Database Helpers
// ============================================================

/**
 * Ensure sync tables exist (backward compat for DBs created before sync was added)
 */
function ensureSyncSchema(): void {
  const db = database.getDatabase();

  // Add wp_modified_gmt column if missing (for databases created before Phase 7)
  try {
    db.exec(`ALTER TABLE export_posts ADD COLUMN wp_modified_gmt TEXT`);
  } catch (_e: unknown) {
    // Column already exists — this is expected for new installs
  }
}

function getLastSyncTime(siteId: string): string | null {
  const db = database.getDatabase();
  const row = db.prepare(
    "SELECT completed_at FROM sync_history WHERE site_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1"
  ).get(siteId) as { completed_at: string } | undefined;
  return row?.completed_at || null;
}

function getExportedPostMap(siteId: string): Map<number, { id: number; slug: string; outputPath: string; wpModifiedGmt: string | null; contentHash: string | null; jobId: number }> {
  const db = database.getDatabase();
  const rows = db.prepare(
    `SELECT ep.id, ep.wp_post_id, ep.slug, ep.output_path, ep.wp_modified_gmt, ep.content_hash, ep.job_id
     FROM export_posts ep
     INNER JOIN export_jobs ej ON ep.job_id = ej.id
     WHERE ep.site_id = ? AND ep.status = 'completed' AND ej.status = 'completed'
     ORDER BY ep.id DESC`
  ).all(siteId) as Array<{ id: number; wp_post_id: number; slug: string; output_path: string; wp_modified_gmt: string | null; content_hash: string | null; job_id: number }>;

  const map = new Map<number, { id: number; slug: string; outputPath: string; wpModifiedGmt: string | null; contentHash: string | null; jobId: number }>();
  for (const row of rows) {
    // Only keep the latest entry per wp_post_id
    if (!map.has(row.wp_post_id)) {
      map.set(row.wp_post_id, {
        id: row.id,
        slug: row.slug,
        outputPath: row.output_path,
        wpModifiedGmt: row.wp_modified_gmt,
        contentHash: row.content_hash,
        jobId: row.job_id,
      });
    }
  }
  return map;
}

function getOutputDir(siteId: string): string {
  // Try to get from latest completed export job
  const db = database.getDatabase();
  const job = db.prepare(
    "SELECT output_dir FROM export_jobs WHERE site_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1"
  ).get(siteId) as { output_dir: string } | undefined;

  if (job?.output_dir) return job.output_dir;

  // Fall back to site config
  const site = siteManager.getSite(siteId);
  if (site.export?.output_dir) return site.export.output_dir;

  throw new ValidationError('No output directory found. Run an export first or set output_dir in site_export_config.');
}

function getExportablePostTypes(site: SiteConfig): Array<{ slug: string; restBase: string }> {
  const skip = ['attachment', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles'];
  const allPt = site.post_types?.filter(pt => !skip.includes(pt.slug)) || [];

  const includePt = site.export?.include_post_types;
  const excludePt = site.export?.exclude_post_types;

  return allPt
    .filter(pt => {
      if (includePt && includePt.length > 0) return includePt.includes(pt.slug);
      if (excludePt && excludePt.length > 0) return !excludePt.includes(pt.slug);
      return true;
    })
    .map(pt => ({ slug: pt.slug, restBase: pt.rest_base }));
}

// ============================================================
// Core Sync Logic
// ============================================================

interface SyncChanges {
  newPosts: Array<{ id: number; type: string; modified: string }>;
  updatedPosts: Array<{ id: number; type: string; modified: string; localModified: string | null; reason: string }>;
  deletedPosts: Array<{ id: number; slug: string; outputPath: string }>;
  unchangedCount: number;
}

async function detectChanges(
  siteId: string,
  site: SiteConfig,
  options: { postTypes?: string[]; since?: string; includeDeleted?: boolean }
): Promise<SyncChanges> {
  ensureSyncSchema();

  const exportedMap = getExportedPostMap(siteId);
  const lastSync = options.since || getLastSyncTime(siteId);
  const postTypes = options.postTypes
    ? getExportablePostTypes(site).filter(pt => options.postTypes!.includes(pt.slug))
    : getExportablePostTypes(site);

  const changes: SyncChanges = {
    newPosts: [],
    updatedPosts: [],
    deletedPosts: [],
    unchangedCount: 0,
  };

  // Track which WP post IDs we see (for deletion detection)
  const seenWpIds = new Set<number>();

  for (const pt of postTypes) {
    // Fetch posts modified after last sync (or all if no previous sync)
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const fetchOptions: Record<string, unknown> = {
        restBase: pt.restBase,
        page,
        perPage: 100,
        status: site.export?.include_statuses?.join(',') || 'publish',
        orderby: 'modified',
        order: 'desc',
        embed: true,
      };

      // Only filter by modified_after if we have a last sync time and aren't checking for deletes
      if (lastSync && !options.includeDeleted) {
        fetchOptions.after = lastSync;
      }

      try {
        const { posts, pagination } = await wpClient.fetchPosts(siteId, fetchOptions);
        totalPages = pagination.totalPages;

        for (const post of posts) {
          seenWpIds.add(post.id);
          const local = exportedMap.get(post.id);

          if (!local) {
            // New post
            changes.newPosts.push({
              id: post.id,
              type: pt.slug,
              modified: post.modified_gmt,
            });
          } else if (local.wpModifiedGmt && post.modified_gmt > local.wpModifiedGmt) {
            // Updated post
            const reasons: string[] = [];
            if (post.modified_gmt > (local.wpModifiedGmt || '')) reasons.push('content_modified');
            if (post.slug !== local.slug) reasons.push('slug_changed');

            changes.updatedPosts.push({
              id: post.id,
              type: pt.slug,
              modified: post.modified_gmt,
              localModified: local.wpModifiedGmt,
              reason: reasons.join(', ') || 'modified',
            });
          } else if (!local.wpModifiedGmt) {
            // No stored modified date — treat as potentially updated
            changes.updatedPosts.push({
              id: post.id,
              type: pt.slug,
              modified: post.modified_gmt,
              localModified: null,
              reason: 'no_local_timestamp',
            });
          } else {
            changes.unchangedCount++;
          }
        }

        // If we're filtering by modified_after and got less than a full page, we're done
        if (lastSync && posts.length < 100) break;

        page++;
      } catch (error) {
        logger.warn('Failed to fetch posts for sync check', {
          siteId, postType: pt.slug, page,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }
  }

  // Detect deleted posts (check IDs we have locally but didn't see on WP)
  if (options.includeDeleted !== false) {
    const localIds = Array.from(exportedMap.keys());
    const missingIds = localIds.filter(id => !seenWpIds.has(id));

    // Verify deletions by trying to fetch each missing post
    // (they might just be in a different status or post type we didn't check)
    for (const wpPostId of missingIds) {
      const local = exportedMap.get(wpPostId)!;
      try {
        // Try to fetch with any status
        await wpClient.fetchPost(siteId, wpPostId);
        // Post exists — just not in our filter criteria, don't delete
      } catch (_e: unknown) {
        // 404 — post is truly deleted
        changes.deletedPosts.push({
          id: wpPostId,
          slug: local.slug,
          outputPath: local.outputPath,
        });
      }
    }
  }

  return changes;
}

async function pullChanges(
  siteId: string,
  site: SiteConfig,
  outputDir: string,
  changes: SyncChanges,
  options: { dryRun?: boolean; batchSize?: number }
): Promise<{
  created: number;
  updated: number;
  slugChanges: Array<{ postId: number; oldPath: string; newPath: string }>;
  failed: number;
  errors: string[];
}> {
  const db = database.getDatabase();
  const result = {
    created: 0,
    updated: 0,
    slugChanges: [] as Array<{ postId: number; oldPath: string; newPath: string }>,
    failed: 0,
    errors: [] as string[],
  };

  // Find the latest completed job for this site (to associate new posts with)
  const latestJob = db.prepare(
    "SELECT id FROM export_jobs WHERE site_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1"
  ).get(siteId) as { id: number } | undefined;

  if (!latestJob) {
    throw new ValidationError('No completed export job found. Run export_start first before syncing.');
  }

  const jobId = latestJob.id;

  // Process new posts
  for (const newPost of changes.newPosts) {
    try {
      const ptInfo = site.post_types?.find(pt => pt.slug === newPost.type);
      const restBase = ptInfo?.rest_base || (newPost.type === 'post' ? 'posts' : newPost.type === 'page' ? 'pages' : newPost.type);

      const post = await wpClient.fetchPost(siteId, newPost.id, restBase);

      if (!options.dryRun) {
        const writeResult = writePost(post, site, outputDir);

        // Register in export_posts
        db.prepare(
          `INSERT OR REPLACE INTO export_posts
           (job_id, site_id, wp_post_id, post_type, slug, title, status, output_path,
            input_size, output_size, conversion_ms, wp_modified_gmt, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, datetime('now'))`
        ).run(
          jobId, siteId, post.id, post.type, writeResult.slug, writeResult.title,
          writeResult.outputPath, writeResult.inputSize, writeResult.outputSize,
          writeResult.conversionMs, post.modified_gmt
        );
      }

      result.created++;
    } catch (error) {
      result.failed++;
      result.errors.push(`New post ${newPost.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Process updated posts
  for (const updated of changes.updatedPosts) {
    try {
      const ptInfo = site.post_types?.find(pt => pt.slug === updated.type);
      const restBase = ptInfo?.rest_base || (updated.type === 'post' ? 'posts' : updated.type === 'page' ? 'pages' : updated.type);

      const post = await wpClient.fetchPost(siteId, updated.id, restBase);
      const existingLocal = getExportedPostMap(siteId).get(updated.id);

      if (!options.dryRun) {
        // Check for slug change — delete old file first
        if (existingLocal && existingLocal.slug !== post.slug && existingLocal.outputPath) {
          const oldFullPath = path.join(outputDir, existingLocal.outputPath);
          if (fs.existsSync(oldFullPath)) {
            fs.unlinkSync(oldFullPath);
            result.slugChanges.push({
              postId: post.id,
              oldPath: existingLocal.outputPath,
              newPath: '', // Will be set after write
            });
          }
        }

        const writeResult = writePost(post, site, outputDir);

        // Update slug change record with new path
        const slugChange = result.slugChanges.find(sc => sc.postId === post.id);
        if (slugChange) {
          slugChange.newPath = writeResult.outputPath;
        }

        // Update export_posts record
        db.prepare(
          `UPDATE export_posts SET
            slug = ?, title = ?, output_path = ?,
            input_size = ?, output_size = ?, conversion_ms = ?,
            wp_modified_gmt = ?, updated_at = datetime('now')
           WHERE site_id = ? AND wp_post_id = ? AND status = 'completed'`
        ).run(
          writeResult.slug, writeResult.title, writeResult.outputPath,
          writeResult.inputSize, writeResult.outputSize, writeResult.conversionMs,
          post.modified_gmt, siteId, post.id
        );
      }

      result.updated++;
    } catch (error) {
      result.failed++;
      result.errors.push(`Updated post ${updated.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}

function deleteLocalFiles(
  siteId: string,
  outputDir: string,
  deletedPosts: SyncChanges['deletedPosts'],
  dryRun: boolean
): { deleted: number; notFound: number } {
  const db = database.getDatabase();
  let deleted = 0;
  let notFound = 0;

  for (const post of deletedPosts) {
    if (post.outputPath) {
      const fullPath = path.join(outputDir, post.outputPath);

      if (fs.existsSync(fullPath)) {
        if (!dryRun) {
          fs.unlinkSync(fullPath);

          // Remove from export_posts
          db.prepare(
            "DELETE FROM export_posts WHERE site_id = ? AND wp_post_id = ?"
          ).run(siteId, post.id);

          // Remove from url_map
          db.prepare(
            "DELETE FROM url_map WHERE site_id = ? AND wp_post_id = ?"
          ).run(siteId, post.id);
        }
        deleted++;
      } else {
        notFound++;
      }
    }
  }

  return { deleted, notFound };
}

// ============================================================
// Tool Handlers
// ============================================================

export const syncHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
  sync_check: async (params: unknown) => {
    try {
      const parsed = syncCheckSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);

      ensureSyncSchema();
      const lastSync = getLastSyncTime(siteId);

      const changes = await detectChanges(siteId, site, {
        postTypes: parsed.post_types,
        since: parsed.since,
        includeDeleted: parsed.include_deleted,
      });

      const hasChanges = changes.newPosts.length > 0 || changes.updatedPosts.length > 0 || changes.deletedPosts.length > 0;

      return formatSuccessResponse({
        site_id: siteId,
        last_sync: lastSync || 'never',
        checked_since: parsed.since || lastSync || 'all time (first sync)',
        changes: {
          new_posts: changes.newPosts.length,
          updated_posts: changes.updatedPosts.length,
          deleted_posts: changes.deletedPosts.length,
          unchanged: changes.unchangedCount,
        },
        new_posts: changes.newPosts.slice(0, 20),
        updated_posts: changes.updatedPosts.slice(0, 20),
        deleted_posts: changes.deletedPosts.slice(0, 20),
        has_changes: hasChanges,
        next_steps: hasChanges
          ? [
              `Run sync_pull to update ${changes.newPosts.length} new + ${changes.updatedPosts.length} updated posts`,
              ...(changes.deletedPosts.length > 0
                ? [`Run sync_delete to remove ${changes.deletedPosts.length} deleted posts`]
                : []),
              'Or run sync_full to do everything in one step',
            ]
          : ['Site is up to date — no changes needed'],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  sync_pull: async (params: unknown) => {
    try {
      const parsed = syncPullSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const outputDir = getOutputDir(siteId);

      ensureSyncSchema();

      // Detect changes
      const changes = await detectChanges(siteId, site, {
        postTypes: parsed.post_types,
        includeDeleted: false, // sync_pull doesn't delete
      });

      // If force mode, treat all existing posts as "updated"
      if (parsed.force) {
        const existingMap = getExportedPostMap(siteId);
        for (const [wpId, local] of existingMap) {
          if (!changes.updatedPosts.find(p => p.id === wpId) && !changes.newPosts.find(p => p.id === wpId)) {
            changes.updatedPosts.push({
              id: wpId,
              type: 'unknown', // Will be resolved during fetch
              modified: '',
              localModified: local.wpModifiedGmt,
              reason: 'force_sync',
            });
          }
        }
      }

      if (changes.newPosts.length === 0 && changes.updatedPosts.length === 0) {
        return formatSuccessResponse({
          site_id: siteId,
          message: 'No content changes detected. Site is up to date.',
          new_posts: 0,
          updated_posts: 0,
        });
      }

      // Pull changes
      const result = await pullChanges(siteId, site, outputDir, changes, {
        dryRun: parsed.dry_run,
        batchSize: parsed.batch_size,
      });

      // Record sync in history
      if (!parsed.dry_run) {
        const db = database.getDatabase();
        db.prepare(
          `INSERT INTO sync_history
           (site_id, completed_at, status, new_posts, updated_posts, deleted_posts, unchanged_posts, errors, post_types)
           VALUES (?, datetime('now'), 'completed', ?, ?, 0, ?, ?, ?)`
        ).run(siteId, result.created, result.updated, changes.unchangedCount, result.failed,
          JSON.stringify(parsed.post_types || 'all'));

        database.audit(siteId, 'sync_pull', {
          created: result.created,
          updated: result.updated,
          failed: result.failed,
          slugChanges: result.slugChanges.length,
        });
      }

      return formatSuccessResponse({
        site_id: siteId,
        dry_run: parsed.dry_run || false,
        created: result.created,
        updated: result.updated,
        slug_changes: result.slugChanges,
        failed: result.failed,
        errors: result.errors.slice(0, 10),
        next_steps: result.slugChanges.length > 0
          ? ['Slug changes detected — run generate_redirects to update redirect rules']
          : parsed.dry_run
            ? ['Run sync_pull without dry_run to apply changes']
            : ['Content synced. Run github_commit → github_push to deploy'],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  sync_delete: async (params: unknown) => {
    try {
      const parsed = syncDeleteSchema.parse(params);
      if (!parsed.confirm && !parsed.dry_run) {
        throw new ValidationError('Set confirm=true to delete local files, or use dry_run=true to preview.');
      }

      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const outputDir = getOutputDir(siteId);

      ensureSyncSchema();

      // Detect only deletions
      const changes = await detectChanges(siteId, site, {
        includeDeleted: true,
      });

      if (changes.deletedPosts.length === 0) {
        return formatSuccessResponse({
          site_id: siteId,
          message: 'No deleted posts detected. All local files match WordPress.',
          deleted: 0,
        });
      }

      const result = deleteLocalFiles(siteId, outputDir, changes.deletedPosts, parsed.dry_run || false);

      if (!parsed.dry_run) {
        database.audit(siteId, 'sync_delete', { deleted: result.deleted });
      }

      return formatSuccessResponse({
        site_id: siteId,
        dry_run: parsed.dry_run || false,
        deleted_posts: changes.deletedPosts,
        files_deleted: result.deleted,
        files_not_found: result.notFound,
        next_steps: parsed.dry_run
          ? [`Run sync_delete with confirm=true to remove ${changes.deletedPosts.length} files`]
          : ['Deleted posts removed. Run generate_redirects → github_commit → github_push'],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  sync_full: async (params: unknown) => {
    try {
      const parsed = syncFullSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const outputDir = getOutputDir(siteId);

      ensureSyncSchema();
      const db = database.getDatabase();

      // Start sync history record
      const syncResult = db.prepare(
        `INSERT INTO sync_history (site_id, status, post_types) VALUES (?, 'in_progress', ?)`
      ).run(siteId, JSON.stringify(parsed.post_types || 'all'));
      const syncId = Number(syncResult.lastInsertRowid);

      try {
        // Step 1: Detect all changes
        logger.info('Sync: detecting changes', { siteId });
        const changes = await detectChanges(siteId, site, {
          postTypes: parsed.post_types,
          includeDeleted: parsed.include_deleted,
        });

        const totalChanges = changes.newPosts.length + changes.updatedPosts.length + changes.deletedPosts.length;

        if (totalChanges === 0) {
          db.prepare(
            `UPDATE sync_history SET status = 'completed', completed_at = datetime('now'),
             unchanged_posts = ?, details = '{"message":"no changes"}' WHERE id = ?`
          ).run(changes.unchangedCount, syncId);

          return formatSuccessResponse({
            site_id: siteId,
            sync_id: syncId,
            message: 'Site is up to date. No changes detected.',
            unchanged: changes.unchangedCount,
          });
        }

        // Step 2: Pull new and updated content
        logger.info('Sync: pulling changes', {
          siteId,
          new: changes.newPosts.length,
          updated: changes.updatedPosts.length,
        });
        const pullResult = await pullChanges(siteId, site, outputDir, changes, {
          batchSize: parsed.batch_size,
        });

        // Step 3: Delete removed posts
        let deleteResult = { deleted: 0, notFound: 0 };
        if (parsed.include_deleted && changes.deletedPosts.length > 0) {
          logger.info('Sync: removing deleted posts', { count: changes.deletedPosts.length });
          deleteResult = deleteLocalFiles(siteId, outputDir, changes.deletedPosts, false);
        }

        // Step 4: Auto-commit if requested
        let commitInfo: { committed: boolean; message?: string } = { committed: false };
        if (parsed.auto_commit) {
          try {
            const simpleGitModule = await import('simple-git');
            const simpleGit = simpleGitModule.simpleGit || simpleGitModule.default;
            const git = simpleGit(outputDir);

            const status = await git.status();
            if (status.files.length > 0) {
              await git.add('.');
              const message = parsed.commit_message ||
                `Sync: ${pullResult.created} new, ${pullResult.updated} updated, ${deleteResult.deleted} deleted`;
              await git.commit(message);
              commitInfo = { committed: true, message };
            }
          } catch (error) {
            logger.warn('Auto-commit failed', { error: error instanceof Error ? error.message : String(error) });
          }
        }

        // Update sync history
        db.prepare(
          `UPDATE sync_history SET
           status = 'completed', completed_at = datetime('now'),
           new_posts = ?, updated_posts = ?, deleted_posts = ?,
           unchanged_posts = ?, errors = ?,
           details = ?
          WHERE id = ?`
        ).run(
          pullResult.created, pullResult.updated, deleteResult.deleted,
          changes.unchangedCount, pullResult.failed,
          JSON.stringify({
            slug_changes: pullResult.slugChanges,
            errors: pullResult.errors.slice(0, 5),
            commit: commitInfo,
          }),
          syncId
        );

        database.audit(siteId, 'sync_full', {
          sync_id: syncId,
          created: pullResult.created,
          updated: pullResult.updated,
          deleted: deleteResult.deleted,
          failed: pullResult.failed,
        });

        return formatSuccessResponse({
          site_id: siteId,
          sync_id: syncId,
          summary: {
            new_posts: pullResult.created,
            updated_posts: pullResult.updated,
            deleted_posts: deleteResult.deleted,
            unchanged: changes.unchangedCount,
            failed: pullResult.failed,
          },
          slug_changes: pullResult.slugChanges,
          errors: pullResult.errors.slice(0, 10),
          commit: commitInfo,
          next_steps: [
            ...(pullResult.slugChanges.length > 0 ? ['Run generate_redirects to update redirect rules'] : []),
            ...(commitInfo.committed ? ['Run github_push to deploy'] : ['Run github_commit → github_push to deploy']),
            ...(pullResult.failed > 0 ? [`${pullResult.failed} posts failed — check errors above`] : []),
          ],
        });
      } catch (error) {
        db.prepare(
          "UPDATE sync_history SET status = 'failed', completed_at = datetime('now'), details = ? WHERE id = ?"
        ).run(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), syncId);
        throw error;
      }
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  sync_status: async (params: unknown) => {
    try {
      const parsed = syncStatusSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);

      ensureSyncSchema();
      const db = database.getDatabase();

      const history = db.prepare(
        `SELECT * FROM sync_history WHERE site_id = ? ORDER BY id DESC LIMIT ?`
      ).all(siteId, parsed.limit || 10) as Array<{
        id: number; started_at: string; completed_at: string; status: string;
        new_posts: number; updated_posts: number; deleted_posts: number;
        unchanged_posts: number; errors: number; post_types: string; details: string;
      }>;

      const lastSync = getLastSyncTime(siteId);

      // Count total exported posts
      const totalExported = (db.prepare(
        `SELECT COUNT(DISTINCT wp_post_id) as count FROM export_posts
         WHERE site_id = ? AND status = 'completed'`
      ).get(siteId) as { count: number })?.count || 0;

      return formatSuccessResponse({
        site_id: siteId,
        last_sync: lastSync || 'never',
        total_exported_posts: totalExported,
        sync_history: history.map(h => ({
          id: h.id,
          started_at: h.started_at,
          completed_at: h.completed_at,
          status: h.status,
          new_posts: h.new_posts,
          updated_posts: h.updated_posts,
          deleted_posts: h.deleted_posts,
          unchanged: h.unchanged_posts,
          errors: h.errors,
        })),
        next_steps: lastSync
          ? ['Run sync_check to see pending changes', 'Run sync_full to sync everything']
          : ['No previous sync found. Run sync_full to do initial sync'],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  sync_schedule: async (params: unknown) => {
    try {
      const parsed = syncScheduleSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const outputDir = parsed.output_dir || getOutputDir(siteId);
      const branch = parsed.branch || 'main';

      const cronMap: Record<string, string> = {
        'hourly': '0 * * * *',
        'every-6h': '0 */6 * * *',
        'every-12h': '0 */12 * * *',
        'daily': '0 6 * * *',
        'weekly': '0 6 * * 1',
      };
      const cron = cronMap[parsed.interval || 'daily'];

      let filePath = '';
      let content = '';

      switch (parsed.platform) {
        case 'github-actions':
          filePath = path.join(outputDir, '.github', 'workflows', 'sync-content.yml');
          content = generateGitHubActionsWorkflow(site, siteId, cron, branch);
          break;

        case 'cron':
          filePath = path.join(outputDir, 'scripts', 'sync.sh');
          content = generateCronScript(site, siteId, outputDir);
          break;

        case 'netlify':
          filePath = path.join(outputDir, 'netlify', 'functions', 'sync-webhook.mts');
          content = generateNetlifyWebhook(site, siteId);
          break;

        case 'vercel':
          filePath = path.join(outputDir, 'api', 'sync-webhook.ts');
          content = generateVercelWebhook(site, siteId);
          break;
      }

      if (filePath && content) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
      }

      return formatSuccessResponse({
        site_id: siteId,
        platform: parsed.platform,
        interval: parsed.interval || 'daily',
        cron_expression: cron,
        file_created: path.relative(outputDir, filePath),
        next_steps: getScheduleNextSteps(parsed.platform, site),
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  sync_reset: async (params: unknown) => {
    try {
      const parsed = syncResetSchema.parse(params);
      if (!parsed.confirm) {
        throw new ValidationError('Set confirm=true to reset sync tracking data.');
      }

      const siteId = siteManager.resolveSiteId(parsed.site_id);
      ensureSyncSchema();
      const db = database.getDatabase();

      // Clear sync history
      const historyResult = db.prepare('DELETE FROM sync_history WHERE site_id = ?').run(siteId);

      // Clear wp_modified_gmt from export_posts (forces re-check)
      db.prepare('UPDATE export_posts SET wp_modified_gmt = NULL WHERE site_id = ?').run(siteId);

      database.audit(siteId, 'sync_reset', { history_deleted: historyResult.changes });

      return formatSuccessResponse({
        site_id: siteId,
        message: 'Sync tracking data cleared. Next sync_pull will re-check all posts.',
        history_records_deleted: historyResult.changes,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },
};

// ============================================================
// Schedule Generators
// ============================================================

function generateGitHubActionsWorkflow(site: SiteConfig, siteId: string, cron: string, branch: string): string {
  return `# Auto-generated by WP Astro MCP — Content Sync Workflow
# Keeps the Astro site in sync with WordPress content changes.
#
# Required secrets:
#   WP_SITE_URL      — WordPress site URL (e.g., https://example.com)
#   WP_USERNAME      — WordPress username
#   WP_APP_PASSWORD  — WordPress application password

name: Sync WordPress Content

on:
  schedule:
    - cron: '${cron}'
  workflow_dispatch:
    inputs:
      force:
        description: 'Force re-sync all posts'
        required: false
        default: 'false'
        type: boolean

permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${branch}

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Sync content from WordPress
        env:
          WP_SITE_URL: \${{ secrets.WP_SITE_URL }}
          WP_USERNAME: \${{ secrets.WP_USERNAME }}
          WP_APP_PASSWORD: \${{ secrets.WP_APP_PASSWORD }}
        run: |
          # Install wp-astro-mcp globally for CLI access
          npm install -g wp-astro-mcp

          # Run sync (uses MCP server in CLI mode)
          node -e "
            import { syncHandlers } from 'wp-astro-mcp/dist/tools/sync.js';
            const result = await syncHandlers.sync_full({
              site_id: '${siteId}',
              include_deleted: true,
              force: process.env.FORCE === 'true',
            });
            console.log(JSON.stringify(result, null, 2));
          "

      - name: Commit and push changes
        run: |
          git config user.name "WordPress Sync Bot"
          git config user.email "sync@${site.url?.replace('https://', '').replace('http://', '') || 'example.com'}"
          git add -A
          if git diff --staged --quiet; then
            echo "No content changes to commit"
          else
            TIMESTAMP=\$(date -u +"%Y-%m-%d %H:%M UTC")
            git commit -m "sync: update content from WordPress (\$TIMESTAMP)"
            git push origin ${branch}
          fi
`;
}

function generateCronScript(_site: SiteConfig, _siteId: string, outputDir: string): string {
  return `#!/bin/bash
# Auto-generated by WP Astro MCP — Content Sync Script
# Add to crontab: 0 6 * * * /path/to/sync.sh
#
# Prerequisites:
#   - Node.js 18+ installed
#   - wp-astro-mcp installed globally (npm i -g wp-astro-mcp)
#   - Git configured with push access

set -euo pipefail

SITE_DIR="${outputDir.replace(/\\/g, '/')}"
LOG_FILE="\$SITE_DIR/sync.log"

echo "=== WordPress Content Sync ===" >> "\$LOG_FILE"
echo "Started: \$(date -u)" >> "\$LOG_FILE"

cd "\$SITE_DIR"

# Pull latest
git pull origin main --rebase

# Run sync via Node.js
node -e "
  import { syncHandlers } from 'wp-astro-mcp/dist/tools/sync.js';
  const result = await syncHandlers.sync_full({
    include_deleted: true,
    auto_commit: true,
  });
  console.log(JSON.stringify(result, null, 2));
" >> "\$LOG_FILE" 2>&1

# Push if there are commits
if git log origin/main..HEAD --oneline | grep -q .; then
  git push origin main
  echo "Changes pushed to remote" >> "\$LOG_FILE"
else
  echo "No changes to push" >> "\$LOG_FILE"
fi

echo "Completed: \$(date -u)" >> "\$LOG_FILE"
echo "" >> "\$LOG_FILE"
`;
}

function generateNetlifyWebhook(_site: SiteConfig, siteId: string): string {
  return `// Auto-generated by WP Astro MCP — Netlify Webhook for Content Sync
// Deploy as a Netlify Function. Trigger via WordPress webhook plugin on post save/update/delete.
//
// Setup:
// 1. Install "WP Webhooks" or similar plugin in WordPress
// 2. Add webhook URL: https://your-site.netlify.app/.netlify/functions/sync-webhook
// 3. Set the SYNC_SECRET environment variable in Netlify
// 4. Configure WordPress to send POST on: post_published, post_updated, post_deleted

import type { Context } from "@netlify/functions";

export default async (request: Request, _context: Context) => {
  // Verify webhook secret
  const secret = Netlify.env.get("SYNC_SECRET");
  const authHeader = request.headers.get("x-webhook-secret");

  if (!secret || authHeader !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.json() as { action?: string; post_id?: number; post_type?: string };

  console.log(\`WordPress webhook: \${body.action} on \${body.post_type} #\${body.post_id}\`);

  // Trigger a new Netlify build (which runs the sync during build)
  // The actual sync happens in the build command
  const buildHookUrl = Netlify.env.get("BUILD_HOOK_URL");
  if (buildHookUrl) {
    await fetch(buildHookUrl, {
      method: "POST",
      body: JSON.stringify({
        site_id: "${siteId}",
        trigger: body.action,
        post_id: body.post_id,
      }),
    });
  }

  return new Response(JSON.stringify({
    status: "ok",
    message: "Build triggered",
    action: body.action,
    post_id: body.post_id,
  }), {
    headers: { "Content-Type": "application/json" },
  });
};
`;
}

function generateVercelWebhook(_site: SiteConfig, siteId: string): string {
  return `// Auto-generated by WP Astro MCP — Vercel Webhook for Content Sync
// Deploy as a Vercel Serverless Function. Trigger via WordPress webhook plugin.
//
// Setup:
// 1. Install "WP Webhooks" or similar plugin in WordPress
// 2. Add webhook URL: https://your-site.vercel.app/api/sync-webhook
// 3. Set SYNC_SECRET and VERCEL_DEPLOY_HOOK in Vercel environment
// 4. Configure WordPress to send POST on: post_published, post_updated, post_deleted

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify webhook secret
  const secret = process.env.SYNC_SECRET;
  const authHeader = req.headers["x-webhook-secret"];

  if (!secret || authHeader !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { action, post_id, post_type } = req.body || {};

  console.log(\`WordPress webhook: \${action} on \${post_type} #\${post_id}\`);

  // Trigger a new Vercel deployment
  const deployHook = process.env.VERCEL_DEPLOY_HOOK;
  if (deployHook) {
    await fetch(deployHook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_id: "${siteId}",
        trigger: action,
        post_id,
      }),
    });
  }

  return res.json({
    status: "ok",
    message: "Deployment triggered",
    action,
    post_id,
  });
}
`;
}

function getScheduleNextSteps(platform: string, site: SiteConfig): string[] {
  const siteHost = site.url?.replace('https://', '').replace('http://', '') || 'example.com';

  switch (platform) {
    case 'github-actions':
      return [
        'Add secrets to your GitHub repo: WP_SITE_URL, WP_USERNAME, WP_APP_PASSWORD',
        'Push the workflow file to trigger the first run',
        'The workflow runs on schedule and can be triggered manually from the Actions tab',
      ];
    case 'cron':
      return [
        'Make the script executable: chmod +x scripts/sync.sh',
        `Add to crontab: crontab -e → paste the cron line from the script`,
        'Ensure Node.js and git are available in the cron environment',
      ];
    case 'netlify':
      return [
        'Deploy the function to Netlify',
        'Set SYNC_SECRET and BUILD_HOOK_URL in Netlify environment',
        `Create a build hook in Netlify → Site Settings → Build & Deploy → Build hooks`,
        `Install "WP Webhooks" in WordPress and point to https://${siteHost}/.netlify/functions/sync-webhook`,
      ];
    case 'vercel':
      return [
        'Deploy the API route to Vercel',
        'Set SYNC_SECRET and VERCEL_DEPLOY_HOOK in Vercel environment',
        `Create a deploy hook in Vercel → Project Settings → Git → Deploy hooks`,
        `Install "WP Webhooks" in WordPress and point to https://${siteHost}/api/sync-webhook`,
      ];
    default:
      return [];
  }
}
