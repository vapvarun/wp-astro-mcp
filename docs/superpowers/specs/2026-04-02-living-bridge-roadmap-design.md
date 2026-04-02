# WP Astro MCP — "Living Bridge" Roadmap

**Date:** 2026-04-02
**Status:** Draft
**Author:** Varun Dubey

---

## Problem Statement

wp-astro-mcp today is a build-time tool: connect WordPress, extract content, scaffold Astro project, export. Once done, there's no ongoing connection between WordPress and the Astro frontend. Editors publish posts and nothing happens on the Astro side until someone manually runs sync commands.

This makes the tool feel like a one-time setup script rather than a living system. It limits adoption because:

1. Content changes don't flow to the live site automatically
2. Editors can't preview drafts on the real Astro frontend
3. Setup requires 8-10 separate commands — too many steps for first-time users
4. The scaffolded Astro project is a starter, not production-ready

## Vision

wp-astro-mcp becomes a **living bridge** between WordPress and Astro. WordPress stays as the CMS (hidden from public). Astro serves the fast public frontend. Content flows automatically from WordPress to Astro whenever editors publish, update, or delete posts.

Two pieces:

- **wp-astro-mcp** (MCP server) — the orchestrator, stays as-is but gains a setup wizard, smarter sync, and richer scaffolded output
- **wp-astro-bridge** (WordPress plugin) — lightweight plugin that fires webhooks and enables draft preview. Optional but recommended.

## Architecture

```
WordPress (Private: app.example.com)           Astro (Public: example.com)
┌──────────────────────────┐                   ┌────────────────────────┐
│  wp-admin (editors)       │                   │  Static pages (blog,   │
│  wp-astro-bridge plugin   │                   │  pages, collections)   │
│    - webhook on publish   │── webhook ──────> │                        │
│    - preview URL rewrite  │                   │  /preview (SSR route)  │
│    - REST SEO field       │                   │  /api/hook (webhook)   │
│    - health endpoint      │                   │                        │
└──────────────────────────┘                   └────────────────────────┘
            ^                                           ^
            │                                           │
            │          wp-astro-mcp (MCP server)        │
            │       ┌───────────────────────────┐       │
            └───────│  Setup wizard              │──────┘
                    │  Content extraction         │
                    │  HTML→Markdown pipeline      │
                    │  Astro project scaffolding   │
                    │  Export pipeline + sync      │
                    │  SQLite state management     │
                    └───────────────────────────┘
```

## Non-Goals

