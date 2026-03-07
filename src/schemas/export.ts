/**
 * Zod schemas for export pipeline tools
 */

import { z } from 'zod';

export const exportPlanSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
});

export const exportStartSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  output_dir: z.string().optional().describe('Output directory (uses site export config if omitted)'),
  post_types: z.array(z.string()).optional().describe('Post types to export (default: all)'),
  batch_size: z.number().min(1).max(100).optional().describe('Posts per batch (default: 25)'),
});

export const exportProgressSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  job_id: z.number().optional().describe('Specific job ID (default: latest for site)'),
});

export const exportResumeSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  job_id: z.number().optional().describe('Job ID to resume (default: latest incomplete)'),
  batch_size: z.number().min(1).max(100).optional().describe('Posts per batch (default: 25)'),
});

export const exportRetrySchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  job_id: z.number().optional().describe('Job ID (default: latest for site)'),
});

export const exportValidateSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  job_id: z.number().optional().describe('Job ID (default: latest for site)'),
});

export const exportCleanupSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  job_id: z.number().optional().describe('Job ID to clean up'),
  confirm: z.boolean().optional().describe('Must be true to delete data'),
});

export type ExportPlanParams = z.infer<typeof exportPlanSchema>;
export type ExportStartParams = z.infer<typeof exportStartSchema>;
export type ExportProgressParams = z.infer<typeof exportProgressSchema>;
export type ExportResumeParams = z.infer<typeof exportResumeSchema>;
export type ExportRetryParams = z.infer<typeof exportRetrySchema>;
