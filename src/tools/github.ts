/**
 * GitHub Tools
 * Git init, repo creation, commit, push, deploy config.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { simpleGit } from 'simple-git';
import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';
import { siteManager } from '../config/sites.js';
import { database } from '../config/database.js';
import { formatSuccessResponse, formatErrorResponse, ValidationError } from '../utils/errors.js';
import {
  githubInitSchema,
  githubCreateRepoSchema,
  githubCommitSchema,
  githubPushSchema,
  githubStatusSchema,
  githubDeployConfigSchema,
} from '../schemas/github.js';
// Logger available for debugging if needed

function resolveOutputDir(siteId: string, paramDir?: string): string {
  const site = siteManager.getSite(siteId);
  const dir = paramDir || site.export?.output_dir;
  if (!dir) {
    throw new ValidationError('No output directory specified. Set it via site_export_config or pass output_dir parameter.');
  }
  return dir;
}

function getOctokit(): Octokit {
  const token = siteManager.getGitHubToken();
  if (!token) {
    throw new ValidationError('GitHub token not configured. Set github_token in config/sites.json.');
  }
  return new Octokit({ auth: token });
}

export const githubTools: Tool[] = [
  {
    name: 'github_init',
    description: 'Initialize a git repository in the output directory. Creates .gitignore and initial commit.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        output_dir: { type: 'string', description: 'Output directory (uses site export config if omitted)' },
      },
    },
  },
  {
    name: 'github_create_repo',
    description: 'Create a GitHub repository and set it as the remote origin. Requires github_token in config.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        repo_name: { type: 'string', description: 'Repository name (default: site ID)' },
        org: { type: 'string', description: 'GitHub organization (default: personal)' },
        private: { type: 'boolean', description: 'Create private repo (default: true)' },
        description: { type: 'string', description: 'Repository description' },
      },
    },
  },
  {
    name: 'github_commit',
    description: 'Stage all changes and create a commit in the output directory.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        output_dir: { type: 'string', description: 'Output directory (uses site export config if omitted)' },
        message: { type: 'string', description: 'Commit message (default: auto-generated)' },
      },
    },
  },
  {
    name: 'github_push',
    description: 'Push commits to the remote repository.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        output_dir: { type: 'string', description: 'Output directory (uses site export config if omitted)' },
        branch: { type: 'string', description: 'Branch to push (default: main)' },
      },
    },
  },
  {
    name: 'github_status',
    description: 'Show git status of the output directory (branch, changes, remote).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        output_dir: { type: 'string', description: 'Output directory (uses site export config if omitted)' },
      },
    },
  },
  {
    name: 'github_deploy_config',
    description: 'Generate deploy platform configuration (Vercel, Netlify, or Cloudflare Pages).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
        output_dir: { type: 'string', description: 'Output directory (uses site export config if omitted)' },
        platform: { type: 'string', enum: ['vercel', 'netlify', 'cloudflare'], description: 'Deploy platform' },
      },
    },
  },
];

export const githubHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
  github_init: async (params: unknown) => {
    try {
      const parsed = githubInitSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const outputDir = resolveOutputDir(siteId, parsed.output_dir);

      const git = simpleGit(outputDir);
      const isRepo = await git.checkIsRepo().catch(() => false);

      if (isRepo) {
        return formatSuccessResponse({
          message: 'Git repository already initialized',
          site_id: siteId,
          output_dir: outputDir,
        });
      }

      await git.init();
      await git.add('.');
      await git.commit('Initial commit: Astro project scaffolded from WordPress');

      database.audit(siteId, 'github_init', { output_dir: outputDir });

      return formatSuccessResponse({
        message: 'Git repository initialized with initial commit',
        site_id: siteId,
        output_dir: outputDir,
        next_steps: [
          'Run github_create_repo to create a GitHub repository',
          'Run github_push to push to remote',
        ],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  github_create_repo: async (params: unknown) => {
    try {
      const parsed = githubCreateRepoSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const outputDir = resolveOutputDir(siteId);

      const octokit = getOctokit();
      const repoName = parsed.repo_name || site.export?.github_repo || site.id;
      const org = parsed.org || site.export?.github_org;
      const isPrivate = parsed.private !== false;
      const description = parsed.description || `${site.name} — Astro frontend powered by WordPress`;

      let repoUrl: string;
      let fullName: string;

      if (org) {
        const { data } = await octokit.repos.createInOrg({
          org,
          name: repoName,
          description,
          private: isPrivate,
          auto_init: false,
        });
        repoUrl = data.clone_url;
        fullName = data.full_name;
      } else {
        const { data } = await octokit.repos.createForAuthenticatedUser({
          name: repoName,
          description,
          private: isPrivate,
          auto_init: false,
        });
        repoUrl = data.clone_url;
        fullName = data.full_name;
      }

      // Set remote origin
      const git = simpleGit(outputDir);
      const remotes = await git.getRemotes();
      if (remotes.find((r) => r.name === 'origin')) {
        await git.removeRemote('origin');
      }

      // Use token in URL for auth
      const token = siteManager.getGitHubToken();
      const authUrl = repoUrl.replace('https://', `https://${token}@`);
      await git.addRemote('origin', authUrl);

      // Save repo info
      siteManager.updateSite(siteId, {
        export: { ...site.export, github_repo: repoName, github_org: org },
      });

      database.audit(siteId, 'github_create_repo', { repo: fullName, private: isPrivate });

      return formatSuccessResponse({
        message: `Repository created: ${fullName}`,
        site_id: siteId,
        repo: fullName,
        url: repoUrl.replace(token || '', '***'),
        private: isPrivate,
        next_steps: [
          'Run github_push to push code to GitHub',
          `Connect ${parsed.org ? 'Vercel/Netlify/Cloudflare' : 'a deploy platform'} to this repo for auto-deploys`,
        ],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  github_commit: async (params: unknown) => {
    try {
      const parsed = githubCommitSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const outputDir = resolveOutputDir(siteId, parsed.output_dir);

      const git = simpleGit(outputDir);
      const status = await git.status();

      if (status.files.length === 0) {
        return formatSuccessResponse({
          message: 'No changes to commit',
          site_id: siteId,
        });
      }

      await git.add('.');

      const message = parsed.message || generateCommitMessage(status);
      await git.commit(message);

      const log = await git.log({ maxCount: 1 });

      database.audit(siteId, 'github_commit', {
        message,
        files: status.files.length,
        hash: log.latest?.hash,
      });

      return formatSuccessResponse({
        site_id: siteId,
        commit: log.latest?.hash,
        message,
        files_changed: status.files.length,
        insertions: status.created.length,
        modifications: status.modified.length,
        deletions: status.deleted.length,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  github_push: async (params: unknown) => {
    try {
      const parsed = githubPushSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const outputDir = resolveOutputDir(siteId, parsed.output_dir);
      const branch = parsed.branch || 'main';

      const git = simpleGit(outputDir);

      // Check remote exists
      const remotes = await git.getRemotes(true);
      const origin = remotes.find((r) => r.name === 'origin');
      if (!origin) {
        throw new ValidationError('No remote origin configured. Run github_create_repo first.');
      }

      await git.push('origin', branch, ['--set-upstream']);

      database.audit(siteId, 'github_push', { branch });

      return formatSuccessResponse({
        message: `Pushed to origin/${branch}`,
        site_id: siteId,
        branch,
        remote: origin.refs?.push?.replace(/https:\/\/[^@]+@/, 'https://') || 'origin',
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  github_status: async (params: unknown) => {
    try {
      const parsed = githubStatusSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const outputDir = resolveOutputDir(siteId, parsed.output_dir);

      const git = simpleGit(outputDir);
      const isRepo = await git.checkIsRepo().catch(() => false);

      if (!isRepo) {
        return formatSuccessResponse({
          site_id: siteId,
          is_git_repo: false,
          message: 'Not a git repository. Run github_init first.',
        });
      }

      const status = await git.status();
      const remotes = await git.getRemotes(true);
      const log = await git.log({ maxCount: 5 });
      const branch = await git.branch();

      return formatSuccessResponse({
        site_id: siteId,
        is_git_repo: true,
        branch: branch.current,
        tracking: status.tracking || null,
        clean: status.isClean(),
        files_changed: status.files.length,
        staged: status.staged.length,
        modified: status.modified.length,
        untracked: status.not_added.length,
        remotes: remotes.map((r) => ({
          name: r.name,
          url: r.refs?.push?.replace(/https:\/\/[^@]+@/, 'https://') || '',
        })),
        recent_commits: log.all.slice(0, 5).map((c) => ({
          hash: c.hash.substring(0, 8),
          message: c.message,
          date: c.date,
        })),
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  github_deploy_config: async (params: unknown) => {
    try {
      const parsed = githubDeployConfigSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);
      const outputDir = resolveOutputDir(siteId, parsed.output_dir);
      const platform = parsed.platform || site.export?.deploy_platform || 'vercel';

      const filesCreated: string[] = [];

      if (platform === 'vercel') {
        const config = {
          framework: 'astro',
          buildCommand: 'npm run build',
          outputDirectory: 'dist',
        };
        const filePath = path.join(outputDir, 'vercel.json');
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
        filesCreated.push('vercel.json');
      } else if (platform === 'netlify') {
        const config = `[build]
  command = "npm run build"
  publish = "dist"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
`;
        fs.writeFileSync(path.join(outputDir, 'netlify.toml'), config);
        filesCreated.push('netlify.toml');
      } else if (platform === 'cloudflare') {
        const config = `name = "${site.id}"
compatibility_date = "2024-01-01"
pages_build_output_dir = "dist"

[build]
command = "npm run build"
`;
        fs.writeFileSync(path.join(outputDir, 'wrangler.toml'), config);
        filesCreated.push('wrangler.toml');
      }

      database.audit(siteId, 'github_deploy_config', { platform, files: filesCreated });

      return formatSuccessResponse({
        site_id: siteId,
        platform,
        files_created: filesCreated,
        next_steps: platform === 'vercel'
          ? ['Connect your GitHub repo at https://vercel.com/new']
          : platform === 'netlify'
            ? ['Connect your GitHub repo at https://app.netlify.com/start']
            : ['Connect your GitHub repo at https://dash.cloudflare.com/pages'],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },
};

function generateCommitMessage(status: { files: Array<{ path: string }>; created: string[]; modified: string[]; deleted: string[] }): string {
  const mdFiles = status.files.filter((f) => f.path.endsWith('.md') || f.path.endsWith('.mdx'));
  if (mdFiles.length > 0 && mdFiles.length === status.files.length) {
    return `content: export ${mdFiles.length} posts from WordPress`;
  }
  if (status.created.length > 0 && status.modified.length === 0) {
    return `add ${status.created.length} files`;
  }
  return `update: ${status.files.length} files changed`;
}