- Block-to-Astro-component mapping (Faust.js territory, huge scope)
- WPGraphQL support (REST API handles 90% of sites fine)
- Cloud IDE or AI-assisted editing (PhantomWP territory)
- Multiple template themes (one solid default beats 4 mediocre ones)
- Fleet management dashboard (internal need, not public priority)
- Content freshness scoring (nobody asked for it)
- Page builder content recovery (page builders produce complex nested HTML that doesn't convert cleanly to Markdown — we document this limitation honestly)

## Phased Delivery

### Phase 8: Setup Wizard + Production-Ready Scaffolding

**Goal:** Anyone with a WordPress site gets a working, deployable Astro frontend in 5 minutes. No plugin required.

**MCP Server — Setup Wizard:**

New `setup_wizard` action that runs one guided flow:

1. Ask for WordPress URL, username, app password
2. `site_add` — register site, auto-detect capabilities
3. `site_analyze` — count content, assess readiness
4. `site_export_config` — set output dir, deploy platform, media strategy (prompted interactively)
5. `convert_preview` — show 3 sample posts to verify quality
6. `scaffold_project` — create Astro project
7. `export_start` + `export_resume` (loop until done)
8. `generate_redirects`
9. `github_init` + `github_push` (if user wants)

One command replaces the current 8-10 step process. Each step shows progress and lets the user bail out or adjust.

**MCP Server — Scaffolded Project Improvements:**

The generated Astro project becomes production-deployable out of the box:

| Feature | Implementation |
|---------|---------------|
| **Search** | Pagefind integration — generates search index at build time, lightweight client-side search component on `/search` page |
| **Pagination** | Static paginated blog index: `/blog/`, `/blog/page/2/`, `/blog/page/3/` etc. Configurable posts-per-page. |
| **OG images** | Auto-generated using `satori` (Vercel's OG library). Title + featured image + site branding. Fallback to featured image if satori unavailable. |
| **Related posts** | Computed at build time using shared categories/tags. Injected into post pages. |
| **JSON Feed** | `/feed.json` alongside existing RSS and sitemap |
| **404 page** | Styled 404 page with search component included |
| **Reading progress** | Lightweight scroll progress bar on post pages |

**Success criteria:** A first-time user can go from "I have a WordPress blog" to "I have a deployed Astro frontend on Vercel" in a single session with one MCP command.

---

### Phase 9: wp-astro-bridge WordPress Plugin

**Goal:** Lightweight WordPress plugin that fires webhooks on content changes and enables draft preview. Optional — the tool works without it, but installing it unlocks auto-rebuild and preview.

**Plugin scope — 3 classes, zero dependencies:**

```
wordpress/wp-astro-bridge/
├── wp-astro-bridge.php              — Plugin header, hooks registration
├── includes/
│   ├── class-webhook.php            — Fires webhook on content events
│   ├── class-preview.php            — Rewrites preview button URL, generates token
│   └── class-rest.php               — Normalized SEO REST field, health endpoint, token verify
└── readme.txt                       — WordPress.org plugin directory format
```

**class-webhook.php:**
- Hooks into `transition_post_status` for all public post types
- Fires POST to configured webhook URL with payload:
  ```json
  {
    "action": "post_published|post_updated|post_trashed|post_deleted",
    "post_id": 1234,
    "post_type": "post",
    "slug": "my-post",
    "status": "publish",
    "modified_gmt": "2026-04-02T10:30:00Z",
    "bridge_version": "1.0.0"
  }
  ```
- HMAC-SHA256 signature in `X-Astro-Signature` header using configured webhook secret
- Debounce via 2-second transient (prevents autosave spam)
- Non-blocking: uses `wp_remote_post` with 5-second timeout, failures don't affect WordPress

**class-preview.php:**
- Filters `preview_post_link` to redirect to `{astro_url}/preview?token=xxx&id=123`
- Token: HMAC-signed `{post_id, user_id, exp}` using `wp_salt('auth')`
- 5-minute expiry, no shared secrets needed
- Only active when Astro frontend URL is configured

**class-rest.php:**
- Registers `astro_seo` REST field on all public post types — normalized format:
  ```json
  {
    "title": "SEO title",
    "description": "Meta description",
    "canonical": "https://...",
    "og_image": "https://...",
    "robots": "index,follow",
    "focus_keyword": "..."
  }
  ```
  Works with Yoast, RankMath, AIOSEO — same output format regardless of plugin.
- `GET /wp-json/astro-bridge/v1/health` — returns plugin version, WP version, configured URLs, last webhook timestamp
- `GET /wp-json/astro-bridge/v1/verify-token?token=xxx&post_id=123` — validates preview token, returns draft post data if valid

**Settings page — 3 fields:**
- Astro Frontend URL
- Webhook URL (where to POST on content changes)
- Webhook Secret (auto-generated on activation, with copy button)
- Enable/disable toggle

**Constraints:**
- No Composer dependencies
- No custom database tables
- No JavaScript admin bundles
- No cron jobs
- No dashboard widgets
- Compatible with WordPress 5.6+
- Installable via zip upload or wp-admin plugin installer

---

### Phase 10: Webhook-Triggered Auto-Rebuild + Reactive Sync

**Goal:** When an editor publishes a post, the Astro site rebuilds automatically within 1-2 minutes.

**MCP Server changes:**

- New `sync_webhook` action — receives webhook payload from wp-astro-bridge, validates HMAC signature, triggers targeted sync for just that one post (fetch → convert → write → commit → push). Much faster than full-site sync.
- `scaffold_project` generates `/api/hook.ts` server route in the Astro project — receives webhook from WordPress, triggers platform deploy hook:
  - Vercel: POST to deploy hook URL
  - Netlify: POST to build hook URL
  - Cloudflare: POST to deploy hook URL
- `sync_schedule` gains `wordpress-plugin` platform option — outputs the webhook URL to configure in wp-astro-bridge settings instead of generating a cron job
- `site_add` auto-detects if wp-astro-bridge is installed (checks `/wp-json/astro-bridge/v1/health`) and offers to configure webhook automatically

**For users WITHOUT the plugin:**
- `sync_schedule` with `github-actions` platform generates a cron-based GitHub Actions workflow (e.g., every 6 hours) that runs `sync_full` + commit + push. No plugin needed, just slower.

**Deploy hook flow:**
```
Editor clicks "Publish" in WordPress
  → wp-astro-bridge fires webhook to Astro /api/hook
  → Astro route triggers Vercel/Netlify/Cloudflare deploy hook
  → Platform rebuilds the site with latest content
  → New post is live in 1-2 minutes
```

---

### Phase 11: Draft Preview

**Goal:** Editors click "Preview" in WordPress and see their unpublished draft rendered on the real Astro frontend with the real design.

**Requires:** wp-astro-bridge plugin installed.

**Astro project changes:**

`scaffold_project` generates `src/pages/preview.astro` with `export const prerender = false` (hybrid SSR):

1. Receives `?token=xxx&id=123` query params
2. Calls wp-astro-bridge `verify-token` endpoint to validate token and get draft post data
3. Renders post using the same PostLayout component as published posts
4. Adds a preview banner at top: "You are previewing a draft. This page is not published."
5. Token expires after 5 minutes — editor must click "Preview" again in WordPress to get a new token

**Requirements:**
- Astro hybrid mode (`output: 'hybrid'` in astro.config)
- Server adapter installed (Vercel/Netlify/Cloudflare — already configured by scaffolder)
- wp-astro-bridge plugin with Astro Frontend URL configured

**Not included:**
- Live editing / inline editing from the preview page
- Automatic refresh on WordPress save (editor clicks Preview again)

---

## Competitive Positioning

| Feature | wp-astro-mcp | PhantomWP ($149) | Faust.js (WP Engine) | Starters |
|---------|-------------|------------------|---------------------|----------|
| Free / open source | Yes | No | Yes (Next.js only) | Yes |
| Astro framework | Yes | Yes | No (Next.js) | Yes |
| Multi-site support | Yes (unlimited) | Yes (unlimited) | No | No |
| Content sync | Webhook + cron | Webhook | ISR | Manual |
| Draft preview | Phase 11 | No | Yes | No |
| Setup wizard | Phase 8 | Built-in | Manual | Manual |
| Production scaffolding | Phase 8 (search, pagination, OG) | Yes | Manual | Basic |
| WP companion plugin | Phase 9 | No | FaustWP plugin | No |
| WordPress.org listing | Phase 9 | No | Yes | No |
| MCP / AI-native | Yes | Partial (AI editing) | No | No |
| Batch export + resume | Yes | No | No | No |
| Shortcode handling | Yes | Unknown | No | No |

**Our unique angle:** The only open-source, AI-native tool that provides a complete WordPress-to-Astro pipeline with a companion WordPress plugin. Free alternative to PhantomWP with better tooling (MCP-powered, batch export, multi-site).

## Timeline Estimate

| Phase | Scope | Effort |
|-------|-------|--------|
| Phase 8 | Setup wizard + scaffolding upgrades | Medium |
| Phase 9 | wp-astro-bridge plugin | Medium |
| Phase 10 | Webhook auto-rebuild + reactive sync | Medium |
| Phase 11 | Draft preview (Astro SSR) | Small-Medium |

Phases are independent and shippable. Each phase adds clear value on its own.

## Future Considerations (Post v3.0)

These are parked, not planned. Build only if community demand warrants:

- WPGraphQL support as alternative to REST API
- Block-to-component mapping for Gutenberg blocks
- ISR (Incremental Static Regeneration) for instant content updates without full rebuild
- Multi-site fleet dashboard and batch operations
- Template theme picker (magazine, docs, portfolio variants)
- `npx create-wp-astro` npm initializer package
- Astro Content Layer API direct integration (when Astro's CMS loader ecosystem matures)

## Success Metrics

- **Phase 8:** First-time user can go from WordPress site to deployed Astro frontend in under 10 minutes using `setup_wizard`
- **Phase 9:** wp-astro-bridge listed on WordPress.org plugin directory with 100+ active installs within 3 months
- **Phase 10:** Content published in WordPress appears on Astro frontend within 2 minutes without manual intervention
- **Phase 11:** Editor can preview any draft post on the real Astro frontend design
