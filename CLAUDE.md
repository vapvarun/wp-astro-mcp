# WP Astro MCP Server

WordPress-to-Astro migration MCP server with multi-site support.

## Project Structure

```
src/
  index.ts              — Server entry point (MCP SDK, stdio transport)
  types/index.ts        — All TypeScript type definitions
  config/
    sites.ts            — SiteManager singleton (multi-site config)
    database.ts         — DatabaseManager singleton (SQLite state)
  tools/
    index.ts            — Tool aggregation (allTools, allHandlers, mode switching)
    router.ts           — 3 router tools (wp_astro_run/help/describe)
    sites.ts            — Site management tools (add, test, list, analyze, etc.)
    extract.ts          — Content extraction tools (13 tools: posts, terms, authors, media, menus, etc.)
    transform.ts        — Transform tools (6 tools: convert, preview, HTML, shortcodes)
    output.ts           — Output & media tools (7 tools: scaffold, write, redirects, media)
    github.ts           — GitHub tools (6 tools: init, repo, commit, push, status, deploy)
    export.ts           — Export pipeline tools (7 tools: plan, start, resume, progress, retry, validate, cleanup)
    sync.ts             — Content sync tools (7 tools: check, pull, delete, full, status, schedule, reset)
  schemas/
    sites.ts            — Zod schemas for site tools
    extract.ts          — Zod schemas for extract tools
    transform.ts        — Zod schemas for transform tools
    output.ts           — Zod schemas for output/media tools
    github.ts           — Zod schemas for GitHub tools
    export.ts           — Zod schemas for export pipeline tools
    sync.ts             — Zod schemas for content sync tools
  services/
    wp-rest-client.ts   — WordPress REST API client (rate limiting, retry, auth)
    content-analyzer.ts — Content analysis (shortcodes, blocks, page builders, embeds)
    html-to-markdown.ts — 13-step HTML→Markdown pipeline (Turndown + custom rules)
    shortcode-resolver.ts — WordPress shortcode parser and resolver (built-in + per-site rules)
    link-rewriter.ts    — Internal link + media URL rewriter
    frontmatter-builder.ts — Astro frontmatter builder (SEO, ACF, taxonomies, reading time)
    astro-scaffolder.ts — Astro project scaffolder (config, layouts, pages, collections)
    content-writer.ts   — Write Markdown to disk, redirects, media audit/rewrite
  utils/
    errors.ts           — Error classes + formatSuccessResponse/formatErrorResponse
    logger.ts           — Logger singleton (stderr output)
config/
  sites.json            — Site credentials (gitignored)
  sites.example.json    — Config template
data/
  wp-astro.db           — SQLite database (gitignored)
```

## Key Patterns

- **Router mode**: 3 tools expose 55 actions via wp_astro_run
- **Singleton managers**: SiteManager, DatabaseManager, Logger
- **ES Modules**: `"type": "module"`, `import.meta.url` for paths
- **Zod validation**: All tool inputs validated with Zod schemas
- **Error hierarchy**: WPAstroError → SiteNotFoundError, AuthenticationError, etc.
- **Response format**: Always formatSuccessResponse() or formatErrorResponse()

## Build & Run

```bash
npm install
npm run build
# Add to Claude Code MCP config:
# "wp-astro-mcp": { "command": "node", "args": ["dist/index.js"] }
```

## Environment Variables

- `WP_ASTRO_MODE` — 'router' (default) or 'full'
- `WP_ASTRO_CONFIG` — Custom config path (default: config/sites.json)
- `WP_ASTRO_DB` — Custom database path (default: data/wp-astro.db)
- `WP_ASTRO_LOG_LEVEL` — 'debug', 'info', 'warn', 'error'

## Implementation Phases

- Phase 1: Foundation (types, config, sites, router) ✓
- Phase 2: Extract (content extraction, content analyzer, caching) ✓
- Phase 3: Transform (HTML→MD pipeline, Turndown, shortcodes) ✓
- Phase 4: Output (Astro scaffolding, content writing, redirects, media) ✓
- Phase 5: GitHub (git init, repo creation, commit, push, deploy config) ✓
- Phase 6: Export pipeline (batch processing, progress, resume, retry, validate) ✓
- Phase 7: Content Sync (change detection, pull, delete, full sync, scheduling) ✓
