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
import { PROMOTED_ACTIONS, annotateTool } from './metadata.js';
import { siteTools, siteHandlers } from './sites.js';
import { extractTools, extractHandlers } from './extract.js';
import { transformTools, transformHandlers } from './transform.js';
import { outputTools, outputHandlers } from './output.js';
import { githubTools, githubHandlers } from './github.js';
import { exportTools, exportHandlers } from './export.js';
import { syncTools, syncHandlers } from './sync.js';
import { wizardTools, wizardHandlers } from './wizard.js';

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
  ...wizardTools,
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
  ...wizardHandlers,
};

/**
 * Router mode handlers
 */
export const routerHandlers = createRouterHandlers(allTools, allHandlers);

/** All tools with MCP annotations (readOnlyHint/destructiveHint/title) stamped on. */
const annotatedAllTools: Tool[] = allTools.map(annotateTool);

/**
 * Curated high-value actions exposed as first-class, annotated tools in router
 * mode — so the model sees their full input schema at tools/list time instead of
 * needing a wp_astro_describe round-trip (hybrid design, M2).
 */
const promotedTools: Tool[] = annotatedAllTools.filter((t) =>
  PROMOTED_ACTIONS.includes(t.name)
);

const promotedHandlers: Record<string, (params: unknown) => Promise<unknown>> =
  Object.fromEntries(
    PROMOTED_ACTIONS.filter((name) => allHandlers[name]).map((name) => [
      name,
      allHandlers[name],
    ])
  );

/**
 * Get tools for a given mode.
 * - 'full': every action as a first-class annotated tool (maximum discoverability)
 * - 'router' (default): the 3 router tools + the promoted high-value tools, a
 *   hybrid that keeps the tools/list payload small while restoring schema-driven
 *   discoverability and safety annotations for the actions that get used most.
 */
export function getToolsForMode(mode: string = 'router'): Tool[] {
  return mode === 'full' ? annotatedAllTools : [...routerTools, ...promotedTools];
}

/**
 * Get handlers for a given mode. In router mode the promoted actions are callable
 * both by their own name (first-class) and via wp_astro_run.
 */
export function getHandlersForMode(
  mode: string = 'router'
): Record<string, (params: unknown) => Promise<unknown>> {
  return mode === 'full'
    ? allHandlers
    : { ...routerHandlers, ...promotedHandlers };
}
