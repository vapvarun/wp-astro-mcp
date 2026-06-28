# Changelog

All notable changes to WP Astro MCP are documented here.

## [3.2.0] - 2026-06-28

Astro 6 scaffold-currency fixes plus a dependency and MCP-protocol refresh. The generated projects targeted Astro 6 but emitted config that Astro 5+ rejects, so every scaffold with a deploy adapter failed `astro build`. This release makes the generated output actually build, closes an XSS gap in JSON mode, modernizes dependencies (Zod 4, Octokit 22, DOMPurify 3, latest MCP SDK), surfaces machine-readable tool output, and adds scaffold-output tests so the build regression is caught in CI.

### Added
- **MCP `structuredContent`** — every successful tool result now returns its JSON payload as `structuredContent` (2025-06-18 spec) alongside the existing text block, so callers no longer re-parse JSON out of prose. Non-object payloads are wrapped as `{ result: ... }` to satisfy the protocol's object requirement.
- **Fuller tool annotations** — `openWorldHint` is set across the data-tool surface (external WordPress/GitHub integration), and the 3 router tools (`wp_astro_run`/`help`/`describe`) are now annotated (run = destructive + open-world; help/describe = read-only + closed-world).
- **Scaffold smoke tests** (`test/scaffold-smoke.test.ts`, +9 tests → 108 total) that scaffold real projects to temp dirs and assert on the generated files (no `hybrid`, valid Zod-4 schema, sanitized JSON content, adapter-gated SSR routes, escaped JSON-LD).

### Changed
- **Dependencies modernized:** Zod 3 → 4 (`z.string().url()` migrated to `z.url()`), `@octokit/rest` 21 → 22, `isomorphic-dompurify` 2 → 3, `@modelcontextprotocol/sdk` → 1.29. Removed unused `p-limit` and `fast-xml-parser` (also clears their advisories). Bumped `engines.node` to `>=20` to match `better-sqlite3@12` and the generated Node-22 projects.
- **Dev-only advisories cleared** — `npm audit fix` (vitest → 3.2.6); `npm audit` now reports 0 vulnerabilities.
- Removed the unused `image: { layout, responsiveStyles }` config (the scaffolder renders plain `<img>` for remote WP media and never imports `astro:assets`).
- Supersedes the 3.0.0 "Hybrid output mode" note below — preview SSR now relies on the adapter + per-route `prerender`, not `output: 'hybrid'`.

### Fixed
- **Generated `astro.config.mjs` no longer emits `output: 'hybrid'`** (removed in Astro 5). Static-by-default + per-route `export const prerender = false` is the correct model; this alone broke every Vercel/Netlify/Cloudflare scaffold at build time.
- **Removed the malformed `experimental.fonts` block** — it used the wrong entry shape (`family` instead of `name`/`cssVariable`), a string `provider`, and was never wired into `BaseLayout`, so it failed Astro config validation while loading no font.
- **Zod 4 compatibility** in the generated content schema — `z.record(z.unknown())` (removed in Zod 4) is now the two-argument `z.record(z.string(), z.unknown())`.
- **JSON-mode XSS** — `writePostToJson` stored raw WordPress `content.rendered` that the generated `PostLayout` injects via `set:html`. It is now sanitized through the same DOMPurify allowlist as the Markdown path (extracted to a shared `sanitizeWpHtml`).
- **JSON-LD `</script>` breakout** — the `application/ld+json` `set:html` now escapes `<` to `<`.
- **Inert SSR routes** — the webhook receiver (`/api/hook.ts`) and draft `/preview` route are only scaffolded when a deploy adapter is configured, and the webhook endpoint now declares `export const prerender = false` so it is actually server-rendered.

## [3.1.0] - 2026-05-30

Security audit and remediation (Tier 1 + Tier 2), a test suite with CI, and a more discoverable tool surface. See `docs/AUDIT-2026-05-30.md` for the full audit.

