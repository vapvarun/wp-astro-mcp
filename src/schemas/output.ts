/**
 * Zod schemas for output and media tools
 */

import { z } from 'zod';

export const scaffoldProjectSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  output_dir: z.string().optional().describe('Output directory (uses site export config if omitted)'),
  force: z.boolean().optional().describe('Overwrite existing files (default: false)'),
});

export const scaffoldCollectionSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  post_type: z.string().describe('WordPress post type slug'),
  directory: z.string().optional().describe('Collection directory name (default: based on post type)'),
  output_dir: z.string().optional().describe('Output directory (uses site export config if omitted)'),
});

export const writePostSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  post_id: z.number().describe('WordPress post ID'),
  post_type: z.string().optional().describe('Post type slug (default: post)'),
  output_dir: z.string().optional().describe('Output directory (uses site export config if omitted)'),
  dry_run: z.boolean().optional().describe('Preview without writing (default: false)'),
});

export const writeBatchSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  post_type: z.string().optional().describe('Post type slug (default: post)'),
  page: z.number().min(1).optional().describe('Page number'),
  per_page: z.number().min(1).max(100).optional().describe('Posts per page (max 100)'),
  output_dir: z.string().optional().describe('Output directory (uses site export config if omitted)'),
  dry_run: z.boolean().optional().describe('Preview without writing (default: false)'),
});

export const generateRedirectsSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  output_dir: z.string().optional().describe('Output directory (uses site export config if omitted)'),
  format: z.enum(['netlify', 'vercel', 'cloudflare', 'apache', 'nginx']).optional().describe('Redirect format (default: based on deploy_platform)'),
});

export const generateSchemasSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  output_dir: z.string().optional().describe('Output directory (uses site export config if omitted)'),
});

export const mediaAuditSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  output_dir: z.string().optional().describe('Output directory to scan'),
});

export const mediaRewriteSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  output_dir: z.string().optional().describe('Output directory to process'),
  old_domain: z.string().optional().describe('Domain to replace (default: site URL)'),
  new_domain: z.string().describe('New domain for media URLs'),
});

export const listOutputSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  output_dir: z.string().optional().describe('Output directory to inspect'),
});

export type ScaffoldProjectParams = z.infer<typeof scaffoldProjectSchema>;
export type ScaffoldCollectionParams = z.infer<typeof scaffoldCollectionSchema>;
export type WritePostParams = z.infer<typeof writePostSchema>;
export type WriteBatchParams = z.infer<typeof writeBatchSchema>;
export type GenerateRedirectsParams = z.infer<typeof generateRedirectsSchema>;
export type MediaAuditParams = z.infer<typeof mediaAuditSchema>;
export type MediaRewriteParams = z.infer<typeof mediaRewriteSchema>;
