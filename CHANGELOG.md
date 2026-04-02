# Changelog

All notable changes to WP Astro MCP are documented here.

## [2.1.0] - 2026-04-02

### Changed
- **Reframed messaging**: No longer positioned as a "migration" tool. WP Astro MCP adds an Astro frontend layer to WordPress sites -- WordPress stays as the headless CMS backend, hidden from public. All descriptions, README, tool descriptions, and CLAUDE.md updated.
- Fixed `wp_astro_help` category list (was listing nonexistent categories like `analyze`, `scaffold`)
- Fixed `export_preview` → `convert_preview` in site_add next_steps
- Fixed `require('path')` in export.ts → proper ESM `import path`
- Added TODO for export issues serialization limitation

## [2.0.0] - 2026-04-02

### Breaking Changes
- Generated Astro projects now target **Astro 6.0** (was 5.0)
- Generated projects require **Node.js 22.12+** (was 18+)
- Zod schemas import from `astro/zod` (was `astro:content`)
- Removed `@astrojs/tailwind` dependency — Tailwind v4 works natively via `@tailwindcss/vite`

### Added
- **JSON-LD structured data** (BlogPosting schema with `mainEntityOfPage`) on all post pages — both collection-mode and JSON-mode
- **Twitter Card meta tags** (`summary_large_image` with OG image, `summary` without)
- **Full Open Graph article metadata** (`article:published_time`, `article:modified_time`, `og:site_name`, `og:url`)
- **Astro 6 Fonts API** (experimental) with Google Fonts provider (Inter)
- **Responsive image config** (`layout: 'constrained'`, `responsiveStyles: true`)
- **Aspect-ratio CSS** on featured images to prevent layout shift
- `.nvmrc` file generated with Node 22 for deployment environments
- Enhanced date formatting (long month names) in post templates

### Changed
- Astro core: `^5.0.0` -> `^6.0.0`
- `@astrojs/sitemap`: `^3.2.0` -> `^4.0.0`
- `@astrojs/rss`: `^4.0.0` -> `^5.0.0`
- `@astrojs/vercel`: `^8.0.0` -> `^9.0.0`
- `@astrojs/netlify`: `^6.0.0` -> `^7.0.0`
- `@astrojs/cloudflare`: `^12.0.0` -> `^13.0.0`
- Cloudflare `compatibility_date`: `2024-01-01` -> `2026-03-01`
- RSS feed handler: `context.site` -> `import.meta.env.SITE` (Astro 6 pattern)
- `env.d.ts`: `reference path` -> `reference types="astro/client"`
- Content collections: `defineCollection` + `z` from separate imports
- BaseLayout title now uses `Title | Site Name` format
- `canonicalURL.href` used for meta content strings (was URL object)

### Fixed
- Fonts API placed under `experimental` (not top-level — still experimental in Astro 6.0)
- JSON-mode PostLayout now has full SEO parity with collection-mode (was missing JSON-LD, OG, Twitter)

## [1.0.0] - 2026-03-28

### Added
- **55 specialized tools** across 8 modules: sites, extract, transform, output, GitHub, export, sync, router
- **Router mode** (default): 3 meta-tools (`wp_astro_run`, `wp_astro_help`, `wp_astro_describe`) expose all 55 actions
- **Full mode**: All 55 tools listed directly for advanced usage
- **13-step HTML-to-Markdown pipeline**: sanitize, resolve shortcodes, clean page builder markup, process Gutenberg blocks, normalize HTML, convert via Turndown with 10+ custom rules, rewrite links, rewrite media, clean artifacts, process embeds, handle galleries, fix whitespace, validate
- **WordPress REST API client** with rate limiting, retry with exponential backoff, connection pooling
- **Content extraction**: posts, pages, CPTs, terms, authors, media, menus, comments, settings, widgets
- **Page builder support**: Elementor, WPBakery, Divi, Beaver Builder, Bricks, Oxygen
- **SEO plugin detection**: Yoast, Rank Math, AIOSEO — metadata extracted to frontmatter
- **ACF custom fields** preserved in frontmatter
- **WPML translation** support
- **Astro project scaffolding**: config, layouts, pages, content collections, deploy configs
- **Content collections** with typed Zod schemas for all WordPress data
- **JSON data mode** for large sites (500+ posts) — bypasses markdown parsing OOM
- **GitHub integration**: init, create repo, commit, push, deploy config generation
- **Export pipeline**: batch processing with progress tracking, resume from interruption, retry failed posts
- **Content sync**: change detection via timestamps + content hashes, incremental pull, delete tracking
- **Multi-site support**: register up to 12 WordPress sites with separate configs
- **Deploy platform configs**: Vercel, Netlify, Cloudflare
- **SQLite state management**: export jobs, post status, URL maps, shortcode rules, audit log, sync history
- **Redirect generation** from WordPress URLs to Astro paths
- MIT license
