/**
 * Tool Aggregation
 * Combines all tool definitions and handlers
 *
 * Supports two modes via WP_ASTRO_MODE env var:
 * - 'router' (default): 3 router tools for token optimization
 * - 'full': All tools for maximum discoverability
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { routerTools, createRouterHandlers } from './router.js';
import { siteTools, siteHandlers } from './sites.js';
import { extractTools, extractHandlers } from './extract.js';
import { transformTools, transformHandlers } from './transform.js';
import { outputTools, outputHandlers } from './output.js';
import { githubTools, githubHandlers } from './github.js';
import { exportTools, exportHandlers } from './export.js';
import { syncTools, syncHandlers } from './sync.js';

/**
 * All individual tool definitions
 */
export const allTools: Tool[] = [
  ...siteTools,
  ...extractTools,
  ...transformTools,
  ...outputTools,
  ...githubTools,
  ...exportTools,
  ...syncTools,
];

/**
 * All individual tool handlers
 */
export const allHandlers: Record<
  string,
  (params: unknown) => Promise<unknown>
> = {
  ...siteHandlers,
  ...extractHandlers,
  ...transformHandlers,
  ...outputHandlers,
  ...githubHandlers,
  ...exportHandlers,
  ...syncHandlers,
};

/**
 * Router mode handlers
 */
export const routerHandlers = createRouterHandlers(allTools, allHandlers);

/**
 * Get tools for a given mode
 */
export function getToolsForMode(mode: string = 'router'): Tool[] {
  return mode === 'full' ? allTools : routerTools;
}

/**
 * Get handlers for a given mode
 */
export function getHandlersForMode(
  mode: string = 'router'
): Record<string, (params: unknown) => Promise<unknown>> {
  return mode === 'full' ? allHandlers : routerHandlers;
}
