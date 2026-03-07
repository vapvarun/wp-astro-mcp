/**
 * Zod schemas for extract and content tools
 */

import { z } from 'zod';

export const extractPostsSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  post_type: z.string().optional().describe('Post type slug (default: post)'),
  page: z.number().min(1).optional().describe('Page number'),
  per_page: z.number().min(1).max(100).optional().describe('Posts per page (max 100)'),
  status: z.string().optional().describe('Post status filter (publish, draft, any)'),
  after: z.string().optional().describe('Only posts after this date (ISO 8601)'),
  before: z.string().optional().describe('Only posts before this date (ISO 8601)'),
  search: z.string().optional().describe('Search query'),
  fields: z.string().optional().describe('Comma-separated fields to return'),
});

export const extractPostSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  post_id: z.number().describe('WordPress post ID'),
  post_type: z.string().optional().describe('Post type slug (default: post)'),
});

export const extractTermsSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  taxonomy: z.string().optional().describe('Taxonomy slug (default: category)'),
  page: z.number().min(1).optional().describe('Page number'),
  per_page: z.number().min(1).max(100).optional().describe('Per page (max 100)'),
});

export const extractAuthorsSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
});

export const extractMediaSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  media_id: z.number().optional().describe('Specific media ID'),
  page: z.number().min(1).optional().describe('Page number'),
  per_page: z.number().min(1).max(100).optional().describe('Per page (max 100)'),
});

export const extractMenusSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
});

export const extractCommentsSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  post_id: z.number().optional().describe('Filter by post ID'),
  page: z.number().min(1).optional().describe('Page number'),
  per_page: z.number().min(1).max(100).optional().describe('Per page (max 100)'),
});

export const extractSettingsSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
});

export const extractWidgetsSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
});

export const cacheTermsSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
});

export const cacheAuthorsSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
});

export const extractAllIdsSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  post_type: z.string().optional().describe('Post type slug (default: post)'),
  status: z.string().optional().describe('Post status (default: any)'),
});

export const contentAuditSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  sample_size: z.number().min(1).max(50).optional().describe('Number of posts to sample (default: 10)'),
});

export type ExtractPostsParams = z.infer<typeof extractPostsSchema>;
export type ExtractPostParams = z.infer<typeof extractPostSchema>;
export type ExtractTermsParams = z.infer<typeof extractTermsSchema>;
export type ExtractAuthorsParams = z.infer<typeof extractAuthorsSchema>;
export type ExtractMediaParams = z.infer<typeof extractMediaSchema>;
export type ExtractMenusParams = z.infer<typeof extractMenusSchema>;
export type ExtractCommentsParams = z.infer<typeof extractCommentsSchema>;
export type ContentAuditParams = z.infer<typeof contentAuditSchema>;
