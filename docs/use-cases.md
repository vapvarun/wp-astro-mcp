# Use Cases

Real-world scenarios for using WP Astro MCP.

---

## 1. Simple Blog Migration

**Scenario:** A personal WordPress blog with ~200 posts, default theme, no page builder.

**Approach:**
```
site_add → site_analyze → site_export_config → scaffold_project → export_start → github_push
```

**What happens:**
- Posts become Markdown files in `src/content/blog/`
- Categories and tags are preserved in frontmatter
- Featured images keep their WordPress URLs
- A blog listing page and individual post pages are generated
- RSS feed is auto-configured

**Time estimate:** ~2 minutes for 200 posts.

---

## 2. Agency Multi-Site Migration

**Scenario:** An agency managing 12 WordPress sites. Each site has different plugins, themes, and content volumes. All need to move to Astro.

**Approach:**
```
# Register all sites
site_add (×12)

# Analyze each
site_analyze (for each site)

# Configure exports with per-site settings
site_export_config (different output dirs, media domains, deploy platforms)

# Export one at a time
export_start → export_resume (repeat for each site)
```

**Key benefits:**
- All sites managed from one MCP server
- Each site has its own config, credentials, and state
- Switch between sites by specifying `site_id`
- Set a default site for quick access

---

## 3. Elementor Site with Complex Layouts

**Scenario:** A business site built entirely with Elementor. 500 pages with sections, columns, widgets, contact forms, and custom CSS.

**Approach:**
```
site_add (auto-detects Elementor)
content_audit → reveals Elementor on 480/500 pages
shortcode_scan → finds contact-form-7, custom shortcodes
shortcode_configure → set up form placeholders
convert_preview → verify Elementor cleanup quality
scaffold_project
export_start → export_resume
```

**What the pipeline does with Elementor:**
1. Detects `_elementor_data` in post meta
2. Strips wrapper divs: `elementor-section`, `elementor-column`, `elementor-widget-container`
3. Preserves the actual content inside widgets
4. Contact Form 7 shortcodes become HTML comments with form ID
5. Result: clean semantic HTML → clean Markdown

**Manual follow-up:** Complex Elementor layouts (multi-column, custom CSS) may need design adjustment in Astro.

---

## 4. WooCommerce Product Catalog

**Scenario:** An e-commerce site with 2,000 products. Want to keep WooCommerce running for checkout but show products on an Astro frontend.

**Approach:**
```
site_add (auto-detects WooCommerce)
site_export_config → include only "product" post type
export_start
```

**Considerations:**
- Products are treated as a custom post type
- Product images, descriptions, and categories are exported
- WooCommerce-specific data (price, stock, variations) is in post meta — accessible via `customFields` in frontmatter
- You'll likely want a hybrid setup: Astro frontend + WooCommerce API for cart/checkout

---

## 5. Multilingual Site (WPML/Polylang)

**Scenario:** A site with content in English and Spanish using WPML.

**Approach:**
```
site_add (detects WPML or Polylang)
content_audit → see how translations are structured
export_start → exports all language versions
```

**How it works:**
- WPML and Polylang register language taxonomy terms
- Posts include language metadata in custom taxonomies
- The export preserves this in frontmatter under `taxonomies`
- In Astro, you can filter collections by language

---

## 6. Large Content Site (5,000+ Posts)

**Scenario:** A news/media site with 5,000 published posts, 500 drafts, and 50 custom post type entries.

**Approach:**
```
site_add
site_analyze → 5,550 total items, estimate ~46 minutes
site_export_config → rate_limit: 15, year_month_dirs: true, batch_size: 50

# Pre-cache for fast lookups
cache_terms
cache_authors

# Export with monitoring
export_plan → pre-flight checks pass
export_start → processes first 50 posts
export_resume → call ~110 times (or let Claude loop)
export_progress → check completion %
export_validate → verify everything
```