### Added
- **Content styling for scaffolded sites** — scaffolder now generates `src/styles/global.css` with a `.content` typography baseline, a WordPress block-compatibility layer (alignwide/full, captions, columns, galleries, buttons), media rules, and a ≤640px responsive layer, imported globally from `BaseLayout`. On the Tailwind (starwind) path it wires `@tailwindcss/typography` + `@tailwindcss/vite` and applies `prose prose-slate max-w-none`; the baseline backs off via `.content:not(.prose)`. Non-Tailwind projects ship pure CSS with no build step.
- **Hybrid tool surface** — tool categories, promoted actions, and read-only/destructive annotations (`src/tools/metadata.ts`) for better discoverability via `wp_astro_run`/`help`/`describe`.
- **Test suite** — 99 tests (Vitest) covering content-writer, errors, frontmatter-builder, html-to-markdown, metadata, shortcode-resolver, sync deletion, and the WP REST client.
- **GitHub Actions CI** — `.github/workflows/ci.yml` runs typecheck, build, and tests.
- **Security & Trust Model** documented in `README.md` (credentials at rest, SSRF surface, GitHub token handling, bridge plugin auth, sanitization, SQLite).
- `typecheck` and `prepublishOnly` npm scripts.

### Fixed
- **Data-loss / sync integrity (Tier 1):** deletion detection no longer treats any fetch error as "deleted" — `get()` throws a distinct `NotFoundError` on 404 and the probe only deletes on a confirmed `NotFoundError`; trashed posts (`status === 'trash'`) are now detected; crash-orphaned `in_progress` export rows are reclaimed before each batch with transactional mark-complete; JSON-mode writes are atomic (temp-file + rename) and back up unparseable files to `.corrupt-*` instead of overwriting; force re-sync now carries `post_type` for non-default types.
- **Auth (Tier 1):** WP bridge `/verify-token` enforces `edit_post` after the signature check and hardens the token with a single-use 5-minute server-side nonce transient (accepted via header/POST to stay out of URLs).
- **Reliability (Tier 2):** 429 responses are retried (honoring `Retry-After`, else backoff + jitter) instead of aborting; pagination falls back to "page until short page" with a 10k-page cap when `x-wp-total` is absent; `export_validate` now reports real conversion-issue counts.
- **Webhook security (Tier 2):** signature verification fails closed — signature-present-but-no-secret and mismatches are rejected with a timing-safe compare; `webhook_secret`/`webhook_url` added to `SiteConfig`.
- **GitHub token at rest (Tier 2):** PAT is no longer written to `.git/config`; auth is supplied per-push via a process-scoped `-c http.extraHeader`.
- **SQLite:** added `busy_timeout = 5000` and versioned migrations gated on `PRAGMA user_version` (replacing blind `ALTER TABLE`).
- **WP bridge `/health`:** trimmed public response to `{status, plugin_version}`; verbose fields gated behind `manage_options`; webhook secret rendered as a password field.
- Internal-link rewriting ran after Turndown and was a no-op — now applied at the correct pipeline stage.

### Changed
- Upgraded `@modelcontextprotocol/sdk` to `^1.27.1` and `axios` to `^1.16.1` (resolves SSRF/prototype-pollution advisories).

## [3.0.0] - 2026-04-02

### Added
- **Phase 10: Webhook auto-rebuild** — `sync_webhook` action processes individual post webhooks from wp-astro-bridge (HMAC-verified, targeted single-post sync)
- **Phase 10: Deploy hook endpoint** — scaffolded Astro projects include `/api/hook.ts` for receiving webhooks
- **Phase 10: Bridge detection** — `site_add` auto-detects if wp-astro-bridge is installed
- **Phase 10: wordpress-plugin sync schedule** — `sync_schedule` supports `wordpress-plugin` platform with setup instructions
- **Phase 11: Draft preview** — scaffolded Astro projects include `/preview` SSR route for viewing unpublished drafts
- **Phase 11: Preview banner** — "You are previewing a draft" sticky banner on preview pages
- **Phase 11: Hybrid output mode** — Astro config switches to `output: 'hybrid'` for SSR preview support

### Changed
- Astro projects now generate in hybrid mode (static by default, SSR for preview route)

## [2.2.0] - 2026-04-02

### Added
- **Setup wizard** (`setup_wizard`) — one-command guided flow to go from WordPress site to deployed Astro frontend
- **Paginated blog index** — static pagination with `/blog/page/2/` URLs
- **Search page** — Pagefind integration with client-side search at `/search`
- **Related posts** — computed at build time using shared categories/tags
- **JSON Feed** — `/feed.json` alongside existing RSS and sitemap
- **Enhanced 404 page** — styled with links to home, blog, and search
- **Reading progress bar** — scroll progress indicator on post pages

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
