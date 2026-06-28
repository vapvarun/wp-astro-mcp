/**
 * Tool input-schema registry — the single source of truth that maps every tool
 * name to the Zod schema used to validate its input.
 *
 * Why this exists:
 * - Tools were defined with a HAND-WRITTEN JSON Schema (`inputSchema`) for
 *   `tools/list` AND a SEPARATE Zod schema for runtime validation. The two could
 *   drift (the audit's M3 — e.g. `site_export_config` listed `['md','mdx']` in
 *   JSON while Zod already accepted `'json'`). Migrating to
 *   `McpServer.registerTool` lets the SDK generate the advertised JSON Schema
 *   FROM the Zod schema, so the contract a client sees is exactly what gets
 *   validated. This registry is where each tool's Zod schema is wired in.
 * - Coverage is asserted by `test/registry-coverage.test.ts`: every registered
 *   tool must have an entry here (or be a known no-arg tool), so a new tool that
 *   forgets its schema fails CI rather than shipping an unvalidated surface.
 *
 * Namespace imports are used deliberately: `tsc` verifies every `*.<name>Schema`
 * reference, so a renamed/removed schema is a compile error here.
 */

import { z } from 'zod';
import * as site from '../schemas/sites.js';
import * as extract from '../schemas/extract.js';
import * as transform from '../schemas/transform.js';
import * as output from '../schemas/output.js';
import * as github from '../schemas/github.js';
import * as exportSchemas from '../schemas/export.js';
import * as sync from '../schemas/sync.js';
import * as wizard from '../schemas/wizard.js';

/** Input schema for tools that take no parameters. */
const NO_PARAMS = z.object({});

/** Zod input schemas for the 3 router tools (mirror of router.ts JSON defs). */
export const ROUTER_INPUT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  wp_astro_run: z.object({
    action: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  wp_astro_help: z.object({ category: z.string().optional() }),
  wp_astro_describe: z.object({ action: z.string() }),
};

/**
 * Tool name → Zod input schema for all 57 first-class actions. Verified 1:1
 * against each handler's `.parse()` call (see the migration inventory).
 */
export const INPUT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  // sites
  site_add: site.siteAddSchema,
  site_test: site.siteIdSchema,
  site_list: NO_PARAMS,
  site_get: site.siteIdSchema,
  site_update: site.siteUpdateSchema,
  site_remove: site.siteIdSchema,
  site_set_default: site.siteIdSchema,
  site_analyze: site.siteIdSchema,
  site_export_config: site.siteExportConfigSchema,

  // extract
  extract_posts: extract.extractPostsSchema,
  extract_post: extract.extractPostSchema,
  extract_all_ids: extract.extractAllIdsSchema,
  extract_terms: extract.extractTermsSchema,
  extract_authors: extract.extractAuthorsSchema,
  extract_media: extract.extractMediaSchema,
  extract_menus: extract.extractMenusSchema,
  extract_comments: extract.extractCommentsSchema,
  extract_settings: extract.extractSettingsSchema,
  extract_widgets: extract.extractWidgetsSchema,
  cache_terms: extract.cacheTermsSchema,
  cache_authors: extract.cacheAuthorsSchema,
  content_audit: extract.contentAuditSchema,

  // transform
  convert_post: transform.convertPostSchema,
  convert_preview: transform.convertPreviewSchema,
  convert_html: transform.convertHtmlSchema,
  shortcode_list: transform.shortcodeListSchema,
  shortcode_configure: transform.shortcodeConfigureSchema,
  shortcode_scan: transform.shortcodeScanSchema,

  // output
  scaffold_project: output.scaffoldProjectSchema,
  write_post: output.writePostSchema,
  write_batch: output.writeBatchSchema,
  generate_redirects: output.generateRedirectsSchema,
  media_audit: output.mediaAuditSchema,
  media_rewrite: output.mediaRewriteSchema,
  list_output: output.listOutputSchema,

  // github
  github_init: github.githubInitSchema,
  github_create_repo: github.githubCreateRepoSchema,
  github_commit: github.githubCommitSchema,
  github_push: github.githubPushSchema,
  github_status: github.githubStatusSchema,
  github_deploy_config: github.githubDeployConfigSchema,

  // export
  export_plan: exportSchemas.exportPlanSchema,
  export_start: exportSchemas.exportStartSchema,
  export_resume: exportSchemas.exportResumeSchema,
  export_progress: exportSchemas.exportProgressSchema,
  export_retry: exportSchemas.exportRetrySchema,
  export_validate: exportSchemas.exportValidateSchema,
  export_cleanup: exportSchemas.exportCleanupSchema,

  // sync
  sync_check: sync.syncCheckSchema,
  sync_pull: sync.syncPullSchema,
  sync_delete: sync.syncDeleteSchema,
  sync_full: sync.syncFullSchema,
  sync_status: sync.syncStatusSchema,
  sync_schedule: sync.syncScheduleSchema,
  sync_reset: sync.syncResetSchema,
  sync_webhook: sync.syncWebhookSchema,

  // wizard
  setup_wizard: wizard.setupWizardSchema,
};

/**
 * Resolve the Zod input schema for any tool (first-class or router). Falls back
 * to a no-params object schema so an unmapped tool still registers and validates
 * (the coverage test prevents that fallback from hiding a real gap).
 */
export function getInputSchema(toolName: string): z.ZodTypeAny {
  return (
    INPUT_SCHEMAS[toolName] ?? ROUTER_INPUT_SCHEMAS[toolName] ?? NO_PARAMS
  );
}
