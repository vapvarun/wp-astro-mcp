/**
 * Router Tools - Token-optimized wrapper
 *
 * Exposes 3 tools instead of 57:
 * - wp_astro_run: Execute any action
 * - wp_astro_help: List available actions by category
 * - wp_astro_describe: Get full schema for an action
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';
import {
  TOOL_CATEGORIES,
  READ_ONLY_ACTIONS,
  DESTRUCTIVE_ACTIONS,
} from './metadata.js';

/** Extract the list of required param names from a tool's JSON input schema. */
function requiredParams(tool: Tool | undefined): string[] {
  const req = (tool?.inputSchema as { required?: unknown } | undefined)?.required;
  return Array.isArray(req) ? (req as string[]) : [];
}

/** One-word safety classification surfaced in help/describe output. */
function actionKind(name: string): 'read-only' | 'destructive' | 'write' {
  if (READ_ONLY_ACTIONS.has(name)) return 'read-only';
  if (DESTRUCTIVE_ACTIONS.has(name)) return 'destructive';
  return 'write';
}

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
- sync_full — sync everything and optionally auto-commit

Note: common actions (site_add, site_list, site_analyze, content_audit, export_plan/start/resume/progress, sync_check, sync_full, github_push) are also exposed as standalone tools with full schemas — prefer those when available. Use wp_astro_help for the full action list and wp_astro_describe({ action }) for any action's input schema.`,
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
            kind: actionKind(name),
            required: requiredParams(tool),
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
        kind: actionKind(action),
        required: requiredParams(tool),
        description: tool.description,
        inputSchema: tool.inputSchema,
        usage: `wp_astro_run({ action: "${action}", params: {...} })`,
      });
    },
  };
}
