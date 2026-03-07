# Frequently Asked Questions

## Setup & Installation

### How do I generate a WordPress Application Password?

1. Log in to WordPress admin
2. Go to **Users → Profile**
3. Scroll to **Application Passwords** section
4. Enter a name (e.g., "Astro Migration")
5. Click **Add New Application Password**
6. Copy the password immediately — it's shown only once

Application Passwords are built into WordPress 5.6+. For older versions, use the [Application Passwords plugin](https://wordpress.org/plugins/application-passwords/).

### Do I need admin access?

An **Editor** role is sufficient for reading content. **Admin** is needed for:
- Reading site settings (title, tagline, permalink structure)
- Accessing user list with avatars
- Fetching some custom post type data

### My site uses a custom REST API prefix. Does it work?

The server connects to `/wp-json/` by default, which is the WordPress standard. If your site uses a custom prefix, the connection will fail. Most sites use the default.

### Can I use this without Claude Code?

Not easily. This is an MCP server designed to be used through an MCP client (like Claude Code). It communicates via stdio, not HTTP. You could theoretically build a custom MCP client, but Claude Code is the intended interface.

---

## Content & Conversion

### What content is exported?

| Content Type | Exported | Source |
|-------------|----------|--------|
| Posts | Yes | REST API |
| Pages | Yes | REST API |
| Custom Post Types | Yes | REST API |
| Categories | Yes | REST API + cached in SQLite |
| Tags | Yes | REST API + cached in SQLite |
| Custom Taxonomies | Yes | REST API |
| Authors | Yes | REST API + cached in SQLite |
| Featured Images | URL only | Embedded in post data |
| Comments | Optional | REST API |
| Menus | Yes | REST API (WP 5.9+) |
| Widgets | Yes | REST API (WP 5.8+) |
| ACF Fields | Yes | REST API |
| SEO (Yoast/RankMath) | Yes | REST API |
| Site Settings | Yes | REST API |

### What is NOT exported?

- Theme PHP files (Astro has its own templating)
- Plugin functionality (needs Astro equivalents)
- WordPress options table (only exposed settings)
- Database directly (uses REST API only)
- User passwords or sessions
- WooCommerce cart/checkout flow

### How does it handle images and media?

Three strategies:

| Strategy | Behavior | Use When |
|----------|----------|----------|
| `keep` | Leave all URLs unchanged | Media stays at the same domain |
| `rewrite` | Swap domain in URLs | WordPress moves to a subdomain (e.g., `app.example.com`) |
| `download` | Download files locally | (Planned) Fully self-contained site |

With `rewrite`, you set `media_domain` in export config. All `wp-content/uploads/` URLs get the new domain. You can also do this post-export with `media_rewrite`.

### How are shortcodes handled?

**20+ built-in handlers** cover common shortcodes:

| Shortcode | Handling |
|-----------|----------|
| `[gallery]` | Image grid |
| `[caption]` | Figure with figcaption |
| `[video]` / `[audio]` | HTML5 media elements |
| `[vc_row]`, `[vc_column]`, etc. | Content extracted, wrapper removed |
| `[et_pb_section]`, `[et_pb_row]`, etc. | Content extracted, wrapper removed |
| `[contact-form-7]` | HTML comment with form ID |
| `[wpforms]` | HTML comment with form ID |
| `[gravityform]` | HTML comment with form ID |
| `[button]` | Markdown link |
| `[tabs]`, `[accordion]` | HTML structure preserved |

**For custom shortcodes**, configure handling per-site:
```
shortcode_configure → site_id, shortcode: "my_widget", action: "keep_content"
```

Actions:
- `strip` — Remove the shortcode and its content entirely
- `keep_content` — Remove tags, keep inner content
- `remove` — Delete shortcode and all content inside
- `component` — Replace with an Astro component placeholder
- `html` — Convert to HTML equivalent

### How does it handle page builders?

| Builder | Detection | Handling |
|---------|-----------|----------|
| **Elementor** | `_elementor_data` meta, REST namespace | Strip section/column/widget wrappers, keep content |
| **WPBakery** | `[vc_row]` shortcodes | Resolve shortcodes, extract content |
| **Divi** | `et_pb_` CSS classes | Strip section/row/column wrappers |
| **Beaver Builder** | `_fl_builder_data` meta | Strip `fl-` wrappers |
| **Bricks** | `_bricks_page_content_2` meta | Detected, basic cleanup |
| **Oxygen** | `ct_builder_shortcodes` meta | Detected, basic cleanup |

The pipeline strips layout wrappers but preserves the actual content. Complex layouts (multi-column, custom styling) become linear content — you may want to recreate specific layouts in Astro components.

### Does it preserve SEO metadata?

Yes. SEO data goes into frontmatter:

```yaml
seo:
  title: "Custom SEO Title"
  description: "Meta description for search engines"
  canonical: "https://example.com/canonical-url"
  ogImage: "https://example.com/og-image.jpg"
  noindex: false
  focusKeyword: "target keyword"
```

Supported plugins: Yoast SEO, RankMath, AIOSEO.

### What about Gutenberg blocks?

Gutenberg block comments (`<!-- wp:paragraph -->`) are stripped. The HTML content inside blocks is preserved and converted to Markdown normally. The `content_audit` tool reports which blocks are used across your site.

---

## Content Sync & Ongoing Updates

### How do I keep my Astro site updated when WordPress content changes?

Use the sync tools. After the initial export, you don't need to re-run a full export — just sync:

```
sync_check → see what changed since last sync
sync_pull  → fetch and write only changed content
sync_full  → do everything in one step (check + pull + delete + commit)
```

### What triggers a sync?

The sync detects changes by comparing WordPress `modified_gmt` timestamps against stored values in SQLite. Any of these WordPress actions will be picked up:

- New post/page/CPT published
- Existing post content edited
- Featured image changed
- Category/tag assignment changed
- SEO metadata updated (Yoast/RankMath)
- ACF field values changed
- Post slug changed (automatically deletes old file, writes new one)
- Post deleted or trashed

### Can I automate the sync?

Yes. `sync_schedule` generates platform-specific automation:

| Platform | What it generates | Trigger |
|----------|------------------|---------|
| GitHub Actions | `.github/workflows/sync-content.yml` | Cron schedule (hourly/daily/weekly) |
| Cron | `scripts/sync.sh` | System cron job |
| Netlify | `netlify/functions/sync-webhook.mts` | WordPress webhook on post save |
| Vercel | `api/sync-webhook.ts` | WordPress webhook on post save |

For **scheduled sync** (GitHub Actions, cron): the sync runs at fixed intervals, checks for changes, and pushes if anything changed.

For **real-time sync** (Netlify/Vercel webhooks): WordPress sends a webhook on every post save/update/delete, which triggers a new build.

### What happens if a post slug changes?

The sync detects slug changes by matching WordPress post IDs. When a slug changes:
1. The old Markdown file is deleted
2. A new file is written with the new slug
3. The URL map is updated
4. Run `generate_redirects` after sync to create redirect rules from old URL to new URL

### What about deleted posts?

`sync_delete` checks each locally exported post ID against WordPress. If WordPress returns 404, the local file is removed and the URL map entry is cleaned up. Use `sync_full` with `include_deleted: true` to handle this automatically.

### Does sync handle new categories or authors?

Yes. When a post is synced, its embedded category/tag/author data comes with it. The frontmatter is rebuilt from scratch, so any taxonomy or author changes are automatically reflected.

### Can I force a full re-sync?

Yes. Two options:
- `sync_pull` with `force: true` — re-fetches and re-converts every exported post
- `sync_reset` then `sync_pull` — clears timestamp tracking, then syncs everything

---

## Export & Performance

### How long does an export take?

Rough estimates (depends on server speed and rate limiting):

| Posts | Time |
|-------|------|
| 100 | ~1 minute |
| 500 | ~4 minutes |
| 1,000 | ~8 minutes |
| 5,000 | ~40 minutes |

Factors: API rate limit, post content size, server response time, page builder complexity.

### What happens if the export is interrupted?

Every post's state is tracked in SQLite:
- `pending` — Not yet processed
- `in_progress` — Currently being processed
- `completed` — Successfully written to disk
- `failed` — Error occurred (saved for retry)

Run `export_resume` to continue from where it stopped. No work is repeated.

### Can I run multiple exports simultaneously?

Each export creates a separate job in SQLite. You can export different sites simultaneously, but avoid running two exports for the same site at the same time (they'd conflict on file writes).

### How much disk space does it use?

Markdown files are much smaller than HTML. A typical post converts from ~20KB HTML to ~5KB Markdown. For 5,000 posts, expect ~25MB of content files plus the Astro project overhead (~50MB with node_modules).

---

## Deployment

### Which deploy platforms are supported?

| Platform | Config File | Generated By |
|----------|-------------|-------------|
| Vercel | `vercel.json` | `scaffold_project` or `github_deploy_config` |
| Netlify | `netlify.toml` | `scaffold_project` or `github_deploy_config` |
| Cloudflare Pages | `wrangler.toml` | `scaffold_project` or `github_deploy_config` |

### How do redirects work?

`generate_redirects` reads the URL map from SQLite (populated during export) and creates redirect rules:

| Format | File | Example |
|--------|------|---------|
| Netlify | `public/_redirects` | `/2024/03/my-post  /blog/my-post  301` |
| Vercel | `vercel.json` | `{ "source": "/2024/03/my-post", "destination": "/blog/my-post" }` |
| Apache | `public/.htaccess` | `RewriteRule ^/2024/03/my-post$ /blog/my-post [R=301,L]` |
| Nginx | `nginx-redirects.conf` | `rewrite ^/2024/03/my-post$ /blog/my-post permanent;` |

### Do I need a GitHub token?

Only if you want to use `github_create_repo` to create repositories from Claude Code. You can skip this and create the repo manually on GitHub, then just use `github_init`, `github_commit`, and `github_push`.

---

## Build & Deployment

### Build fails with "JavaScript heap out of memory"

This happens when TypeScript runs out of memory during compilation, especially on CI/CD platforms with limited resources (Cloudflare Pages ~4GB, Netlify ~3GB, GitHub Actions ~7GB).

**Error looks like:**
```
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

**Fixes by platform:**

| Platform | Fix |
|----------|-----|
| **Cloudflare Pages** | Set build command to `npm run build` (uses 4GB heap) or `npm run build:low-mem` for incremental builds |
| **Netlify** | Add env var `NODE_OPTIONS=--max-old-space-size=3072` in Site Settings → Build & Deploy → Environment |
| **Vercel** | Usually fine (8GB default). If failing, add `NODE_OPTIONS=--max-old-space-size=4096` in Project Settings → Environment Variables |
| **GitHub Actions** | Add `env: NODE_OPTIONS: --max-old-space-size=4096` to your build step |
| **Local machine** | Run `npm run build` — the 4GB heap flag is built into the script |

**If it still fails**, use `npm run build:low-mem` which enables incremental compilation. This caches type-check results between builds and uses significantly less memory on repeat runs.

**Nuclear option:** Pre-build locally and commit the `dist/` folder. Add `dist/` to your repo and change the deploy command to just `npm install && npm start` — skipping TypeScript compilation entirely on CI.

### Which deploy platforms are supported for the generated Astro site?

The scaffolded Astro project includes platform-specific config files:

| Platform | Config File | Generated By |
|----------|-------------|-------------|
| Vercel | `vercel.json` | `scaffold_project` or `github_deploy_config` |
| Netlify | `netlify.toml` | `scaffold_project` or `github_deploy_config` |
| Cloudflare Pages | `wrangler.toml` | `scaffold_project` or `github_deploy_config` |

Each platform gets the right adapter in `astro.config.mjs`, correct build output settings, and redirect rules in the platform's native format.

### How do I set up CI/CD for the generated Astro site?

After pushing to GitHub:

**Vercel:**
1. Import the repo at vercel.com/new
2. Framework preset: Astro
3. Build command: `npm run build` (auto-detected)
4. Deploy — done

**Netlify:**
1. Import the repo at app.netlify.com/start
2. Build command and publish dir are in `netlify.toml` — auto-detected
3. Deploy — done

**Cloudflare Pages:**
1. Go to dash.cloudflare.com → Pages → Create
2. Connect your GitHub repo
3. Framework preset: Astro
4. Build command: `npm run build`
5. Build output directory: `dist`
6. If build fails with OOM, add environment variable `NODE_OPTIONS=--max-old-space-size=3072`

### How do redirects work across platforms?

`generate_redirects` reads the URL map from SQLite (populated during export) and creates redirect rules in the right format:

| Format | File | Example |
|--------|------|---------|
| Netlify | `public/_redirects` | `/2024/03/my-post  /blog/my-post  301` |
| Vercel | `vercel.json` | `{ "source": "/2024/03/my-post", "destination": "/blog/my-post" }` |
| Cloudflare | `public/_redirects` | `/2024/03/my-post  /blog/my-post  301` |
| Apache | `public/.htaccess` | `RewriteRule ^/2024/03/my-post$ /blog/my-post [R=301,L]` |
| Nginx | `nginx-redirects.conf` | `rewrite ^/2024/03/my-post$ /blog/my-post permanent;` |

---

## Troubleshooting

### "REST API discovery failed"

Your WordPress REST API might be disabled. Check:
1. Visit `https://yoursite.com/wp-json/` in a browser — you should see JSON
2. Security plugins (Wordfence, iThemes, etc.) sometimes block REST API
3. Some hosts disable REST API for unauthenticated requests — this is fine, the server uses authentication

### "No post types detected"

The REST API user needs sufficient permissions. Ensure:
- The user has at least Editor role
- Custom post types have `show_in_rest` set to `true` in their registration

### "Shortcode X is not handled"

Run `shortcode_scan` to find all shortcodes. Then configure them:
```
shortcode_configure → shortcode: "my_shortcode", action: "keep_content"
```

### "Export is slow"

- Lower the rate limit: `site_export_config → rate_limit: 5`
- Check your WordPress server's performance
- Consider running during off-peak hours
- For very large sites, use `export_start` with specific post types to break the work into smaller jobs
