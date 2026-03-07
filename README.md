# WP Astro MCP

> Migrate any WordPress site to Astro — from a single blog to a network of 12 sites with 6,000+ posts. Fully automated via Claude Code.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)

**WP Astro MCP** is a [Model Context Protocol](https://modelcontextprotocol.io) server that turns WordPress sites into production-ready Astro projects. It connects to your WordPress REST API, extracts everything (posts, pages, CPTs, SEO, ACF, menus, media), converts HTML to clean Markdown, scaffolds a complete Astro project, and pushes to GitHub — all through conversational commands in Claude Code.

---

## Why This Exists

Migrating WordPress to Astro involves dozens of tedious steps: fetching content via API, cleaning up page builder markup, resolving shortcodes, building frontmatter, setting up content collections, handling media URLs, generating redirects, deploying. Each site has its own plugins, page builders, and content patterns.

This MCP server handles all of it. Tell Claude to migrate your site, and it orchestrates 48 specialized tools to get it done.

---

## Table of Contents

- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Use Cases](#use-cases)
- [Full Workflow](#full-workflow)
- [Tool Reference](#tool-reference)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/vapvarun/wp-astro-mcp.git
cd wp-astro-mcp
npm install
npm run build
```

### 2. Add to Claude Code

Add to your MCP config (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "wp-astro-mcp": {
      "command": "node",
      "args": ["/path/to/wp-astro-mcp/dist/index.js"]
    }
  }
}
```

### 3. Generate a WordPress Application Password

Go to your WordPress admin → **Users → Profile → Application Passwords**. Enter a name, click "Add New", and copy the password.

### 4. Start Migrating

In Claude Code, just say:

```
Add my WordPress site example.com with username admin
and app password "xxxx xxxx xxxx xxxx xxxx xxxx"
```

Claude will register the site, auto-detect its capabilities (SEO plugin, page builder, ACF, post types), and guide you through the migration.

---

## How It Works

```
WordPress Site                    WP Astro MCP                      Astro Project
┌─────────────┐     REST API     ┌──────────────┐     Files        ┌─────────────┐
│ Posts        │────────────────►│ Extract      │───────────────►│ content/    │
│ Pages       │                  │ Transform    │                │ blog/       │
│ CPTs        │                  │ Scaffold     │                │ pages/      │
│ Media       │                  │ Write        │                │ layouts/    │
│ SEO         │                  │              │                │ pages/      │
│ ACF         │                  │ SQLite state │                │ astro.config│
│ Menus       │                  │ for resume   │                │ package.json│
└─────────────┘                  └──────────────┘                └─────────────┘
                                       │                               │
                                       │ GitHub API                    │
                                       ▼                               ▼
                                 ┌──────────────┐              ┌─────────────┐
                                 │ git init     │              │ Vercel      │
                                 │ create repo  │──────────────│ Netlify     │
                                 │ push         │              │ Cloudflare  │
                                 └──────────────┘              └─────────────┘
```

### The Conversion Pipeline

Every post goes through a 13-step conversion:

1. **Sanitize** — DOMPurify removes XSS vectors while preserving content
2. **Resolve shortcodes** — 20+ built-in handlers (gallery, video, WPBakery, Divi, CF7) + custom per-site rules
3. **Clean page builders** — Strip Elementor/WPBakery/Divi wrapper divs, keep content
4. **Process Gutenberg** — Remove block comments (`<!-- wp:paragraph -->`), preserve content
5. **Normalize HTML** — Decode entities, remove empty paragraphs, clean inline styles
6. **Convert to Markdown** — Turndown with 12 WordPress-specific rules (captions, galleries, code blocks, embeds)
7. **Rewrite links** — Internal WordPress URLs → Astro paths using URL map
8. **Rewrite media** — Swap domains for media URLs (e.g., `example.com` → `app.example.com`)
9. **Clean artifacts** — Remove conversion leftovers, fix double-encoded entities
10. **Process embeds** — YouTube/Vimeo iframes → plain URLs
11. **Handle galleries** — WordPress galleries → image grids
12. **Fix whitespace** — Ensure proper spacing around headings, lists, code blocks
13. **Validate** — Flag remaining HTML, broken images, content loss

---

## Use Cases

### Migrate a Personal Blog

You have a WordPress blog with 200 posts and want to move to Astro for better performance.

```
1. "Add my site myblog.com with username admin and password xxxx"
2. "Analyze the site"
3. "Set output to C:/projects/myblog-astro with Vercel deployment"
4. "Preview some converted posts"
5. "Scaffold the Astro project and export all content"
6. "Push to GitHub"
```

### Migrate a Business Website

A company site with Elementor, Yoast SEO, ACF custom fields, and 500 pages.

```
1. "Add site company.com" (auto-detects Elementor, Yoast, ACF)
2. "Run a content audit" (finds shortcodes, page builder usage, complexity)
3. "Configure shortcodes for CF7 forms and custom widgets"
4. "Preview 5 pages to check Elementor conversion quality"
5. "Export all content, media URLs pointing to app.company.com"
6. "Generate Netlify redirects and push to GitHub"
```

### Migrate Multiple Sites

An agency managing 12 WordPress sites that all need to move to Astro.

```
1. "Add all my sites" (register each with credentials)
2. "List all sites" (see capabilities and content counts)
3. "Analyze buddyxtheme.com" (1,941 posts, RankMath, Elementor)
4. "Export buddyxtheme.com with year/month directories"
5. "Now do vapvarun.com" (switch sites seamlessly)
```

### Incremental Updates

Your WordPress site is still active and content keeps changing. Run exports periodically.

```
1. "Export only posts modified after 2024-01-01"
2. "Resume the export" (picks up where it left off)
3. "Validate the export" (check for missing files or failures)
```

### Go-Live Domain Swap

WordPress moves from `example.com` to `app.example.com` (backend), and Astro takes over `example.com`.

```
1. During development: media URLs point to example.com (no changes needed)
2. At go-live: "Rewrite all media URLs from example.com to app.example.com"
3. "Generate redirects for Vercel"
```

---

## Full Workflow

Here's the complete migration workflow, step by step:

### Phase 1: Connect & Discover

```
site_add          → Register site, auto-detect WP version, SEO plugin,
                    page builder, ACF, WooCommerce, post types, taxonomies
site_analyze      → Count all content, estimate migration time
site_export_config → Set output directory, media strategy, deploy platform
```

### Phase 2: Audit & Prepare

```
content_audit     → Sample posts, detect shortcodes, blocks, page builders,
                    embeds, galleries, tables, forms — assess complexity
shortcode_scan    → Find all shortcodes in use across the site
shortcode_configure → Set handling rules (strip, keep content, map to component)
cache_terms       → Pre-cache all taxonomy terms in SQLite
cache_authors     → Pre-cache all authors in SQLite
```

### Phase 3: Preview & Verify

```
convert_preview   → Convert 3-5 sample posts, review Markdown quality
convert_post      → Convert a specific post to inspect in detail
extract_post      → View raw WordPress data for debugging
```

### Phase 4: Scaffold & Export

```
scaffold_project  → Create Astro project (config, layouts, pages, collections, RSS)
export_plan       → Pre-flight check: content counts, config validation, time estimate
export_start      → Begin batch export (processes first batch, creates SQLite job)
export_resume     → Continue processing (call repeatedly until done)
export_progress   → Check completion percentage and failures
export_retry      → Re-process any failed posts
export_validate   → Verify all output files exist and are valid
```

### Phase 5: Finalize & Publish

```
generate_redirects → Create redirect rules (Netlify, Vercel, Cloudflare, Apache, Nginx)
media_audit       → Check all media references, find broken URLs
media_rewrite     → Bulk swap media domains for go-live
github_init       → Initialize git repository
github_create_repo → Create GitHub repo (public or private)
github_commit     → Stage and commit all changes
github_push       → Push to GitHub
github_deploy_config → Generate Vercel/Netlify/Cloudflare config
```

---

## Tool Reference

### Site Management (9 tools)

| Tool | Description |
|------|-------------|
| `site_add` | Register a WordPress site with credentials. Auto-detects WP version, REST namespaces, SEO plugin (Yoast/RankMath/AIOSEO), page builder (Elementor/WPBakery/Divi/Beaver/Bricks/Oxygen), ACF, WooCommerce, post types, taxonomies. |
| `site_test` | Re-test connection and refresh detected capabilities. |
| `site_list` | List all registered sites with status, version, and content stats. |
| `site_get` | Get full details for a site (credentials are masked). |
| `site_update` | Update site credentials or settings. |
| `site_remove` | Deactivate a site (soft delete, can be reactivated). |
| `site_set_default` | Set a site as default (used when site_id is omitted). |
| `site_analyze` | Deep analysis: count all content types, detect capabilities, estimate migration time, recommend REST API vs WXR. |
| `site_export_config` | Configure per-site export: output dir, content format (md/mdx), media strategy, filters, component library, deploy platform, rate limit. |

### Content Extraction (13 tools)

| Tool | Description |
|------|-------------|
| `extract_posts` | Fetch posts with pagination. Any post type, status/date filters, embedded author/media/terms. |
| `extract_post` | Fetch single post with full content (edit context) and content analysis. |
| `extract_all_ids` | Lightweight fetch of all post IDs for two-phase strategy on large sites. |
| `extract_terms` | Fetch taxonomy terms (categories, tags, custom) with pagination. |
| `extract_authors` | Fetch all site authors with avatars. |
| `extract_media` | Fetch media items — single by ID or paginated list. |
| `extract_menus` | Fetch navigation menus (WP 5.9+ and classic). |
| `extract_comments` | Fetch approved comments, optionally filtered by post. |
| `extract_settings` | Fetch site settings (title, tagline, timezone, permalink structure). |
| `extract_widgets` | Fetch sidebar/widget areas (WP 5.8+). |
| `cache_terms` | Bulk cache ALL terms for ALL taxonomies in SQLite. Run before export. |
| `cache_authors` | Bulk cache ALL authors in SQLite. Run before export. |
| `content_audit` | Sample posts, analyze shortcodes/blocks/page builders/embeds, assess complexity distribution. |

### Transform (6 tools)

| Tool | Description |
|------|-------------|
| `convert_post` | Convert a single post to Astro Markdown with full frontmatter and issue report. |
| `convert_preview` | Convert a sample batch to preview output quality before full export. |
| `convert_html` | Convert raw HTML to Markdown. Useful for testing conversion rules. |
| `shortcode_list` | List all configured shortcode handling rules for a site. |
| `shortcode_configure` | Set how a shortcode is handled: strip, keep_content, remove, component, html. |
| `shortcode_scan` | Scan posts for all shortcodes in use, find unconfigured ones. |

### Output & Media (7 tools)

| Tool | Description |
|------|-------------|
| `scaffold_project` | Create complete Astro project: package.json, astro.config, layouts, content collections, pages, RSS, deploy config. |
| `write_post` | Convert and write a single post as Markdown to the content directory. Supports dry_run. |
| `write_batch` | Convert and write a page of posts. Use with pagination for incremental writing. |
| `generate_redirects` | Generate redirect rules from WordPress→Astro URL map. Supports Netlify, Vercel, Cloudflare, Apache, Nginx. |
| `media_audit` | Scan exported files for media references. Report domains, counts, broken refs. |
| `media_rewrite` | Bulk rewrite media domains in all content files (for go-live domain swap). |
| `list_output` | List files in output directory with stats (counts, sizes, collections). |

### GitHub (6 tools)

| Tool | Description |
|------|-------------|
| `github_init` | Initialize git repository with initial commit. |
| `github_create_repo` | Create GitHub repository (personal or org, public or private) and set remote. |
| `github_commit` | Stage all changes and commit with auto-generated message. |
| `github_push` | Push to remote repository. |
| `github_status` | Show git status: branch, changes, remotes, recent commits. |
| `github_deploy_config` | Generate deploy platform config (Vercel, Netlify, Cloudflare Pages). |

### Export Pipeline (7 tools)

| Tool | Description |
|------|-------------|
| `export_plan` | Pre-flight check: content counts, config validation, estimated time, recommended batch size. |
| `export_start` | Start batch export. Fetches all post IDs, registers in SQLite, processes first batch. |
| `export_resume` | Continue an in-progress export. Call repeatedly until complete. |
| `export_progress` | Show completion percentage, posts done/failed/pending, recent failures. |
| `export_retry` | Reset failed posts to pending and reprocess them. |
| `export_validate` | Verify output: check files exist, count issues, confirm completeness. |
| `export_cleanup` | Delete export job data from database (does not delete files). |

---

## Configuration

### Site Config (`config/sites.json`)

```json
{
  "sites": [
    {
      "id": "my-blog",
      "name": "My WordPress Blog",
      "url": "https://example.com",
      "username": "admin",
      "app_password": "xxxx xxxx xxxx xxxx xxxx xxxx",
      "default": true,
      "export": {
        "output_dir": "C:/projects/my-blog-astro",
        "content_format": "md",
        "media_strategy": "rewrite",
        "media_domain": "app.example.com",
        "include_statuses": ["publish"],
        "year_month_dirs": true,
        "component_library": "starwind",
        "deploy_platform": "vercel",
        "rate_limit": 10
      }
    }
  ],
  "github_token": "ghp_your_github_token_here",
  "global_settings": {
    "default_rate_limit": 10,
    "default_content_format": "md",
    "default_component_library": "starwind",
    "default_deploy_platform": "vercel"
  }
}
```

### Export Config Options

| Option | Values | Description |
|--------|--------|-------------|
| `output_dir` | Path | Where the Astro project is created |
| `content_format` | `md`, `mdx` | Markdown or MDX output |
| `media_strategy` | `keep`, `rewrite`, `download` | How to handle media URLs |
| `media_domain` | Domain | New domain for media (used with `rewrite` strategy) |
| `include_post_types` | Array | Only export these post types |
| `exclude_post_types` | Array | Skip these post types |
| `include_statuses` | Array | Post statuses to include (default: `["publish"]`) |
| `include_drafts` | Boolean | Include draft posts |
| `include_comments` | Boolean | Export comments |
| `year_month_dirs` | Boolean | Organize posts in `YYYY/MM/` directories |
| `date_after` | ISO date | Only export content after this date |
| `date_before` | ISO date | Only export content before this date |
| `exclude_categories` | Array | Category slugs to skip |
| `exclude_tags` | Array | Tag slugs to skip |
| `component_library` | `starwind`, `fulldev`, `webcoreui`, `none` | Astro UI component library |
| `deploy_platform` | `vercel`, `netlify`, `cloudflare`, `none` | Deploy target |
| `rate_limit` | Number | API requests per second (default: 10) |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WP_ASTRO_MODE` | `router` | `router` (3 tools) or `full` (all 48) |
| `WP_ASTRO_CONFIG` | `config/sites.json` | Config file path |
| `WP_ASTRO_DB` | `data/wp-astro.db` | SQLite database path |
| `WP_ASTRO_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

---

## Architecture

### Project Structure

```
src/
  index.ts                — MCP server entry point (stdio transport)
  types/
    index.ts              — All TypeScript type definitions
    turndown-plugin-gfm.d.ts — Type declarations for turndown-plugin-gfm
  config/
    sites.ts              — SiteManager singleton (multi-site config)
    database.ts           — DatabaseManager singleton (SQLite state)
  tools/
    index.ts              — Tool aggregation and mode switching
    router.ts             — 3 router tools (wp_astro_run/help/describe)
    sites.ts              — 9 site management tools
    extract.ts            — 13 content extraction tools
    transform.ts          — 6 transform tools
    output.ts             — 7 output & media tools
    github.ts             — 6 GitHub tools
    export.ts             — 7 export pipeline tools
  schemas/
    sites.ts              — Zod schemas for site tools
    extract.ts            — Zod schemas for extract tools
    transform.ts          — Zod schemas for transform tools
    output.ts             — Zod schemas for output tools
    github.ts             — Zod schemas for GitHub tools
    export.ts             — Zod schemas for export tools
  services/
    wp-rest-client.ts     — WordPress REST API client
    content-analyzer.ts   — Content analysis engine
    html-to-markdown.ts   — 13-step conversion pipeline
    shortcode-resolver.ts — Shortcode parser and resolver
    link-rewriter.ts      — URL rewriting service
    frontmatter-builder.ts — Astro frontmatter generator
    astro-scaffolder.ts   — Project structure generator
    content-writer.ts     — File writer and media tools
  utils/
    errors.ts             — Error classes and response formatters
    logger.ts             — Logger singleton (stderr)
config/
  sites.json              — Site credentials (gitignored)
  sites.example.json      — Config template
data/
  wp-astro.db             — SQLite database (gitignored)
```

### Key Patterns

- **Router mode**: 3 meta-tools expose 48 actions via `wp_astro_run`, keeping the tool list clean for Claude
- **Singleton managers**: SiteManager, DatabaseManager, Logger — initialized once, shared everywhere
- **Token bucket rate limiting**: Per-site rate limiters with automatic backoff on 429 responses
- **HTTP connection pooling**: Keep-alive agents with 10 max sockets per site
- **SQLite state machine**: Export jobs and per-post state for crash recovery and resumability
- **Zod validation**: All tool inputs validated before processing
- **Error hierarchy**: `WPAstroError` base class with specific subclasses for clean error reporting

### Database Schema

```sql
export_jobs      — Tracks each migration run (site, status, progress counts)
export_posts     — Per-post state (pending/in_progress/completed/failed, retry count)
cached_terms     — Pre-fetched taxonomy terms for fast lookups
cached_authors   — Pre-fetched authors for fast lookups
url_map          — WordPress URL → Astro URL mappings (for redirects and link rewriting)
shortcode_map    — Per-site shortcode handling rules
audit_log        — Timestamped operation log for debugging
```

---

## FAQ

### General

**Q: Does this work with any WordPress site?**
Yes. It connects via the standard WordPress REST API, which is available on all WordPress sites since version 4.7. You just need a username and application password.

**Q: How many posts can it handle?**
It's designed for sites with 2,000-6,000+ posts. The SQLite-backed export engine processes in batches with full resumability — if it gets interrupted, just run `export_resume` and it picks up where it left off.

**Q: Does it download media/images?**
By default, no. Media stays on your WordPress server. The `rewrite` strategy swaps the domain in URLs (e.g., when WordPress moves to `app.example.com` and Astro takes over the main domain). A `download` strategy is planned for fully self-contained sites.

**Q: What Astro version does it target?**
Astro 5.x with content collections using the glob loader pattern.

### WordPress Compatibility

**Q: Does it work with Elementor?**
Yes. It detects Elementor from REST API namespaces and post meta, strips the wrapper `<div>` elements (sections, columns, widgets), and preserves the actual content.

**Q: Does it work with WPBakery / Divi / Beaver Builder?**
Yes. Page builder detection covers WPBakery (`[vc_row]` shortcodes), Divi (`et_pb_` classes), Beaver Builder (`fl-` classes), Bricks, and Oxygen. Builder markup is cleaned and content is extracted.

**Q: Does it preserve Yoast/RankMath SEO data?**
Yes. SEO metadata (title, description, canonical URL, OG image, robots, focus keyword) is extracted from Yoast (`yoast_head_json`) or RankMath (`rank_math_seo`) and included in the frontmatter.

**Q: Does it handle ACF fields?**
Yes. ACF data from the REST API is normalized: images become `{url, alt, width, height}`, post objects become `{wpId, slug, title}`, repeater fields become arrays, and groups are flattened.

**Q: What about custom post types?**
All registered post types are auto-detected and can be exported. Each CPT gets its own content collection directory.

**Q: Does it handle WordPress shortcodes?**
Yes. 20+ shortcodes are handled out of the box (gallery, video, audio, caption, WPBakery elements, Divi modules, Contact Form 7, WPForms, Gravity Forms, buttons, tabs, accordions). You can configure additional shortcodes per-site with `shortcode_configure`.

### Export & Deployment

**Q: Can I preview before doing a full export?**
Yes. Run `convert_preview` to see 3-5 sample posts converted to Markdown. Run `content_audit` to see a complexity report before committing to a full export.

**Q: What if the export fails halfway?**
Every post's state is tracked in SQLite. Run `export_resume` to continue from where it stopped. Run `export_retry` to reprocess any failed posts.

**Q: Does it generate redirects?**
Yes. `generate_redirects` creates redirect rules from the WordPress→Astro URL map. Supports Netlify (`_redirects`), Vercel (`vercel.json`), Cloudflare (`_redirects`), Apache (`.htaccess`), and Nginx.

**Q: Can I deploy to Vercel/Netlify/Cloudflare?**
Yes. The scaffolder generates platform-specific config files, and `github_deploy_config` creates the deploy configuration. Push to GitHub and connect your deploy platform.

**Q: Can I manage multiple sites?**
Yes. Register as many sites as you want. Each site has its own config, export settings, and state. Set a default site or specify `site_id` per command.

### Technical

**Q: What's the difference between `router` and `full` mode?**
In `router` mode (default), only 3 tools are exposed to Claude: `wp_astro_run`, `wp_astro_help`, `wp_astro_describe`. This saves tokens. In `full` mode, all 48 tools are exposed directly. Set via `WP_ASTRO_MODE` env var.

**Q: Does it handle rate limiting?**
Yes. Each site has a token-bucket rate limiter (default: 10 req/s). If WordPress returns a 429, the rate is automatically halved. Configurable via `rate_limit` in export config.

**Q: Is content sanitized for XSS?**
Yes. All HTML passes through DOMPurify before conversion. Only safe tags and attributes are allowed. No `<script>`, `onclick`, or `javascript:` URLs survive.

**Q: Where is state stored?**
In a SQLite database at `data/wp-astro.db` (gitignored). Contains export job state, cached terms/authors, URL mappings, shortcode rules, and audit logs. WAL mode enabled for concurrent reads.

---

## Troubleshooting

### "Authentication failed"
- Verify your application password is correct (generate a new one at `/wp-admin/profile.php`)
- Make sure the username matches exactly (case-sensitive)
- Check that the REST API is not blocked by a security plugin

### "Cannot connect to site"
- Verify the site URL is correct and includes `https://`
- Check that `/wp-json/` is accessible (try visiting `https://yoursite.com/wp-json/` in a browser)
- Some hosts block REST API access — check with your hosting provider

### "Rate limited"
- The default rate limit is 10 requests/second. Lower it via `site_export_config` if your host is strict
- The server automatically halves the rate on 429 responses

### "Export stalled"
- Run `export_progress` to check the current state
- Run `export_resume` to continue processing
- Run `export_retry` if posts failed

### "Page builder content looks wrong"
- Run `content_audit` to see which builders are detected
- Run `convert_preview` to inspect specific posts
- The pipeline strips builder wrappers and keeps content — some complex layouts may need manual review

---

## Requirements

- **Node.js** 18 or later
- **WordPress** 4.7+ with REST API enabled
- **Application password** (WordPress 5.6+ built-in, or via plugin for older versions)
- **GitHub token** (optional, for repo creation — generate at github.com/settings/tokens)

---

## Contributing

Contributions are welcome. Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run build` to verify
5. Submit a pull request

---

## License

MIT License. See [LICENSE](LICENSE) for details.
