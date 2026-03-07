/**
 * Zod schemas for transform tools
 */

import { z } from 'zod';

export const convertPostSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  post_id: z.number().describe('WordPress post ID to convert'),
  post_type: z.string().optional().describe('Post type slug (default: post)'),
});

export const convertPreviewSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  post_type: z.string().optional().describe('Post type to sample (default: post)'),
  count: z.number().min(1).max(10).optional().describe('Number of posts to preview (default: 3)'),
});

export const convertHtmlSchema = z.object({
  site_id: z.string().optional().describe('Site ID for link rewriting (optional)'),
  html: z.string().describe('Raw HTML to convert to Markdown'),
  title: z.string().optional().describe('Title for frontmatter'),
});

export const shortcodeListSchema = z.object({
  site_id: z.string().describe('Site ID'),
});

export const shortcodeConfigureSchema = z.object({
  site_id: z.string().describe('Site ID'),
  shortcode: z.string().describe('Shortcode tag name'),
  action: z.enum(['strip', 'keep_content', 'remove', 'component', 'html']).describe('How to handle this shortcode'),
  component: z.string().optional().describe('Astro component name (for action=component)'),
});

export const shortcodeScanSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  sample_size: z.number().min(1).max(100).optional().describe('Number of posts to scan (default: 20)'),
});

export type ConvertPostParams = z.infer<typeof convertPostSchema>;
export type ConvertPreviewParams = z.infer<typeof convertPreviewSchema>;
export type ConvertHtmlParams = z.infer<typeof convertHtmlSchema>;
export type ShortcodeListParams = z.infer<typeof shortcodeListSchema>;
export type ShortcodeConfigureParams = z.infer<typeof shortcodeConfigureSchema>;
export type ShortcodeScanParams = z.infer<typeof shortcodeScanSchema>;
