/**
 * Zod schemas for content sync tools
 */

import { z } from 'zod';

export const syncCheckSchema = z.object({
  site_id: z.string().optional(),
  post_types: z.array(z.string()).optional().describe('Post types to check (default: all exported types)'),
  since: z.string().optional().describe('Check changes since this ISO date (default: last sync time)'),
  include_deleted: z.boolean().optional().default(true).describe('Check for deleted posts (slower, queries WP per post)'),
});

export const syncPullSchema = z.object({
  site_id: z.string().optional(),
  post_types: z.array(z.string()).optional().describe('Post types to sync (default: all exported types)'),
  batch_size: z.number().optional().default(25).describe('Posts to process per batch (default: 25)'),
  dry_run: z.boolean().optional().default(false).describe('Preview changes without writing files'),
  force: z.boolean().optional().default(false).describe('Force re-sync all posts, ignoring modified dates'),
});

export const syncDeleteSchema = z.object({
  site_id: z.string().optional(),
  confirm: z.boolean().describe('Must be true to delete local files'),
  dry_run: z.boolean().optional().default(false).describe('Preview deletions without removing files'),
});

export const syncFullSchema = z.object({
  site_id: z.string().optional(),
  post_types: z.array(z.string()).optional(),
  batch_size: z.number().optional().default(25),
  include_deleted: z.boolean().optional().default(true),
  auto_commit: z.boolean().optional().default(false).describe('Auto-commit changes to git after sync'),
  commit_message: z.string().optional().describe('Custom commit message (default: auto-generated)'),
});

export const syncStatusSchema = z.object({
  site_id: z.string().optional(),
  limit: z.number().optional().default(10).describe('Number of recent syncs to show'),
});

export const syncScheduleSchema = z.object({
  site_id: z.string().optional(),
  platform: z.enum(['github-actions', 'cron', 'netlify', 'vercel', 'wordpress-plugin']).describe('Platform for scheduled sync'),
  interval: z.enum(['hourly', 'every-6h', 'every-12h', 'daily', 'weekly']).optional().default('daily'),
  output_dir: z.string().optional().describe('Output directory for config file'),
  branch: z.string().optional().default('main').describe('Git branch to sync to'),
});

export const syncResetSchema = z.object({
  site_id: z.string().optional(),
  confirm: z.boolean().describe('Must be true to reset sync tracking'),
});

export const syncWebhookSchema = z.object({
  site_id: z.string().optional(),
  action: z.string().describe('Webhook action (post_published, post_updated, post_trashed, post_unpublished)'),
  post_id: z.number().describe('WordPress post ID'),
  post_type: z.string().optional().default('post'),
  slug: z.string().optional(),
  signature: z.string().optional().describe('HMAC-SHA256 signature for verification'),
  payload_raw: z.string().optional().describe('Raw JSON payload for signature verification'),
});
