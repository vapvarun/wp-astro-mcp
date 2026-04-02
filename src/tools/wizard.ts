/**
 * Setup Wizard Tool
 * Guided one-command flow: add site -> analyze -> configure -> preview -> scaffold -> export -> redirects -> git init
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { database } from '../config/database.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';
import { setupWizardSchema } from '../schemas/wizard.js';
import { siteHandlers } from './sites.js';
import { transformHandlers } from './transform.js';
import { outputHandlers } from './output.js';
import { exportHandlers } from './export.js';
import { githubHandlers } from './github.js';
import logger from '../utils/logger.js';

export const wizardTools: Tool[] = [
  {
    name: 'setup_wizard',
    description:
      'Guided setup: register a WordPress site, analyze content, configure export, scaffold an Astro project, export all content, and optionally push to GitHub. One command to go from WordPress to a deployed Astro frontend.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'WordPress site URL (e.g., https://example.com)' },
        username: { type: 'string', description: 'WordPress username' },
        app_password: { type: 'string', description: 'WordPress application password' },
        output_dir: { type: 'string', description: 'Output directory for Astro project' },
        deploy_platform: { type: 'string', enum: ['vercel', 'netlify', 'cloudflare', 'none'], description: 'Deploy platform (default: vercel)' },
        skip_preview: { type: 'boolean', description: 'Skip conversion preview step (default: false)' },
        skip_push: { type: 'boolean', description: 'Skip GitHub push step (default: false)' },
      },
    },
  },
];

export const wizardHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
  setup_wizard: async (params: unknown) => {
    try {
      const parsed = setupWizardSchema.parse(params);
      const steps: Array<{ step: string; status: string; detail?: unknown }> = [];

      if (!parsed.url) {
        return formatSuccessResponse({
          message: 'setup_wizard requires at minimum: url, username, app_password',
          usage: 'setup_wizard({ url: "https://example.com", username: "admin", app_password: "xxxx xxxx xxxx" })',
          optional: 'output_dir, deploy_platform, skip_preview, skip_push',
        });
      }

      const siteName = new URL(parsed.url).hostname.replace(/^www\./, '');
      const siteId = siteName.replace(/\./g, '-');

      logger.info('Setup wizard started', { url: parsed.url, siteId });

      // Step 1: Add site
      await siteHandlers.site_add({
        name: siteName,
        url: parsed.url,
        username: parsed.username,
        app_password: parsed.app_password,
        id: siteId,
      });
      steps.push({ step: 'site_add', status: 'done', detail: `Registered ${siteName}` });

      // Step 2: Analyze site
      await siteHandlers.site_analyze({ site_id: siteId });
      steps.push({ step: 'site_analyze', status: 'done' });

      // Step 3: Configure export
      const outputDir = parsed.output_dir || `${process.env.HOME || '/tmp'}/${siteId}-astro`;
      const platform = parsed.deploy_platform || 'vercel';
      await siteHandlers.site_export_config({
        site_id: siteId,
        output_dir: outputDir,
        deploy_platform: platform,
        content_format: 'md',
        media_strategy: 'keep',
      });
      steps.push({ step: 'site_export_config', status: 'done', detail: { outputDir, platform } });

      // Step 4: Preview (unless skipped)
      if (!parsed.skip_preview) {
        await transformHandlers.convert_preview({ site_id: siteId, count: 3 });
        steps.push({ step: 'convert_preview', status: 'done' });
      }

      // Step 5: Scaffold project
      await outputHandlers.scaffold_project({ site_id: siteId, output_dir: outputDir });
      steps.push({ step: 'scaffold_project', status: 'done', detail: outputDir });

      // Step 6: Export all content
      await exportHandlers.export_start({ site_id: siteId, output_dir: outputDir });
      steps.push({ step: 'export_start', status: 'done' });

      // Resume until complete
      let remaining = true;
      let resumeCount = 0;
      while (remaining) {
        const resumeResult = await exportHandlers.export_resume({ site_id: siteId }) as { content: Array<{ text: string }> };
        resumeCount++;
        try {
          const data = JSON.parse(resumeResult.content[0].text);
          if (data.status === 'completed' || data.batch?.remaining === 0) {
            remaining = false;
          }
        } catch {
          remaining = false;
        }
      }
      steps.push({ step: 'export_resume', status: 'done', detail: `${resumeCount} batches processed` });

      // Step 7: Generate redirects
      await outputHandlers.generate_redirects({ site_id: siteId, output_dir: outputDir });
      steps.push({ step: 'generate_redirects', status: 'done' });

      // Step 8: Git init (unless skipped)
      if (!parsed.skip_push) {
        await githubHandlers.github_init({ site_id: siteId, output_dir: outputDir });
        steps.push({ step: 'github_init', status: 'done' });
      }

      database.audit(siteId, 'setup_wizard', {
        steps: steps.length,
        output_dir: outputDir,
        platform,
      });

      return formatSuccessResponse({
        message: `Astro frontend ready for ${siteName}`,
        site_id: siteId,
        output_dir: outputDir,
        deploy_platform: platform,
        steps,
        next_steps: [
          `cd ${outputDir} && npm install && npm run dev`,
          parsed.skip_push ? 'Run github_init + github_create_repo + github_push to publish' : 'Run github_create_repo + github_push to publish to GitHub',
          `Connect ${platform} to your GitHub repo for auto-deploys`,
        ],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },
};
