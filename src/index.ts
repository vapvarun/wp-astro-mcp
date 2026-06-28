#!/usr/bin/env node
/**
 * WP Astro MCP Server - Entry Point
 *
 * Adds an Astro frontend layer to WordPress sites with multi-site support,
 * batch content conversion, and GitHub publishing.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { createRequire } from 'module';

import { getToolsForMode, getHandlersForMode } from './tools/index.js';
import { getInputSchema } from './tools/registry.js';
import { database } from './config/database.js';
import { formatErrorResponse } from './utils/errors.js';
import logger from './utils/logger.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const SERVER_NAME = 'wp-astro-mcp';
const SERVER_VERSION = pkg.version;
const SERVER_MODE = process.env.WP_ASTRO_MODE || 'router';

// Set log level from env
const LOG_LEVEL = process.env.WP_ASTRO_LOG_LEVEL || 'info';
logger.setLevel(LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error');

const tools = getToolsForMode(SERVER_MODE);
const handlers = getHandlersForMode(SERVER_MODE);

async function createServer(): Promise<McpServer> {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Register each tool for the active mode via the high-level API. The SDK
  // derives the advertised JSON Schema FROM the Zod schema (registry.ts) and
  // validates input before the handler runs — a validation failure comes back
  // as an in-band `isError: true` result (the SDK wraps the McpError), so the
  // model can still self-correct, exactly as before. Handler execution errors
  // are caught here and returned via formatErrorResponse, preserving the prior
  // behavior of the low-level dispatch loop.
  let registered = 0;
  for (const tool of tools) {
    const handler = handlers[tool.name];
    if (!handler) {
      logger.warn('No handler for tool; skipping registration', { tool: tool.name });
      continue;
    }

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: getInputSchema(tool.name),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      async (args: unknown): Promise<CallToolResult> => {
        logger.info('Tool call', { tool: tool.name });
        try {
          const result = await handler(args ?? {});
          logger.debug('Tool call completed', { tool: tool.name });
          return result as CallToolResult;
        } catch (error) {
          logger.error('Tool call failed', {
            tool: tool.name,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return formatErrorResponse(error) as CallToolResult;
        }
      }
    );
    registered++;
  }

  logger.debug('Registered tools', { count: registered, mode: SERVER_MODE });

  server.server.onerror = (error: Error) => {
    logger.error('Server error', { error: error.message });
  };

  return server;
}

async function main(): Promise<void> {
  logger.info('Starting WP Astro MCP Server', {
    version: SERVER_VERSION,
    mode: SERVER_MODE,
  });

  try {
    const server = await createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('Server ready', {
      mode: SERVER_MODE,
      tools: tools.length,
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down');
      database.close();
      await server.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error('Failed to start', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
