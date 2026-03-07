# WP Astro MCP

MCP server for migrating WordPress sites to Astro. Multi-site support, batch processing, and GitHub publishing — all from Claude Code.

## What it does

- **Connects** to any WordPress site via REST API (application passwords)
- **Extracts** posts, pages, CPTs, taxonomies, authors, media, menus, comments, SEO metadata, ACF fields
- **Converts** HTML to clean Markdown with a 13-step pipeline (DOMPurify → Turndown → shortcode resolution → page builder cleanup → link rewriting)
- **Scaffolds** a complete Astro project (content collections, layouts, pages, RSS, sitemap, deploy config)
- **Exports** thousands of posts with SQLite-backed resumability, progress tracking, and retry
- **Publishes** to GitHub with Vercel/Netlify/Cloudflare deploy configuration

## Quick Start

```bash
git clone https://github.com/developer-jeswanth/wp-astro-mcp.git
cd wp-astro-mcp
npm install
npm run build
```

Add to your Claude Code MCP config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "wp-astro-mcp": {
      "command": "node",
      "args": ["C:/path/to/wp-astro-mcp/dist/index.js"]
    }
  }
}
```

## Workflow

```
1. site_add          → Register WordPress site (auto-detects capabilities)
2. site_analyze      → Count content, detect plugins
3. site_export_config → Set output dir, media strategy, deploy platform
4. content_audit     → Scan for shortcodes, page builders, complexity
5. convert_preview   → Preview Markdown output quality
6. scaffold_project  → Create Astro project structure
7. export_start      → Batch export all content
8. export_resume     → Continue (call repeatedly until done)
9. generate_redirects → Create redirect rules
10. github_init → github_push → Deploy
```

## 48 Tools in 7 Categories

All tools are available via 3 router tools (`wp_astro_run`, `wp_astro_help`, `wp_astro_describe`) for token efficiency.

| Category | Tools | Description |
|----------|-------|-------------|
| **site** | 9 | Add, test, list, analyze, configure WordPress sites |
| **extract** | 13 | Fetch posts, terms, authors, media, menus, comments, settings |
| **transform** | 6 | Convert HTML→Markdown, manage shortcodes |
| **output** | 7 | Scaffold Astro project, write files, redirects, media audit |
| **github** | 6 | Git init, create repo, commit, push, deploy config |
| **export** | 7 | Batch processing with resume, retry, validate, cleanup |

## Features

### Content Handling
- Posts, pages, and custom post types
- Categories, tags, and custom taxonomies
- Authors with avatars
- Featured images with dimensions
- Comments (optional)
- Navigation menus
- Widget areas

### Smart Detection
- SEO plugins: Yoast, RankMath, AIOSEO
- Page builders: Elementor, WPBakery, Divi, Beaver Builder, Bricks, Oxygen
- ACF fields (repeaters, relationships, flexible content)
- WooCommerce
- Gutenberg blocks

### Conversion Pipeline
1. HTML sanitization (DOMPurify)
2. Shortcode resolution (20+ built-in handlers + per-site rules)
3. Page builder markup cleanup
4. Gutenberg block comment removal
5. HTML normalization
6. Turndown conversion with 12 WordPress-specific rules
7. Internal link rewriting
8. Media URL domain swapping
9. Markdown artifact cleanup
10. Embed processing
11. Gallery handling
12. Whitespace normalization
13. Output validation

### Media Strategy
- **keep**: Leave URLs unchanged
- **rewrite**: Swap domain (e.g., `example.com` → `app.example.com`) for when WordPress moves to a subdomain
- **download**: (planned) Download media locally

### Export Engine
- SQLite state machine for resumability
- Per-post progress tracking
- Retry failed posts
- Content hash for incremental sync
- Validation and audit

## Configuration

Copy `config/sites.example.json` to `config/sites.json`:

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
        "year_month_dirs": true,
        "component_library": "starwind",
        "deploy_platform": "vercel",
        "rate_limit": 10
      }
    }
  ],
  "github_token": "ghp_your_token_here"
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WP_ASTRO_MODE` | `router` | `router` (3 tools) or `full` (all 48 tools) |
| `WP_ASTRO_CONFIG` | `config/sites.json` | Config file path |
| `WP_ASTRO_DB` | `data/wp-astro.db` | SQLite database path |
| `WP_ASTRO_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Requirements

- Node.js 18+
- WordPress site with REST API enabled
- Application password (generate at `/wp-admin/profile.php`)

## License

MIT