**Resilience features:**
- If your internet drops: `export_resume` picks up from the last pending post
- If some posts fail: `export_retry` reprocesses only failed posts
- Content hash tracking prevents duplicate work

---

## 7. Development → Go-Live Domain Swap

**Scenario:** WordPress currently runs on `myblog.com`. After migration, Astro will be on `myblog.com` and WordPress moves to `app.myblog.com`.

**Development phase:**
```
site_export_config → media_strategy: "keep"
# All media URLs stay as myblog.com — works during development
export_start
```

**Go-live:**
```
media_rewrite → old_domain: "myblog.com", new_domain: "app.myblog.com"
# Every media URL in every Markdown file is updated
generate_redirects → format: "vercel"
github_commit → "Go-live: swap media domain"
github_push
```

---

## 8. Selective Export with Date Filters

**Scenario:** Only migrate content from the last 2 years.

**Approach:**
```
site_export_config → date_after: "2024-01-01"
export_start
```

Or exclude specific categories:
```
site_export_config → exclude_categories: ["uncategorized", "internal"]
```

---

## 9. Content Audit Without Exporting

**Scenario:** You want to understand a site's content landscape before deciding on a migration strategy.

**Approach:**
```
site_add
site_analyze → content counts, capabilities
content_audit → shortcodes, builders, complexity
extract_settings → permalink structure, timezone
extract_menus → navigation structure
```

This gives you a comprehensive understanding without writing any files.

---

## 10. Dry Run Export

**Scenario:** You want to see what the export would produce without actually creating files.

**Approach:**
```
write_batch → dry_run: true
```

This runs the full conversion pipeline and reports output paths, sizes, and issues — without writing to disk.

---

## 11. Ongoing Content Sync (WordPress as CMS)

**Scenario:** WordPress is your content management system. Editors publish 3-5 posts per day, update old content regularly, and occasionally delete outdated pages. The Astro site must stay current.

**Initial export:**
```
export_plan → export_start → export_resume → export_validate
github_init → github_create_repo → github_push
```

**Daily sync (manual):**
```
sync_check → shows 4 new posts, 2 updated, 1 deleted
sync_full → fetches new posts, re-converts updated ones, removes deleted file
github_push → deploys to Vercel/Netlify
```

**Automated daily sync (GitHub Actions):**
```
sync_schedule → platform: "github-actions", interval: "daily"
# Creates .github/workflows/sync-content.yml
# Runs at 6am UTC, syncs changes, auto-commits and pushes
github_push → pushes the workflow file
```

**Real-time sync (webhooks):**
```
sync_schedule → platform: "vercel"  # or "netlify"
# Creates an API endpoint that WordPress calls on every post save
# Triggers a new build automatically
```

**What it handles:**
- New posts, pages, and custom post types → new Markdown files
- Updated content (text, images, SEO, ACF) → file overwritten
- Slug changes → old file deleted, new file created, URL map updated
- Deleted/trashed posts → local file removed
- Category/tag changes → frontmatter updated on next sync

---

## 12. Custom Post Type with ACF Fields

**Scenario:** A "Portfolio" CPT with ACF fields: project_url, client_name, gallery (repeater), testimonial (relationship).

**What the export produces:**

```yaml
---
title: "Brand Redesign Project"
slug: brand-redesign
date: 2024-06-15
postType: portfolio
acf:
  project_url: "https://client.com"
  client_name: "Acme Corp"
  gallery:
    - url: "https://example.com/wp-content/uploads/portfolio-1.jpg"
      alt: "Homepage design"
      width: 1920
      height: 1080
    - url: "https://example.com/wp-content/uploads/portfolio-2.jpg"
      alt: "Mobile view"
      width: 750
      height: 1334
  testimonial:
    wpId: 142
    slug: "john-smith"
    title: "John Smith - CEO, Acme Corp"
---
```

ACF fields are normalized: images become objects with dimensions, relationships become references with slug/ID, repeaters become arrays.
