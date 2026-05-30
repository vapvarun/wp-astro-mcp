/**
 * Tool metadata — single source of truth for categories, annotations, and the
 * curated set of actions promoted to first-class MCP tools.
 *
 * Why this file exists:
 * - The router previously hand-maintained a TOOL_CATEGORIES list parallel to the
 *   real handler registry, which could silently drift (M3). Here categories are
 *   DERIVED from the actual tool arrays, so they can't fall out of sync.
 * - The 57-actions-under-one-tool design hid every per-action schema and made
 *   read-only/destructive annotations impossible (M2/M4). We fix that by
 *   classifying each action once, centrally, and exposing a curated high-value
 *   subset as first-class, annotated tools in router mode.
 *
 * Import graph note: this module imports the leaf tool arrays (sites.ts, etc.),
 * which do NOT import this module — so there is no circular dependency. router.ts
 * and index.ts both import from here.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { siteTools } from './sites.js';
import { extractTools } from './extract.js';
import { transformTools } from './transform.js';
import { outputTools } from './output.js';
import { githubTools } from './github.js';
import { exportTools } from './export.js';
import { syncTools } from './sync.js';
import { wizardTools } from './wizard.js';

/**
 * Categories, derived from the real tool arrays (no hand-maintained duplicate).
 */
export const TOOL_CATEGORIES: Record<string, string[]> = {
  site: siteTools.map((t) => t.name),
  extract: extractTools.map((t) => t.name),
  transform: transformTools.map((t) => t.name),
  output: outputTools.map((t) => t.name),
  github: githubTools.map((t) => t.name),
  export: exportTools.map((t) => t.name),
  sync: syncTools.map((t) => t.name),
  wizard: wizardTools.map((t) => t.name),
};

/**
 * High-value, frequently-chained actions promoted to first-class MCP tools in
 * router mode. These get their full input schema + annotations exposed at
 * tools/list time (no describe round-trip needed). The long tail stays behind
 * wp_astro_run to keep the tools/list payload small.
 */
export const PROMOTED_ACTIONS: string[] = [
  'site_add',
  'site_list',
  'site_analyze',
  'content_audit',
  'export_plan',
  'export_start',
  'export_resume',
  'export_progress',
  'sync_check',
  'sync_full',
  'github_push',
];

/**
 * Actions that do not modify any state (safe to auto-approve). MCP readOnlyHint.
 */
export const READ_ONLY_ACTIONS: Set<string> = new Set([
  // site
  'site_test', 'site_list', 'site_get', 'site_analyze', 'site_export_config',
  // extract (all read-only except the cache_* writers)
  'extract_posts', 'extract_post', 'extract_all_ids', 'extract_terms',
  'extract_authors', 'extract_media', 'extract_menus', 'extract_comments',
  'extract_settings', 'extract_widgets', 'content_audit',
  // transform (conversions are pure; configure writes)
  'convert_post', 'convert_preview', 'convert_html', 'shortcode_list', 'shortcode_scan',
  // output
  'list_output', 'media_audit',
  // github
  'github_status',
  // export
  'export_plan', 'export_progress', 'export_validate',
  // sync
  'sync_check', 'sync_status',
  // wizard
  'setup_wizard',
]);

/**
 * Actions that may perform destructive updates (delete/overwrite existing data).
 * MCP destructiveHint. Only meaningful for non-read-only tools.
 */
export const DESTRUCTIVE_ACTIONS: Set<string> = new Set([
  'site_remove',
  'media_rewrite',
  'export_cleanup',
  'sync_delete',
  'sync_full', // can delete local files for posts removed in WP
  'sync_reset',
]);

/** Human-readable titles for the promoted first-class tools. */
const TITLES: Record<string, string> = {
  site_add: 'Add WordPress site',
  site_list: 'List sites',
  site_analyze: 'Analyze site',
  content_audit: 'Audit content',
  export_plan: 'Plan export',
  export_start: 'Start export',
  export_resume: 'Resume export',
  export_progress: 'Export progress',
  sync_check: 'Check for changes',
  sync_full: 'Full sync',
  github_push: 'Push to GitHub',
};

/**
 * Stamp MCP annotations (readOnlyHint / destructiveHint / title) onto a tool,
 * based on the central classification above. Idempotent and non-mutating.
 */
export function annotateTool(tool: Tool): Tool {
  const readOnly = READ_ONLY_ACTIONS.has(tool.name);
  const destructive = !readOnly && DESTRUCTIVE_ACTIONS.has(tool.name);
  return {
    ...tool,
    annotations: {
      ...(tool.annotations ?? {}),
      ...(TITLES[tool.name] ? { title: TITLES[tool.name] } : {}),
      readOnlyHint: readOnly,
      ...(destructive ? { destructiveHint: true } : {}),
    },
  };
}
