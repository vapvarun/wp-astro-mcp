/**
 * Zod schemas for site management tools
 */

import { z } from 'zod';

export const siteAddSchema = z.object({
  name: z.string().min(1).describe('Display name for the site'),
  url: z.string().url().describe('WordPress site URL (e.g., https://example.com)'),
  username: z.string().min(1).describe('WordPress username'),
  app_password: z
    .string()
    .min(1)
    .describe('WordPress application password (generate at /wp-admin/profile.php)'),
  id: z.string().optional().describe('Custom site ID (auto-generated from name if omitted)'),
});

export const siteIdSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default site if omitted)'),
});

export const siteUpdateSchema = z.object({
  site_id: z.string().describe('Site ID to update'),
  name: z.string().min(1).optional(),
  url: z.string().url().optional(),
  username: z.string().min(1).optional(),
  app_password: z.string().min(1).optional(),
});

export const siteExportConfigSchema = z.object({
  site_id: z.string().describe('Site ID to configure'),
  output_dir: z.string().optional().describe('Local directory for Astro output'),
  content_format: z.enum(['md', 'mdx']).optional().describe('Markdown format'),
  media_strategy: z
    .enum(['rewrite', 'download', 'keep'])
    .optional()
    .describe('How to handle media URLs'),
  media_domain: z
    .string()
    .optional()
    .describe('Production domain for media (e.g., app.example.com)'),
  include_post_types: z
    .array(z.string())
    .optional()
    .describe('Post types to export (default: all)'),
  exclude_post_types: z
    .array(z.string())
    .optional()
    .describe('Post types to exclude'),
  include_statuses: z
    .array(z.string())
    .optional()
    .describe('Post statuses to include (default: publish)'),
  include_comments: z.boolean().optional().describe('Export comments'),
  include_drafts: z.boolean().optional().describe('Include draft posts'),
  year_month_dirs: z.boolean().optional().describe('Organize posts in year/month dirs'),
  component_library: z
    .enum(['starwind', 'fulldev', 'webcoreui', 'none'])
    .optional()
    .describe('Astro component library to use'),
  deploy_platform: z
    .enum(['vercel', 'netlify', 'cloudflare', 'none'])
    .optional()
    .describe('Deployment platform'),
  github_repo: z.string().optional().describe('GitHub repository name'),
  github_org: z.string().optional().describe('GitHub organization'),
  rate_limit: z.number().min(1).max(50).optional().describe('API requests per second'),
  date_after: z.string().optional().describe('Only export content after this date (YYYY-MM-DD)'),
  date_before: z.string().optional().describe('Only export content before this date (YYYY-MM-DD)'),
  exclude_categories: z.array(z.string()).optional().describe('Category slugs to exclude'),
  exclude_tags: z.array(z.string()).optional().describe('Tag slugs to exclude'),
  exclude_authors: z.array(z.string()).optional().describe('Author slugs to exclude'),
});

export type SiteAddParams = z.infer<typeof siteAddSchema>;
export type SiteIdParams = z.infer<typeof siteIdSchema>;
export type SiteUpdateParams = z.infer<typeof siteUpdateSchema>;
export type SiteExportConfigParams = z.infer<typeof siteExportConfigSchema>;
