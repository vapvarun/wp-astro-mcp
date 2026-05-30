#!/usr/bin/env node
/**
 * WP Astro MCP Server - Entry Point
 *
 * Adds an Astro frontend layer to WordPress sites with multi-site support,
 * batch content conversion, and GitHub publishing.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { createRequire } from 'module';

import { getToolsForMode, getHandlersForMode } from './tools/index.js';
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

async function createServer(): Promise<Server> {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug('Listing tools', { count: tools.length, mode: SERVER_MODE });
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info('Tool call', { tool: name });

    try {
      const handler = handlers[name];
      if (!handler) {
        return formatErrorResponse(new Error(`Unknown tool: ${name}`)) as {
          content: Array<{ type: string; text: string }>;
          isError: boolean;
          [key: string]: unknown;
        };
      }

      const result = await handler(args || {});
      logger.debug('Tool call completed', { tool: name });
      return result as {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
        [key: string]: unknown;
      };
    } catch (error) {
      logger.error('Tool call failed', {
        tool: name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return formatErrorResponse(error) as {
        content: Array<{ type: string; text: string }>;
        isError: boolean;
        [key: string]: unknown;
      };
    }
  });

  server.onerror = (error: Error) => {
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
