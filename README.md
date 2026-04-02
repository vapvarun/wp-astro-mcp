# WP Astro MCP

> Add a blazing-fast Astro frontend to any WordPress site -- from a single blog to a network of 12 sites with 6,000+ posts. WordPress stays as your headless CMS. Fully automated via Claude Code.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)

**WP Astro MCP** is a [Model Context Protocol](https://modelcontextprotocol.io) server that adds a production-ready Astro frontend layer to your WordPress sites. WordPress remains your content engine -- the CMS where editors write, publish, and manage everything. Astro becomes the fast, public-facing delivery layer. The server connects to your WordPress REST API, extracts everything (posts, pages, CPTs, SEO, ACF, menus, media), converts HTML to clean Markdown, scaffolds a complete Astro project, keeps content in sync, and pushes to GitHub -- all through conversational commands in Claude Code.

---

## Why This Exists

Running WordPress as a headless CMS with an Astro frontend gives you the best of both worlds: WordPress's mature content management for editors, and Astro's static performance for visitors. But wiring it all up involves dozens of tedious steps: fetching content via API, resolving shortcodes, building frontmatter, setting up content collections, handling media URLs, generating redirects, deploying, and keeping content in sync as editors publish new posts.

This MCP server handles all of it. Tell Claude to set up your Astro frontend, and it orchestrates 55 specialized tools to get it done -- and keeps your Astro site current with every WordPress content change.

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

Go to your WordPress admin -> **Users -> Profile -> Application Passwords**. Enter a name, click "Add New", and copy the password.

### 4. Start Building

In Claude Code, just say:

```
Add my WordPress site example.com with username admin
and app password "xxxx xxxx xxxx xxxx xxxx xxxx"
```

Claude will register the site, auto-detect its capabilities (SEO plugin, ACF, post types, taxonomies), and guide you through setting up the Astro frontend.

---

## How It Works

```
WordPress (Headless CMS)          WP Astro MCP                      Astro (Public Frontend)
+-----------------+   REST API   +----------------+     Files       +---------------+
| Posts           |------------->| Extract        |---------------->| content/      |
| Pages           |              | Transform      |                 | blog/         |
| CPTs            |              | Scaffold       |                 | pages/        |
| Media           |              | Write          |                 | layouts/      |
| SEO             |              | Sync           |                 | pages/        |
| ACF             |              | SQLite state   |                 | astro.config  |
| Menus           |              | for resume     |                 | package.json  |
+-----------------+              +----------------+                 +---------------+
                                       |                                  |
                                       | GitHub API                       |
                                       v                                  v
                                 +----------------+              +---------------+
                                 | git init       |              | Vercel        |
                                 | create repo    |------------->| Netlify       |
                                 | push           |              | Cloudflare    |
                                 +----------------+              +---------------+

Ongoing: WordPress content changes --> sync tools --> Astro rebuild --> live site updated
```

### The Content Layer Pipeline

Every post goes through a 13-step conversion to generate the Astro content layer:

1. **Sanitize** -- DOMPurify removes XSS vectors while preserving content
2. **Resolve shortcodes** -- Built-in handlers (gallery, video, audio, caption) + custom per-site rules
3. **Process Gutenberg** -- Remove block comments (`<!-- wp:paragraph -->`), preserve content
4. **Normalize HTML** -- Decode entities, remove empty paragraphs, clean inline styles
5. **Convert to Markdown** -- Turndown with WordPress-specific rules (captions, galleries, code blocks, embeds)
6. **Rewrite links** -- Internal WordPress URLs -> Astro paths using URL map
7. **Rewrite media** -- Swap domains for media URLs (e.g., `example.com` -> `app.example.com`)
8. **Clean artifacts** -- Remove conversion leftovers, fix double-encoded entities
9. **Process embeds** -- YouTube/Vimeo iframes -> plain URLs
10. **Handle galleries** -- WordPress galleries -> image grids
11. **Fix whitespace** -- Ensure proper spacing around headings, lists, code blocks
12. **Validate** -- Flag remaining HTML, broken images, content loss

**Page builder note:** Content built with page builders (Elementor, WPBakery, Divi, etc.) comes through the REST API as deeply nested HTML -- far more markup than actual content. The pipeline extracts text content from this HTML, but complex layouts (multi-column sections, styled cards, animated elements) will lose their visual structure. This tool works best with standard WordPress content (Gutenberg blocks, classic editor). For page-builder-heavy sites, review output with `convert_preview` and expect some manual cleanup.

---

## Use Cases

### Add Astro Frontend to a Personal Blog

You have a WordPress blog with 200 posts and want a faster public-facing frontend while keeping WordPress as your content editor.

```
1. "Add my site myblog.com with username admin and password xxxx"
2. "Analyze the site"
3. "Set output to C:/projects/myblog-astro with Vercel deployment"
4. "Preview some converted posts"
5. "Scaffold the Astro project and export all content"
6. "Push to GitHub"
```

WordPress stays at `app.myblog.com` for content management. Astro serves `myblog.com`.

### Add Astro Frontend to a Business Website

A company site with Yoast SEO, ACF custom fields, and 500 posts/pages using the standard editor.

```
1. "Add site company.com" (auto-detects Yoast, ACF, post types)
2. "Run a content audit" (finds shortcodes, blocks, embeds, complexity)
3. "Configure shortcodes for CF7 forms and custom widgets"
4. "Preview 5 posts to check conversion quality"
5. "Export all content, media URLs pointing to app.company.com"
6. "Generate Netlify redirects and push to GitHub"
```

WordPress moves to `app.company.com` at go-live. Astro takes the main domain.

### Set Up Astro Frontends for Multiple Sites

An agency managing 12 WordPress sites that all need fast Astro frontends.

```
1. "Add all my sites" (register each with credentials)
2. "List all sites" (see capabilities and content counts)
3. "Analyze buddyxtheme.com" (1,941 posts, RankMath, ACF)
4. "Export buddyxtheme.com with year/month directories"
5. "Now do vapvarun.com" (switch sites seamlessly)
```

### Content Sync (The Core Ongoing Workflow)

WordPress is a living CMS -- editors publish new posts, update content, change images, and delete old pages daily. The sync tools keep your Astro frontend current without regenerating everything from scratch. This is the day-to-day operational workflow once your Astro frontend is live.

```
1. "Sync check myblog.com" (see what changed since last sync)
2. "Sync pull" (fetch and write only the changed content)
3. "Sync full with auto-commit" (check + pull + delete + commit in one command)
4. "Set up daily sync via GitHub Actions" (automate it permanently)
```

### Incremental Content Generation

Need to generate the Astro content layer for a subset of content, or resume after interruption.

```
1. "Export only posts modified after 2024-01-01"
2. "Resume the export" (picks up where it left off)
3. "Validate the export" (check for missing files or failures)
```

### Go-Live Domain Swap

At go-live, WordPress moves from `example.com` to a subdomain (e.g., `app.example.com`) where it continues as the headless backend. Astro takes over `example.com` as the public frontend.

```
1. During development: media URLs point to example.com (no changes needed)
2. At go-live: "Rewrite all media URLs from example.com to app.example.com"
3. "Generate redirects for Vercel"
```

---

## Full Workflow

Here is the complete workflow for adding an Astro frontend to your WordPress site, step by step:

### Phase 1: Connect and Discover

```
site_add          -> Register site, auto-detect WP version, SEO plugin,
                    ACF, WooCommerce, post types, taxonomies
site_analyze      -> Count all content, assess site readiness, estimate build time
site_export_config -> Set output directory, media strategy, deploy platform
```

### Phase 2: Audit and Prepare

```
content_audit     -> Sample posts, detect shortcodes, blocks, embeds,
                    galleries, tables, forms -- assess complexity
shortcode_scan    -> Find all shortcodes in use across the site
shortcode_configure -> Set handling rules (strip, keep content, map to component)
cache_terms       -> Pre-cache all taxonomy terms in SQLite
cache_authors     -> Pre-cache all authors in SQLite
```

### Phase 3: Preview and Verify

```
convert_preview   -> Convert 3-5 sample posts, review Markdown quality
convert_post      -> Convert a specific post to inspect in detail
extract_post      -> View raw WordPress data for debugging
```

### Phase 4: Scaffold and Generate Content Layer

```
scaffold_project  -> Create Astro project (config, layouts, pages, collections, RSS)
export_plan       -> Pre-flight check: content counts, config validation, time estimate
export_start      -> Begin batch content generation (processes first batch, creates SQLite job)
export_resume     -> Continue processing (call repeatedly until done)
export_progress   -> Check completion percentage and failures
export_retry      -> Re-process any failed posts
export_validate   -> Verify all output files exist and are valid
```

### Phase 5: Finalize and Go Live

```
generate_redirects -> Create redirect rules (Netlify, Vercel, Cloudflare, Apache, Nginx)
media_audit       -> Check all media references, find broken URLs
media_rewrite     -> Bulk swap media domains for go-live (example.com -> app.example.com)
github_init       -> Initialize git repository
github_create_repo -> Create GitHub repo (public or private)
github_commit     -> Stage and commit all changes
github_push       -> Push to GitHub
github_deploy_config -> Generate Vercel/Netlify/Cloudflare config
```

### Phase 6: Ongoing Content Sync (Day-to-Day Operations)

```
sync_check        -> Compare WordPress vs local files -- find new, updated, deleted posts
sync_pull         -> Fetch and write only changed content to Astro
sync_delete       -> Remove local files for posts deleted/trashed in WordPress
sync_full         -> Complete sync in one command: check -> pull -> delete -> optionally commit
sync_status       -> Show sync history and error counts
sync_schedule     -> Generate automated sync (GitHub Actions, cron, webhooks)
sync_reset        -> Clear sync tracking to force a full re-check
```

---

## Tool Reference

### Site Management (9 tools)

| Tool | Description |
|------|-------------|
| `site_add` | Register a WordPress site with credentials. Auto-detects WP version, REST namespaces, SEO plugin (Yoast/RankMath/AIOSEO), ACF, WooCommerce, post types, taxonomies. |
| `site_test` | Re-test connection and refresh detected capabilities. |
| `site_list` | List all registered sites with status, version, and content stats. |
| `site_get` | Get full details for a site (credentials are masked). |
| `site_update` | Update site credentials or settings. |
| `site_remove` | Deactivate a site (soft delete, can be reactivated). |
| `site_set_default` | Set a site as default (used when site_id is omitted). |
| `site_analyze` | Deep analysis: count all content types, detect capabilities, assess site readiness, estimate build time, recommend REST API vs WXR. |
| `site_export_config` | Configure per-site output: output dir, content format (md/mdx), media strategy, filters, component library, deploy platform, rate limit. |

### Content Extraction (13 tools)

| Tool | Description |
|------|-------------|
| `extract_posts` | Fetch posts with pagination. Any post type, status/date filters, embedded author/media/terms. |
| `extract_post` | Fetch single post with full content (edit context) and content analysis. |
| `extract_all_ids` | Lightweight fetch of all post IDs for two-phase strategy on large sites. |
| `extract_terms` | Fetch taxonomy terms (categories, tags, custom) with pagination. |
| `extract_authors` | Fetch all site authors with avatars. |
| `extract_media` | Fetch media items -- single by ID or paginated list. |
| `extract_menus` | Fetch navigation menus (WP 5.9+ and classic). |
| `extract_comments` | Fetch approved comments, optionally filtered by post. |
| `extract_settings` | Fetch site settings (title, tagline, timezone, permalink structure). |
| `extract_widgets` | Fetch sidebar/widget areas (WP 5.8+). |
| `cache_terms` | Bulk cache ALL terms for ALL taxonomies in SQLite. Run before generating content layer. |
| `cache_authors` | Bulk cache ALL authors in SQLite. Run before generating content layer. |
| `content_audit` | Sample posts, analyze shortcodes/blocks/embeds, assess complexity distribution. |

### Transform (6 tools)

| Tool | Description |
|------|-------------|
| `convert_post` | Convert a single post to Astro Markdown with full frontmatter and issue report. |
| `convert_preview` | Convert a sample batch to preview output quality before full content generation. |
| `convert_html` | Convert raw HTML to Markdown. Useful for testing conversion rules. |
| `shortcode_list` | List all configured shortcode handling rules for a site. |
| `shortcode_configure` | Set how a shortcode is handled: strip, keep_content, remove, component, html. |
| `shortcode_scan` | Scan posts for all shortcodes in use, find unconfigured ones. |

### Output and Media (7 tools)

| Tool | Description |
|------|-------------|
| `scaffold_project` | Create complete Astro project: package.json, astro.config, layouts, content collections, pages, RSS, deploy config. |
| `write_post` | Convert and write a single post as Markdown to the content directory. Supports dry_run. |
| `write_batch` | Convert and write a page of posts. Use with pagination for incremental writing. |
| `generate_redirects` | Generate redirect rules from WordPress->Astro URL map. Supports Netlify, Vercel, Cloudflare, Apache, Nginx. |
| `media_audit` | Scan generated files for media references. Report domains, counts, broken refs. |
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

### Content Generation Pipeline (7 tools)

| Tool | Description |
|------|-------------|
| `export_plan` | Pre-flight check: content counts, config validation, estimated build time, recommended batch size. |
| `export_start` | Start batch content generation. Fetches all post IDs, registers in SQLite, processes first batch. |
| `export_resume` | Continue an in-progress generation. Call repeatedly until complete. |
| `export_progress` | Show completion percentage, posts done/failed/pending, recent failures. |
| `export_retry` | Reset failed posts to pending and reprocess them. |
| `export_validate` | Verify output: check files exist, count issues, confirm completeness. |
| `export_cleanup` | Delete generation job data from database (does not delete files). |

### Content Sync (7 tools)

WordPress is your living CMS -- editors publish new posts, update content, change images, and delete old pages daily. The sync tools are the core ongoing workflow that keeps your Astro frontend current without regenerating the entire content layer.

| Tool | Description |
|------|-------------|
| `sync_check` | Compare WordPress vs local files. Report new, updated, and deleted posts without making changes. |
| `sync_pull` | Fetch and write only changed content. Handles new posts, updated posts, and slug changes. |
| `sync_delete` | Remove local files for posts deleted/trashed in WordPress. Cleans up URL map entries. |
| `sync_full` | Complete sync in one command: check -> pull -> delete -> optionally commit to git. |
| `sync_status` | Show sync history: last sync time, changes made, error counts. |
| `sync_schedule` | Generate automated sync config: GitHub Actions workflow, cron script, Netlify/Vercel webhooks. |
| `sync_reset` | Clear sync tracking to force a full re-check on next sync. |

**How it works:**
1. Queries WordPress REST API for posts modified after the last sync
2. Compares `modified_gmt` timestamps against stored values in SQLite
3. New posts (not in DB) -> fetched, converted, written as new Markdown files
4. Updated posts (newer `modified_gmt`) -> re-fetched, re-converted, file overwritten
5. Deleted posts (404 from WordPress) -> local file removed, URL map cleaned up
6. Slug changes -> old file deleted, new file written, redirects updated

**Sync workflows:**
```
# Manual sync -- check what changed, then pull
sync_check -> sync_pull -> github_commit -> github_push

# One-command sync with auto-commit
sync_full -> github_push

# Automated daily sync via GitHub Actions
sync_schedule (platform: github-actions, interval: daily)

# Real-time sync via WordPress webhooks
sync_schedule (platform: vercel)  # or netlify
```

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
| `content_format` | `md`, `mdx`, `json` | Markdown, MDX, or JSON output. **Use `json` for sites with 500+ posts** -- avoids Astro's markdown parsing OOM. |
| `media_strategy` | `keep`, `rewrite`, `download` | How to handle media URLs |
| `media_domain` | Domain | New domain for media (used with `rewrite` strategy at go-live, e.g., `app.example.com`) |
| `include_post_types` | Array | Only generate content for these post types |
| `exclude_post_types` | Array | Skip these post types |
| `include_statuses` | Array | Post statuses to include (default: `["publish"]`) |
| `include_drafts` | Boolean | Include draft posts |
| `include_comments` | Boolean | Include comments in content layer |
| `year_month_dirs` | Boolean | Organize posts in `YYYY/MM/` directories |
| `date_after` | ISO date | Only generate content after this date |
| `date_before` | ISO date | Only generate content before this date |
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
  index.ts                -- MCP server entry point (stdio transport)
  types/
    index.ts              -- All TypeScript type definitions
    turndown-plugin-gfm.d.ts -- Type declarations for turndown-plugin-gfm
  config/
    sites.ts              -- SiteManager singleton (multi-site config)
    database.ts           -- DatabaseManager singleton (SQLite state)
  tools/
    index.ts              -- Tool aggregation and mode switching
    router.ts             -- 3 router tools (wp_astro_run/help/describe)
    sites.ts              -- 9 site management tools
    extract.ts            -- 13 content extraction tools
    transform.ts          -- 6 transform tools
    output.ts             -- 7 output and media tools
    github.ts             -- 6 GitHub tools
    export.ts             -- 7 content generation pipeline tools
    sync.ts               -- 7 content sync tools
  schemas/
    sites.ts              -- Zod schemas for site tools
    extract.ts            -- Zod schemas for extract tools
    transform.ts          -- Zod schemas for transform tools
    output.ts             -- Zod schemas for output tools
    github.ts             -- Zod schemas for GitHub tools
    export.ts             -- Zod schemas for generation pipeline tools
    sync.ts               -- Zod schemas for content sync tools
  services/
    wp-rest-client.ts     -- WordPress REST API client
    content-analyzer.ts   -- Content analysis engine
    html-to-markdown.ts   -- 13-step conversion pipeline
    shortcode-resolver.ts -- Shortcode parser and resolver
    link-rewriter.ts      -- URL rewriting service
    frontmatter-builder.ts -- Astro frontmatter generator
    astro-scaffolder.ts   -- Project structure generator
    content-writer.ts     -- File writer and media tools
  utils/
    errors.ts             -- Error classes and response formatters
    logger.ts             -- Logger singleton (stderr)
config/
  sites.json              -- Site credentials (gitignored)
  sites.example.json      -- Config template
data/
  wp-astro.db             -- SQLite database (gitignored)
```

### Key Patterns

- **Router mode**: 3 meta-tools expose 48 actions via `wp_astro_run`, keeping the tool list clean for Claude
- **Singleton managers**: SiteManager, DatabaseManager, Logger -- initialized once, shared everywhere
- **Token bucket rate limiting**: Per-site rate limiters with automatic backoff on 429 responses
- **HTTP connection pooling**: Keep-alive agents with 10 max sockets per site
- **SQLite state machine**: Generation jobs and per-post state for crash recovery and resumability
- **Zod validation**: All tool inputs validated before processing
- **Error hierarchy**: `WPAstroError` base class with specific subclasses for clean error reporting

### Database Schema

```sql
export_jobs      -- Tracks each content generation run (site, status, progress counts)
export_posts     -- Per-post state (pending/in_progress/completed/failed, retry count)
cached_terms     -- Pre-fetched taxonomy terms for fast lookups
cached_authors   -- Pre-fetched authors for fast lookups
url_map          -- WordPress URL -> Astro URL mappings (for redirects and link rewriting)
shortcode_map    -- Per-site shortcode handling rules
audit_log        -- Timestamped operation log for debugging
```

---

## FAQ

### General

**Q: Does this work with any WordPress site?**
Yes. It connects via the standard WordPress REST API, which is available on all WordPress sites since version 4.7. You just need a username and application password. WordPress continues running as your headless CMS backend -- nothing changes on the WordPress side.

**Q: Does WordPress stay running?**
Yes. WordPress is the content engine. Editors continue using the WordPress admin to write posts, manage media, update pages, and handle all content operations. Astro is purely the public-facing delivery layer that serves content to visitors.

**Q: How many posts can it handle?**
It is designed for sites with 2,000-6,000+ posts. The SQLite-backed generation engine processes in batches with full resumability -- if it gets interrupted, just run `export_resume` and it picks up where it left off.

**Q: Does it download media/images?**
By default, no. Media stays on your WordPress server. The `rewrite` strategy swaps the domain in URLs for go-live (e.g., when WordPress moves to `app.example.com` and Astro takes over the main domain). A `download` strategy is planned for fully self-contained sites.

**Q: What Astro version does it target?**
Astro 5.x with content collections using the glob loader pattern.

### WordPress Compatibility

**Q: Does it work with page builders (Elementor, WPBakery, Divi, etc.)?**
Partially. Page builders store content as complex nested HTML with more markup than actual text. The REST API serves this rendered HTML, and the converter extracts the text content. However, multi-column layouts, styled sections, and visual design elements will not carry over -- you get the content, not the layout. This tool works best with standard Gutenberg or classic editor content. For page-builder-heavy sites, use `convert_preview` to assess quality and expect manual work on complex pages.

**Q: Does it preserve Yoast/RankMath SEO data?**
Yes. SEO metadata (title, description, canonical URL, OG image, robots, focus keyword) is extracted from Yoast (`yoast_head_json`) or RankMath (`rank_math_seo`) and included in the Astro frontmatter.

**Q: Does it handle ACF fields?**
Yes. ACF data from the REST API is normalized: images become `{url, alt, width, height}`, post objects become `{wpId, slug, title}`, repeater fields become arrays, and groups are flattened.

**Q: What about custom post types?**
All registered post types are auto-detected and can be included in the Astro content layer. Each CPT gets its own content collection directory.

**Q: Does it handle WordPress shortcodes?**
Yes. Common WordPress shortcodes are handled out of the box (gallery, video, audio, caption, embed). You can configure additional shortcodes per-site with `shortcode_configure` -- set them to strip, keep content, remove, or map to an Astro component.

### Content Sync and Ongoing Updates

**Q: How do I keep the Astro frontend updated when WordPress content changes?**
Use the sync tools -- they are the core day-to-day workflow. `sync_check` shows what changed, `sync_pull` fetches updates, or `sync_full` does everything in one command. Sync detects new posts, updated content, slug changes, and deleted posts by comparing `modified_gmt` timestamps.

**Q: Can I automate the sync?**
Yes. `sync_schedule` generates GitHub Actions workflows (cron-based), cron scripts, or Netlify/Vercel webhooks for real-time sync on every WordPress post save.

**Q: What happens when a post is updated in WordPress?**
On the next sync, the tool detects the newer `modified_gmt` timestamp, re-fetches the post from the REST API, re-converts it to Markdown with updated frontmatter (categories, SEO, ACF, images), and overwrites the local file. The Astro site rebuilds with fresh content.

### Content Generation and Deployment

**Q: Can I preview before generating the full content layer?**
Yes. Run `convert_preview` to see 3-5 sample posts converted to Markdown. Run `content_audit` to see a complexity report before committing to a full build.

**Q: What if the content generation fails halfway?**
Every post's state is tracked in SQLite. Run `export_resume` to continue from where it stopped. Run `export_retry` to reprocess any failed posts.

**Q: Does it generate redirects?**
Yes. `generate_redirects` creates redirect rules from the WordPress->Astro URL map. Supports Netlify (`_redirects`), Vercel (`vercel.json`), Cloudflare (`_redirects`), Apache (`.htaccess`), and Nginx.

**Q: Can I deploy to Vercel/Netlify/Cloudflare?**
Yes. The scaffolder generates platform-specific config files, and `github_deploy_config` creates the deploy configuration. Push to GitHub and connect your deploy platform.

**Q: Can I manage multiple sites?**
Yes. Register as many WordPress sites as you want. Each site has its own config, output settings, and state. Set a default site or specify `site_id` per command.

**Q: What happens at go-live?**
WordPress moves to a subdomain (e.g., `app.example.com`) where it continues as the headless backend, hidden from public visitors. Astro takes over the main domain (`example.com`) as the fast, public-facing frontend. The `media_rewrite` tool handles the URL swap across all generated content.

### Technical

**Q: What is the difference between `router` and `full` mode?**
In `router` mode (default), only 3 tools are exposed to Claude: `wp_astro_run`, `wp_astro_help`, `wp_astro_describe`. This saves tokens. In `full` mode, all 55 tools are exposed directly. Set via `WP_ASTRO_MODE` env var.

**Q: Does it handle rate limiting?**
Yes. Each site has a token-bucket rate limiter (default: 10 req/s). If WordPress returns a 429, the rate is automatically halved. Configurable via `rate_limit` in export config.

**Q: Is content sanitized for XSS?**
Yes. All HTML passes through DOMPurify before conversion. Only safe tags and attributes are allowed. No `<script>`, `onclick`, or `javascript:` URLs survive.

**Q: Where is state stored?**
In a SQLite database at `data/wp-astro.db` (gitignored). Contains generation job state, cached terms/authors, URL mappings, shortcode rules, and audit logs. WAL mode enabled for concurrent reads.

---

## Troubleshooting

### "Authentication failed"
- Verify your application password is correct (generate a new one at `/wp-admin/profile.php`)
- Make sure the username matches exactly (case-sensitive)
- Check that the REST API is not blocked by a security plugin

### "Cannot connect to site"
- Verify the site URL is correct and includes `https://`
- Check that `/wp-json/` is accessible (try visiting `https://yoursite.com/wp-json/` in a browser)
- Some hosts block REST API access -- check with your hosting provider

### "Rate limited"
- The default rate limit is 10 requests/second. Lower it via `site_export_config` if your host is strict
- The server automatically halves the rate on 429 responses

### "Content generation stalled"
- Run `export_progress` to check the current state
- Run `export_resume` to continue processing
- Run `export_retry` if posts failed

### "Page builder content looks messy"
- Page builders (Elementor, WPBakery, Divi) produce deeply nested HTML -- the converter extracts text but loses layout structure
- Run `convert_preview` to inspect how specific posts convert
- For complex builder pages, consider keeping them as HTML (`content_format: "json"`) or rebuilding layouts in Astro components
- Standard Gutenberg and classic editor content converts cleanly

### Astro build OOM with many posts (500+)

If the **generated Astro site** runs out of memory during `astro build`, the problem is Astro's content collection parsing 500+ markdown files. Each `.md` file goes through Astro's markdown pipeline, which eats ~2MB per file.

**Fix:** Switch to JSON mode in your export config:
```
site_export_config -> content_format: "json"
```

This writes a single `src/data/blog.json` instead of individual `.md` files. Astro imports the JSON directly -- no markdown parsing, no OOM. Content stays as HTML and is rendered via `set:html`.

| Posts | Recommended Format |
|-------|-------------------|
| < 500 | `md` (content collections) |
| 500-2000 | `json` (recommended) |
| 2000+ | `json` (required for CI/CD) |

### Build fails with "JavaScript heap out of memory"

If the **MCP server build** (`npm run build`) runs out of memory, the problem is TypeScript compilation on CI/CD platforms with limited memory (Cloudflare Pages ~4GB, Netlify ~3GB).

**Quick fix:** Use the built-in memory-optimized build scripts:
```bash
npm run build          # 4GB heap limit
npm run build:low-mem  # 2GB heap + incremental compilation
```

**Per-platform fixes:**

| Platform | Solution |
|----------|----------|
| Cloudflare Pages | Set build command to `npm run build` or add env var `NODE_OPTIONS=--max-old-space-size=3072` |
| Netlify | Add env var `NODE_OPTIONS=--max-old-space-size=3072` in Site Settings -> Build & Deploy -> Environment |
| Vercel | Usually fine (8GB default). If failing, add `NODE_OPTIONS=--max-old-space-size=4096` in Project Settings -> Environment Variables |
| GitHub Actions | Add `env: NODE_OPTIONS: --max-old-space-size=4096` to your build step |

**Still failing?** Pre-build locally and commit the `dist/` folder -- skip compilation on CI entirely.

See [docs/faq.md](docs/faq.md#build--deployment) for detailed CI/CD setup guides per platform.

---

## Requirements

- **Node.js** 18 or later
- **WordPress** 4.7+ with REST API enabled
- **Application password** (WordPress 5.6+ built-in, or via plugin for older versions)
- **GitHub token** (optional, for repo creation -- generate at github.com/settings/tokens)

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
