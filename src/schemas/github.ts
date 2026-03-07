/**
 * Zod schemas for GitHub tools
 */

import { z } from 'zod';

export const githubInitSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  output_dir: z.string().optional().describe('Output directory (uses site export config if omitted)'),
});

export const githubCreateRepoSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  repo_name: z.string().optional().describe('Repository name (default: site ID)'),
  org: z.string().optional().describe('GitHub organization (default: personal)'),
  private: z.boolean().optional().describe('Create private repo (default: true)'),
  description: z.string().optional().describe('Repository description'),
});

export const githubCommitSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  output_dir: z.string().optional().describe('Output directory (uses site export config if omitted)'),
  message: z.string().optional().describe('Commit message (default: auto-generated)'),
});

export const githubPushSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  output_dir: z.string().optional().describe('Output directory (uses site export config if omitted)'),
  branch: z.string().optional().describe('Branch to push (default: main)'),
});

export const githubStatusSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  output_dir: z.string().optional().describe('Output directory (uses site export config if omitted)'),
});

export const githubDeployConfigSchema = z.object({
  site_id: z.string().optional().describe('Site ID (uses default if omitted)'),
  output_dir: z.string().optional().describe('Output directory (uses site export config if omitted)'),
  platform: z.enum(['vercel', 'netlify', 'cloudflare']).optional().describe('Deploy platform (uses site config if omitted)'),
});

export type GithubInitParams = z.infer<typeof githubInitSchema>;
export type GithubCreateRepoParams = z.infer<typeof githubCreateRepoSchema>;
export type GithubCommitParams = z.infer<typeof githubCommitSchema>;
export type GithubPushParams = z.infer<typeof githubPushSchema>;
export type GithubStatusParams = z.infer<typeof githubStatusSchema>;
