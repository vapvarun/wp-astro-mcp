# Architecture

Technical overview of how WP Astro MCP is built.

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Code (MCP Client)              │
│                                                          │
│  "Export my WordPress site to Astro"                     │
│       ↓                                                  │
│  wp_astro_run({ action: "export_start", params: {...} }) │
└────────────────────────┬────────────────────────────────┘
                         │ stdio (JSON-RPC)
┌────────────────────────▼────────────────────────────────┐
│                    MCP Server (src/index.ts)              │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐               │
│  │ Router  │  │ Handler  │  │ Services │               │
│  │ 3 tools │→│ 48 tools │→│          │               │
│  └─────────┘  └──────────┘  └──────────┘               │
│                                    │                     │
│  ┌────────────────────────────────────────────┐         │
│  │              Services Layer                 │         │
│  │                                             │         │
│  │  wp-rest-client    → WordPress REST API     │         │
│  │  content-analyzer  → Pattern detection      │         │
│  │  html-to-markdown  → 13-step pipeline       │         │
│  │  shortcode-resolver → Shortcode handling    │         │
│  │  link-rewriter     → URL transformation     │         │
│  │  frontmatter-builder → YAML generation     │         │
│  │  astro-scaffolder  → Project generation     │         │
│  │  content-writer    → File I/O               │         │
│  └────────────────────────────────────────────┘         │
│                         │                                │
│  ┌─────────────────────────────────────────┐            │
│  │           State Layer                    │            │
│  │                                          │            │
│  │  SiteManager  → config/sites.json        │            │
│  │  DatabaseManager → data/wp-astro.db      │            │
│  │  Logger → stderr                         │            │
│  └─────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────┘
```

## Tool Architecture

### Router Pattern

Instead of exposing 48 tools to the LLM (which wastes tokens on tool definitions), we use 3 meta-tools:

| Tool | Purpose |
|------|---------|
| `wp_astro_run` | Execute any action by name |
| `wp_astro_help` | List available actions by category |
| `wp_astro_describe` | Get full input schema for an action |

This pattern keeps the MCP tool list compact while providing full discoverability.

**Full mode** (`WP_ASTRO_MODE=full`) exposes all 48 tools directly — useful for programmatic access or when token cost isn't a concern.

### Tool Categories

```
TOOL_CATEGORIES = {
  site:      9 tools  — Site lifecycle management
  extract:  13 tools  — WordPress content fetching
  transform: 6 tools  — HTML-to-Markdown conversion
  output:    7 tools  — Astro file generation
  github:    6 tools  — Git and GitHub operations
  export:    7 tools  — Batch processing engine
}
```

### Handler Pattern

Each tool module exports:
- `xxxTools: Tool[]` — MCP tool definitions (name, description, inputSchema)
- `xxxHandlers: Record<string, handler>` — Implementation functions

The aggregation module (`tools/index.ts`) combines all tools and handlers, then the router wraps them.

## Services

### WordPress REST Client (`wp-rest-client.ts`)

**Connection pooling:**
```
httpAgent  = new http.Agent({ keepAlive: true, maxSockets: 10 })
httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 })
```

**Per-site client caching:**
```
clients: Map<siteId, AxiosInstance>
rateLimiters: Map<siteId, RateLimiter>
```

**Rate limiting:** Token bucket algorithm. Starts at configured rate (default 10 req/s). On 429 response, rate is halved automatically.

**Retry:** Exponential backoff (1s, 2s, 4s) for server errors (5xx) and network failures. Auth errors (401/403) and rate limits (429) are not retried.

**Auto-discovery:** `testConnection()` fetches:
1. Root endpoint → REST namespaces
2. `/wp/v2/users/me` → Verify auth, get user roles
3. `/wp/v2/types` → All registered post types
4. `/wp/v2/taxonomies` → All registered taxonomies
5. `/wp/v2/settings` → WordPress version
6. Namespace detection → SEO plugin, page builder, ACF, WooCommerce

### HTML-to-Markdown Pipeline (`html-to-markdown.ts`)

13 sequential steps, each operating on the output of the previous:

```
Raw HTML
  → DOMPurify (whitelist tags/attrs)
  → Shortcode Resolver (20+ handlers + per-site rules)
  → Page Builder Cleanup (Cheerio DOM manipulation)
  → Gutenberg Comment Removal (regex)
  → HTML Normalization (entity decode, empty element removal)
  → Turndown + GFM (12 custom rules)
  → Link Rewriting (URL map + path transformation)
  → Media URL Rewriting (domain swap)
  → Markdown Cleanup (artifact removal)
  → Embed Processing
  → Gallery Handling
  → Whitespace Normalization
  → Validation (detect remaining issues)
