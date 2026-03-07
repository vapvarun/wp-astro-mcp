/**
 * Export Pipeline Tools
 * Batch processing engine with SQLite state tracking, resumability,
 * progress reporting, retry, and validation.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { siteManager } from '../config/sites.js';
import { wpClient } from '../services/wp-rest-client.js';
import { database } from '../config/database.js';
import { writePost, writePostToJson } from '../services/content-writer.js';
import { formatSuccessResponse, formatErrorResponse, ValidationError } from '../utils/errors.js';
import {
  exportPlanSchema,
  exportStartSchema,
  exportProgressSchema,
  exportResumeSchema,
  exportRetrySchema,
  exportValidateSchema,
  exportCleanupSchema,
} from '../schemas/export.js';
import logger from '../utils/logger.js';

function resolveOutputDir(siteId: string, paramDir?: string): string {
  const site = siteManager.getSite(siteId);
  const dir = paramDir || site.export?.output_dir;
  if (!dir) {
    throw new ValidationError('No output directory specified. Set it via site_export_config or pass output_dir parameter.');
  }
  return dir;
}

export const exportTools: Tool[] = [
  {
    name: 'export_plan',
    description:
      'Generate a full migration plan: content counts by type, estimated time, recommended batch size, and pre-flight checks.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
      },
    },
  },
  {
    name: 'export_start',
    description:
      'Start a full batch export. Creates a job in SQLite, fetches all post IDs, and begins processing in batches. Returns after the first batch — use export_resume to continue.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        output_dir: { type: 'string', description: 'Output directory (uses site export config if omitted)' },
        post_types: { type: 'array', items: { type: 'string' }, description: 'Post types to export (default: all)' },
        batch_size: { type: 'number', description: 'Posts per batch (default: 25, max: 100)' },
      },
    },
  },
  {
    name: 'export_resume',
    description:
      'Resume an in-progress export. Processes the next batch of pending posts. Call repeatedly until complete.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        job_id: { type: 'number', description: 'Job ID to resume (default: latest incomplete)' },
        batch_size: { type: 'number', description: 'Posts per batch (default: 25)' },
      },
    },
  },
  {
    name: 'export_progress',
    description: 'Show progress of an export job: completion percentage, posts done/failed/pending, estimated time remaining.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        job_id: { type: 'number', description: 'Job ID (default: latest for site)' },
      },
    },
  },
  {
    name: 'export_retry',
    description: 'Retry all failed posts in an export job.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        job_id: { type: 'number', description: 'Job ID (default: latest for site)' },
      },
    },
  },
  {
    name: 'export_validate',
    description: 'Validate an export job: check all output files exist, report issues, and verify completeness.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        job_id: { type: 'number', description: 'Job ID (default: latest for site)' },
      },
    },
  },
  {
    name: 'export_cleanup',
    description: 'Delete export job data from database (does not delete files). Requires confirm=true.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        job_id: { type: 'number', description: 'Job ID to clean up' },
        confirm: { type: 'boolean', description: 'Must be true to proceed' },
      },
    },
  },
];

export const exportHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
  export_plan: async (params: unknown) => {
    try {
      const parsed = exportPlanSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);

      // Gather content counts
      const postTypes = site.post_types?.filter(
        (pt) => !['attachment', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles'].includes(pt.slug)
      ) || [];

      const includePt = site.export?.include_post_types;
      const excludePt = site.export?.exclude_post_types;

      const typesToExport = postTypes.filter((pt) => {
        if (includePt && includePt.length > 0) return includePt.includes(pt.slug);
        if (excludePt && excludePt.length > 0) return !excludePt.includes(pt.slug);
        return true;
      });

      const counts: Array<{ type: string; name: string; restBase: string; count: number }> = [];
      let totalPosts = 0;

      for (const pt of typesToExport) {
        try {
          const { pagination } = await wpClient.fetchPosts(siteId, {
            restBase: pt.rest_base,
            perPage: 1,
            status: site.export?.include_statuses?.join(',') || 'publish',
          });
          counts.push({ type: pt.slug, name: pt.name, restBase: pt.rest_base, count: pagination.total });
          totalPosts += pagination.total;
        } catch (_e: unknown) {
          counts.push({ type: pt.slug, name: pt.name, restBase: pt.rest_base, count: 0 });
        }
      }

      // Pre-flight checks
      const checks: Array<{ check: string; status: 'pass' | 'warn' | 'fail'; message: string }> = [];

      checks.push({
        check: 'output_dir',
        status: site.export?.output_dir ? 'pass' : 'fail',
        message: site.export?.output_dir
          ? `Output: ${site.export.output_dir}`
          : 'No output directory configured. Run site_export_config first.',
      });

      checks.push({
        check: 'content_format',
        status: 'pass',
        message: `Format: ${site.export?.content_format || 'md'}`,
      });

      checks.push({
        check: 'media_strategy',
        status: 'pass',
        message: `Media: ${site.export?.media_strategy || 'keep'} ${site.export?.media_domain ? `(→ ${site.export.media_domain})` : ''}`,
      });

      checks.push({
        check: 'deploy_platform',
        status: site.export?.deploy_platform && site.export.deploy_platform !== 'none' ? 'pass' : 'warn',
        message: `Deploy: ${site.export?.deploy_platform || 'none'}`,
      });

      const allPass = checks.every((c) => c.status !== 'fail');
      const estimatedMinutes = Math.ceil(totalPosts / 120); // ~2 posts/sec with API overhead
      const recommendedBatchSize = totalPosts > 500 ? 50 : 25;

      return formatSuccessResponse({
        site_id: siteId,
        site_name: site.name,
        content_to_export: counts,
        total_posts: totalPosts,
        estimate: {
          minutes: estimatedMinutes,
          batches: Math.ceil(totalPosts / recommendedBatchSize),
          recommended_batch_size: recommendedBatchSize,
        },
        preflight_checks: checks,
        ready: allPass,
        next_steps: allPass
          ? [`Run export_start to begin exporting ${totalPosts} posts`]
          : checks.filter((c) => c.status === 'fail').map((c) => c.message),
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  export_start: async (params: unknown) => {
    try {
      const parsed = exportStartSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const outputDir = resolveOutputDir(siteId, parsed.output_dir);
      const batchSize = parsed.batch_size || 25;

      const db = database.getDatabase();

      // Determine which post types to export
      const allPostTypes = site.post_types?.filter(
        (pt) => !['attachment', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles'].includes(pt.slug)
      ) || [{ slug: 'post', rest_base: 'posts', name: 'Posts', hierarchical: false, has_archive: true }];

      const exportPostTypes = parsed.post_types
        ? allPostTypes.filter((pt) => parsed.post_types!.includes(pt.slug))
        : allPostTypes;

      // Create export job
      const configJson = JSON.stringify(site.export || {});
      const jobResult = db.prepare(
        `INSERT INTO export_jobs (site_id, output_dir, source_type, status, config, started_at)
         VALUES (?, ?, 'api', 'in_progress', ?, datetime('now'))`
      ).run(siteId, outputDir, configJson);
      const jobId = Number(jobResult.lastInsertRowid);

      // Fetch all post IDs for each type and register in export_posts
      let totalPosts = 0;
      const insertPost = db.prepare(
        `INSERT OR IGNORE INTO export_posts (job_id, site_id, wp_post_id, post_type, status)
         VALUES (?, ?, ?, ?, 'pending')`
      );

      for (const pt of exportPostTypes) {
        try {
          const ids = await wpClient.fetchAllPostIds(siteId, pt.rest_base, site.export?.include_statuses?.join(',') || 'publish');
          const insertBatch = db.transaction((postIds: number[]) => {
            for (const id of postIds) {
              insertPost.run(jobId, siteId, id, pt.slug);
            }
          });
          insertBatch(ids);
          totalPosts += ids.length;
          logger.info('Registered posts for export', { siteId, postType: pt.slug, count: ids.length });
        } catch (error) {
          logger.warn('Failed to fetch IDs for post type', { siteId, postType: pt.slug, error: error instanceof Error ? error.message : String(error) });
        }
      }

      // Update job with total count
      db.prepare('UPDATE export_jobs SET total_posts = ? WHERE id = ?').run(totalPosts, jobId);

      // Process first batch
      const batchResult = await processNextBatch(jobId, siteId, site, outputDir, batchSize);

      database.audit(siteId, 'export_start', { job_id: jobId, total: totalPosts, first_batch: batchResult.processed });

      return formatSuccessResponse({
        site_id: siteId,
        job_id: jobId,
        total_posts: totalPosts,
        first_batch: batchResult,
        status: batchResult.remaining > 0 ? 'in_progress' : 'completed',
        next_steps: batchResult.remaining > 0
          ? [`Run export_resume to continue (${batchResult.remaining} posts remaining)`]
          : ['Export complete! Run export_validate to verify, then generate_redirects'],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  export_resume: async (params: unknown) => {
    try {
      const parsed = exportResumeSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const batchSize = parsed.batch_size || 25;

      const db = database.getDatabase();

      // Find job
      const job = parsed.job_id
        ? db.prepare('SELECT * FROM export_jobs WHERE id = ? AND site_id = ?').get(parsed.job_id, siteId) as Record<string, unknown> | undefined
        : db.prepare("SELECT * FROM export_jobs WHERE site_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1").get(siteId) as Record<string, unknown> | undefined;

      if (!job) {
        throw new ValidationError('No active export job found. Run export_start first.');
      }

      const jobId = job.id as number;
      const outputDir = job.output_dir as string;

      const batchResult = await processNextBatch(jobId, siteId, site, outputDir, batchSize);

      // Check if completed
      if (batchResult.remaining === 0) {
        db.prepare("UPDATE export_jobs SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(jobId);
      }

      return formatSuccessResponse({
        site_id: siteId,
        job_id: jobId,
        batch: batchResult,
        status: batchResult.remaining > 0 ? 'in_progress' : 'completed',
        next_steps: batchResult.remaining > 0
          ? [`Run export_resume again (${batchResult.remaining} posts remaining)`]
          : ['Export complete! Run export_validate, then generate_redirects'],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  export_progress: async (params: unknown) => {
    try {
      const parsed = exportProgressSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const db = database.getDatabase();

      const job = parsed.job_id
        ? db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(parsed.job_id) as Record<string, unknown> | undefined
        : db.prepare('SELECT * FROM export_jobs WHERE site_id = ? ORDER BY id DESC LIMIT 1').get(siteId) as Record<string, unknown> | undefined;

      if (!job) {
        return formatSuccessResponse({
          site_id: siteId,
          message: 'No export jobs found for this site.',
        });
      }

      const jobId = job.id as number;

      // Count statuses
      const statusCounts = db.prepare(
        `SELECT status, COUNT(*) as count FROM export_posts WHERE job_id = ? GROUP BY status`
      ).all(jobId) as Array<{ status: string; count: number }>;

      const counts: Record<string, number> = {};
      for (const row of statusCounts) {
        counts[row.status] = row.count;
      }

      const total = job.total_posts as number;
      const completed = counts.completed || 0;
      const failed = counts.failed || 0;
      const pending = counts.pending || 0;
      const inProgress = counts.in_progress || 0;
      const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

      // Recent issues
      const recentIssues = db.prepare(
        `SELECT wp_post_id, title, error_message FROM export_posts
         WHERE job_id = ? AND status = 'failed' ORDER BY updated_at DESC LIMIT 5`
      ).all(jobId) as Array<{ wp_post_id: number; title: string; error_message: string }>;

      return formatSuccessResponse({
        site_id: siteId,
        job_id: jobId,
        status: job.status,
        progress: {
          total,
          completed,
          failed,
          pending,
          in_progress: inProgress,
          percentage,
        },
        started_at: job.started_at,
        updated_at: job.updated_at,
        completed_at: job.completed_at,
        recent_failures: recentIssues,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  export_retry: async (params: unknown) => {
    try {
      const parsed = exportRetrySchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const db = database.getDatabase();

      const job = parsed.job_id
        ? db.prepare('SELECT * FROM export_jobs WHERE id = ? AND site_id = ?').get(parsed.job_id, siteId) as Record<string, unknown> | undefined
        : db.prepare('SELECT * FROM export_jobs WHERE site_id = ? ORDER BY id DESC LIMIT 1').get(siteId) as Record<string, unknown> | undefined;

      if (!job) throw new ValidationError('No export job found.');

      const jobId = job.id as number;
      const outputDir = job.output_dir as string;

      // Reset failed posts to pending
      const resetResult = db.prepare(
        `UPDATE export_posts SET status = 'pending', retry_count = retry_count + 1, error_message = NULL
         WHERE job_id = ? AND status = 'failed'`
      ).run(jobId);

      const retryCount = resetResult.changes;
      if (retryCount === 0) {
        return formatSuccessResponse({
          site_id: siteId,
          job_id: jobId,
          message: 'No failed posts to retry.',
        });
      }

      // Update job status
      db.prepare("UPDATE export_jobs SET status = 'in_progress' WHERE id = ?").run(jobId);

      // Process retries
      const batchResult = await processNextBatch(jobId, siteId, site, outputDir, 25);

      return formatSuccessResponse({
        site_id: siteId,
        job_id: jobId,
        retried: retryCount,
        batch: batchResult,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  export_validate: async (params: unknown) => {
    try {
      const parsed = exportValidateSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const db = database.getDatabase();
      const fs = await import('fs');

      const job = parsed.job_id
        ? db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(parsed.job_id) as Record<string, unknown> | undefined
        : db.prepare('SELECT * FROM export_jobs WHERE site_id = ? ORDER BY id DESC LIMIT 1').get(siteId) as Record<string, unknown> | undefined;

      if (!job) throw new ValidationError('No export job found.');

      const jobId = job.id as number;
      const outputDir = job.output_dir as string;

      // Get all completed posts
      const completedPosts = db.prepare(
        `SELECT wp_post_id, slug, output_path, issues FROM export_posts WHERE job_id = ? AND status = 'completed'`
      ).all(jobId) as Array<{ wp_post_id: number; slug: string; output_path: string; issues: string | null }>;

      let missingFiles = 0;
      let totalIssues = 0;
      const issueBreakdown: Record<string, number> = {};

      for (const post of completedPosts) {
        // Check file exists
        if (post.output_path) {
          const fullPath = require('path').join(outputDir, post.output_path);
          if (!fs.existsSync(fullPath)) {
            missingFiles++;
          }
        }

        // Count issues
        if (post.issues) {
          try {
            const issues = JSON.parse(post.issues) as Array<{ severity: string; code: string }>;
            totalIssues += issues.length;
            for (const issue of issues) {
              issueBreakdown[issue.code] = (issueBreakdown[issue.code] || 0) + 1;
            }
          } catch (_e: unknown) {
            // Invalid JSON in issues field — skip
          }
        }
      }

      const failedCount = (db.prepare(
        "SELECT COUNT(*) as count FROM export_posts WHERE job_id = ? AND status = 'failed'"
      ).get(jobId) as { count: number }).count;

      return formatSuccessResponse({
        site_id: siteId,
        job_id: jobId,
        validation: {
          total_completed: completedPosts.length,
          missing_files: missingFiles,
          failed_posts: failedCount,
          total_issues: totalIssues,
          issue_breakdown: issueBreakdown,
          is_valid: missingFiles === 0 && failedCount === 0,
        },
        next_steps: failedCount > 0
          ? ['Run export_retry to reprocess failed posts']
          : missingFiles > 0
            ? ['Some output files are missing — re-run export_resume']
            : ['Export is valid! Run generate_redirects, then github_init → github_push'],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  export_cleanup: async (params: unknown) => {
    try {
      const parsed = exportCleanupSchema.parse(params);
      if (!parsed.confirm) {
        throw new ValidationError('Set confirm=true to delete export job data.');
      }

      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const db = database.getDatabase();

      if (parsed.job_id) {
        db.prepare('DELETE FROM export_posts WHERE job_id = ?').run(parsed.job_id);
        db.prepare('DELETE FROM export_jobs WHERE id = ?').run(parsed.job_id);

        return formatSuccessResponse({
          site_id: siteId,
          message: `Job ${parsed.job_id} data deleted from database.`,
        });
      }

      // Delete all jobs for site
      const jobs = db.prepare('SELECT id FROM export_jobs WHERE site_id = ?').all(siteId) as Array<{ id: number }>;
      for (const job of jobs) {
        db.prepare('DELETE FROM export_posts WHERE job_id = ?').run(job.id);
      }
      db.prepare('DELETE FROM export_jobs WHERE site_id = ?').run(siteId);

      return formatSuccessResponse({
        site_id: siteId,
        message: `${jobs.length} export jobs deleted from database.`,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },
};

/**
 * Process the next batch of pending posts for an export job
 */
