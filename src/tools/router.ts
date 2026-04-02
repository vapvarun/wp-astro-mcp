/**
 * Router Tools - Token-optimized wrapper
 *
 * Exposes 3 tools instead of 55:
 * - wp_astro_run: Execute any action
 * - wp_astro_help: List available actions by category
 * - wp_astro_describe: Get full schema for an action
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';

/**
 * Tool categories for organization
 */
export const TOOL_CATEGORIES: Record<string, string[]> = {
  site: [
    'site_add',
    'site_test',
    'site_list',
    'site_get',
    'site_update',
    'site_remove',
    'site_set_default',
    'site_analyze',
    'site_export_config',
  ],
  extract: [
    'extract_posts',
    'extract_post',
    'extract_all_ids',
    'extract_terms',
    'extract_authors',
    'extract_media',
    'extract_menus',
    'extract_comments',
    'extract_settings',
    'extract_widgets',
    'cache_terms',
    'cache_authors',
    'content_audit',
  ],
  transform: [
    'convert_post',
    'convert_preview',
    'convert_html',
    'shortcode_list',
    'shortcode_configure',
    'shortcode_scan',
  ],
  // Phase 4: output, media
  output: [
    'scaffold_project',
    'write_post',
    'write_batch',
    'generate_redirects',
    'list_output',
  ],
  media: [
    'media_audit',
    'media_rewrite',
  ],
  github: [
    'github_init',
    'github_create_repo',
    'github_commit',
    'github_push',
    'github_status',
    'github_deploy_config',
  ],
  export: [
    'export_plan',
    'export_start',
    'export_resume',
    'export_progress',
    'export_retry',
    'export_validate',
    'export_cleanup',
  ],
  sync: [
    'sync_check',
    'sync_pull',
    'sync_delete',
    'sync_full',
    'sync_status',
    'sync_schedule',
    'sync_reset',
  ],
  wizard: [
    'setup_wizard',
  ],
};

/**
 * Router tool definitions
 */
export const routerTools: Tool[] = [
  {
    name: 'wp_astro_run',
    description: `Execute a WordPress-to-Astro frontend action. Use wp_astro_help to list available actions.

Common workflows:
1. Add site: site_add → site_analyze → site_export_config
2. Preview: convert_preview (see sample converted posts)
3. Export: export_plan → export_start → export_resume → export_validate
4. Publish: github_init → github_create_repo → github_push
5. Ongoing sync: sync_check → sync_pull → github_push
6. Auto sync: sync_full (check + pull + delete + commit in one step)

Quick actions:
- site_list — see all registered sites
- sync_check — see what changed in WordPress since last sync
- sync_full — sync everything and optionally auto-commit`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action name (e.g., site_add, site_analyze, export_start)',
        },
        params: {
          type: 'object',
          description: 'Action parameters (use wp_astro_describe to see schema)',
          additionalProperties: true,
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'wp_astro_help',
    description: 'List available actions, optionally filtered by category.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category (site, extract, transform, output, media, github, export, sync, wizard)',
        },
      },
    },
  },
  {
    name: 'wp_astro_describe',
    description: 'Get the full input schema for a specific action.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action name to describe',
        },
      },
      required: ['action'],
    },
  },
];

/**
 * Create router handlers that delegate to actual tool handlers
 */
export function createRouterHandlers(
  allTools: Tool[],
  allHandlers: Record<string, (params: unknown) => Promise<unknown>>
): Record<string, (params: unknown) => Promise<unknown>> {
  const toolMap = new Map<string, Tool>();
  for (const tool of allTools) {
    toolMap.set(tool.name, tool);
  }

  return {
    wp_astro_run: async (args: unknown) => {
      const { action, params = {} } = args as {
        action: string;
        params?: Record<string, unknown>;
      };

      const handler = allHandlers[action];
      if (!handler) {
        // Suggest similar actions
        const allActions = Object.values(TOOL_CATEGORIES).flat();
        const suggestions = allActions
          .filter((a) => a.includes(action) || action.includes(a.split('_')[0]))
          .slice(0, 5);

        return formatErrorResponse(
          new Error(
            `Unknown action: "${action}".${
              suggestions.length
                ? ` Did you mean: ${suggestions.join(', ')}?`
                : ' Use wp_astro_help to list available actions.'
            }`
          )
        );
      }

      try {
        return await handler(params);
      } catch (error) {
        return formatErrorResponse(error);
      }
    },

    wp_astro_help: async (args: unknown) => {
      const { category } = (args || {}) as { category?: string };

      if (category) {
        const actions = TOOL_CATEGORIES[category];
        if (!actions) {
          return formatErrorResponse(
            new Error(
              `Unknown category: "${category}". Available: ${Object.keys(TOOL_CATEGORIES).join(', ')}`
            )
          );
        }

        const actionDetails = actions.map((name) => {
          const tool = toolMap.get(name);
          return {
            name,
            description: tool?.description?.split('\n')[0] || 'No description',
          };
        });

        return formatSuccessResponse({
          category,
          actions: actionDetails,
          usage: 'wp_astro_run({ action: "<action_name>", params: {...} })',
        });
      }

      // List all categories
      const categories = Object.entries(TOOL_CATEGORIES).map(
        ([name, actions]) => ({
          name,
          action_count: actions.length,
          actions:
            actions.slice(0, 4).join(', ') +
            (actions.length > 4 ? '...' : ''),
        })
      );

      return formatSuccessResponse({
        categories,
        total_actions: Object.values(TOOL_CATEGORIES).flat().length,
        usage: 'Use wp_astro_help({ category: "<name>" }) for action details',
      });
    },

    wp_astro_describe: async (args: unknown) => {
      const { action } = args as { action: string };

      const tool = toolMap.get(action);
      if (!tool) {
        return formatErrorResponse(
          new Error(`Unknown action: "${action}". Use wp_astro_help to list actions.`)
        );
      }

      return formatSuccessResponse({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        usage: `wp_astro_run({ action: "${action}", params: {...} })`,
      });
    },
  };
}