→ Clean Markdown + Issue Report
```

**Custom Turndown rules:**

| Rule | Matches | Output |
|------|---------|--------|
| `wpCaption` | `.wp-caption` divs | `![alt](src)\n*caption*` |
| `wpGallery` | `.gallery`, `.wp-block-gallery` | Multiple `![](src)` |
| `figure` | `<figure>` with `<figcaption>` | `![alt](src)\n*caption*` |
| `wpButton` | `.wp-block-button` | `[text](href)` |
| `wpColumns` | `.wp-block-columns/column` | Flattened content |
| `wpSeparator` | `.wp-block-separator/spacer` | `---` |
| `embedContainer` | `.wp-block-embed` | Extracted URL |
| `details` | `<details>` | Preserved as HTML |
| `wpCodeBlock` | `.wp-block-code` | Fenced code with language |
| `iframe` | YouTube/Vimeo iframes | Plain URLs |
| `emptyInline` | Empty `<span>`/`<a>` | Removed |
| `wpArtifacts` | `.screen-reader-text`, `.sharedaddy` | Removed |

### Shortcode Resolver (`shortcode-resolver.ts`)

**Parsing:** Regex-based matching for both enclosing (`[tag]content[/tag]`) and self-closing (`[tag /]`) shortcodes. Attributes are parsed into key-value maps.

**Resolution order:**
1. Per-site rules from `shortcode_map` database table
2. Built-in handlers (20+ shortcodes)
3. Default: keep content for enclosing, comment for self-closing

**Multi-pass:** Nested shortcodes are resolved from innermost to outermost over up to 10 passes.

### Frontmatter Builder (`frontmatter-builder.ts`)

Constructs `AstroFrontmatter` from WordPress post data:

```yaml
title: "Post Title"           # Decoded HTML entities
slug: post-slug
date: 2024-03-15T10:00:00
modified: 2024-03-16T14:30:00  # Only if different from date
author:
  name: John Doe
  id: 1
  slug: john-doe
  avatar: https://...
status: publish
categories:
  - name: Technology
    slug: technology
tags:
  - name: JavaScript
    slug: javascript
excerpt: "First 200 chars..."
featuredImage:
  url: https://...
  alt: "Image description"
  width: 1200
  height: 630
seo:                            # From Yoast or RankMath
  title: "SEO Title"
  description: "Meta description"
readingTime: 5                  # Calculated from word count
wordCount: 1024
wpPostId: 42
wpUrl: https://example.com/post-slug/
postType: post
acf:                            # Normalized ACF fields
  custom_field: "value"
```

### Astro Scaffolder (`astro-scaffolder.ts`)

Generates a complete Astro project:

```
output_dir/
  package.json              # Dependencies based on deploy platform + component library
  astro.config.mjs          # Site URL, integrations, adapter
  tsconfig.json             # Astro strict config
  .gitignore
  src/
    env.d.ts
    content.config.ts       # Zod schemas for all content collections
    layouts/
      BaseLayout.astro      # HTML head, nav, footer
      PostLayout.astro      # Article with frontmatter rendering
    pages/
      index.astro           # Latest posts listing
      404.astro
      rss.xml.ts            # RSS feed
      blog/
        index.astro         # Blog listing
        [...slug].astro     # Dynamic post routes
    content/
      blog/                 # Post collection
      pages/                # Page collection
      {cpt}/                # Custom post type collections
  public/
  vercel.json               # Or netlify.toml or wrangler.toml
```

## State Management

### SQLite Database (`database.ts`)

WAL mode for concurrent reads. Foreign keys enabled. 7 tables:

**`export_jobs`** — One row per migration run
```sql
id, site_id, output_dir, source_type, total_posts,
posts_completed, posts_failed, posts_skipped,
status (pending|in_progress|completed|failed),
config (JSON), started_at, completed_at
```

**`export_posts`** — One row per post per job (enables resume)
```sql
id, job_id, site_id, wp_post_id, post_type, slug, title,
status (pending|in_progress|completed|failed),
output_path, issues (JSON), input_size, output_size,
conversion_ms, content_hash, retry_count, error_message
```

**`cached_terms`** — Pre-fetched taxonomy terms
**`cached_authors`** — Pre-fetched authors
**`url_map`** — WordPress URL → Astro URL (for redirects + link rewriting)
**`shortcode_map`** — Per-site shortcode handling rules
**`audit_log`** — Operation history

### Site Config (`sites.ts`)

JSON file at `config/sites.json`. The `SiteManager` singleton:
- Caches loaded config in memory
- Reloads on save
- Generates site IDs from names (slugified)
- First added site becomes default
- Supports soft delete (deactivate)
- Filters inactive sites from listings

## Error Handling

### Error Hierarchy

```
WPAstroError (base)
  ├── SiteNotFoundError (404)
  ├── SiteConnectionError (503)
  ├── AuthenticationError (401)
  ├── ValidationError (400)
  ├── NotFoundError (404)
  ├── ExportError (500)
  └── RateLimitError (429)
```

### Response Format

All tool responses use consistent format:

**Success:**
```json
{
  "content": [{ "type": "text", "text": "{...json...}" }],
  "isError": false
}
```

**Error:**
```json
{
  "content": [{ "type": "text", "text": "{\"error\":true,\"code\":\"...\",\"message\":\"...\"}" }],
  "isError": true
}
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP server framework |
| `axios` | HTTP client for WordPress REST API |
| `better-sqlite3` | SQLite database (WAL mode, Node 25 compatible) |
| `turndown` + `turndown-plugin-gfm` | HTML-to-Markdown conversion |
| `cheerio` | DOM manipulation for page builder cleanup |
| `isomorphic-dompurify` | HTML sanitization (XSS prevention) |
| `he` | HTML entity decoding |
| `zod` | Input validation schemas |
| `@octokit/rest` | GitHub API client |
| `simple-git` | Git operations |
| `sanitize-filename` | Safe file name generation |
| `p-limit` | Concurrency limiting |
| `yaml` | YAML parsing/serialization |