async function processNextBatch(
  jobId: number,
  siteId: string,
  site: import('../types/index.js').SiteConfig,
  outputDir: string,
  batchSize: number
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}> {
  const db = database.getDatabase();

  // Get next batch of pending posts
  const pendingPosts = db.prepare(
    `SELECT id, wp_post_id, post_type FROM export_posts
     WHERE job_id = ? AND status = 'pending'
     ORDER BY id LIMIT ?`
  ).all(jobId, batchSize) as Array<{ id: number; wp_post_id: number; post_type: string }>;

  let succeeded = 0;
  let failed = 0;

  for (const row of pendingPosts) {
    // Mark as in_progress
    db.prepare("UPDATE export_posts SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?").run(row.id);

    try {
      // Resolve rest_base
      const ptInfo = site.post_types?.find((pt) => pt.slug === row.post_type);
      const restBase = ptInfo?.rest_base || (row.post_type === 'post' ? 'posts' : row.post_type === 'page' ? 'pages' : row.post_type);

      // Fetch full post
      const post = await wpClient.fetchPost(siteId, row.wp_post_id, restBase);

      // Convert and write (JSON mode for large sites, markdown for small sites)
      const useJsonMode = site.export?.content_format === 'json';
      const result = useJsonMode
        ? writePostToJson(post, site, outputDir)
        : writePost(post, site, outputDir);

      // Compute content hash for change detection (used by sync)
      const crypto = await import('crypto');
      const contentHash = crypto.createHash('md5')
        .update(post.content?.rendered || '')
        .update(post.modified_gmt || '')
        .digest('hex');

      // Update state (including wp_modified_gmt for sync tracking)
      db.prepare(
        `UPDATE export_posts SET
          status = 'completed',
          slug = ?,
          title = ?,
          output_path = ?,
          input_size = ?,
          output_size = ?,
          conversion_ms = ?,
          content_hash = ?,
          wp_modified_gmt = ?,
          issues = ?,
          updated_at = datetime('now')
        WHERE id = ?`
      ).run(
        result.slug,
        result.title,
        result.outputPath,
        result.inputSize,
        result.outputSize,
        result.conversionMs,
        contentHash,
        post.modified_gmt || null,
        result.issueCount > 0 ? '[]' : null,
        row.id
      );

      succeeded++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      db.prepare(
        `UPDATE export_posts SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(errorMsg, row.id);
      failed++;
      logger.error('Export post failed', { jobId, wpPostId: row.wp_post_id, error: errorMsg });
    }
  }

  // Update job counts
  db.prepare(
    `UPDATE export_jobs SET
      posts_completed = (SELECT COUNT(*) FROM export_posts WHERE job_id = ? AND status = 'completed'),
      posts_failed = (SELECT COUNT(*) FROM export_posts WHERE job_id = ? AND status = 'failed'),
      updated_at = datetime('now')
    WHERE id = ?`
  ).run(jobId, jobId, jobId);

  // Count remaining
  const remaining = (db.prepare(
    "SELECT COUNT(*) as count FROM export_posts WHERE job_id = ? AND status = 'pending'"
  ).get(jobId) as { count: number }).count;

  return { processed: pendingPosts.length, succeeded, failed, remaining };
}
