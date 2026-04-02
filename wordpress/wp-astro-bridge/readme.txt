=== WP Astro Bridge ===
Contributors: vapvarun
Tags: headless, astro, webhook, preview, rest-api
Requires at least: 5.6
Tested up to: 6.8
Stable tag: 1.0.0
Requires PHP: 7.4
License: MIT
License URI: https://opensource.org/licenses/MIT

Lightweight bridge between WordPress and your Astro frontend. Webhooks, preview URL rewriting, and normalized SEO via REST API.

== Description ==

WP Astro Bridge connects your WordPress backend to an Astro frontend with three core features:

**Webhook Dispatcher** -- Automatically fires a signed HTTP POST to your configured endpoint whenever a post is published, updated, trashed, or unpublished. Payloads are HMAC-SHA256 signed and debounced to prevent duplicate fires from autosave.

**Preview URL Rewriter** -- Replaces the WordPress "Preview" button URL so editors land on the Astro frontend instead of wp-admin. Uses short-lived (5-minute) HMAC tokens for secure, stateless authentication.

**Normalized SEO REST Field** -- Adds an `astro_seo` field to all public post type REST responses. Works with Yoast SEO, Rank Math, and AIOSEO. Falls back to post title, permalink, and featured image when no SEO plugin is active.

Additionally, the plugin provides:

* A health check endpoint at `/wp-json/astro-bridge/v1/health`
* A token verification endpoint at `/wp-json/astro-bridge/v1/verify-token` that returns full post data (including drafts) for authenticated preview requests

Zero JavaScript. Zero Composer dependencies. One settings page.

== Installation ==

1. Upload the `wp-astro-bridge` folder to `/wp-content/plugins/`
2. Activate the plugin through the "Plugins" menu in WordPress
3. Go to Settings > Astro Bridge
4. Enter your Astro frontend URL and (optionally) a webhook URL
5. The webhook secret is auto-generated on activation -- copy it to your MCP server or Astro config

Alternatively, install via the WordPress plugin installer by uploading the zip file.

== Frequently Asked Questions ==

= What does this plugin do? =

It bridges your WordPress CMS with an Astro frontend by:
1. Notifying your Astro site when content changes (via webhooks)
2. Redirecting the WordPress Preview button to your Astro frontend
3. Providing normalized SEO metadata through the REST API

= Is it secure? =

Yes. Webhooks are signed with HMAC-SHA256 using an auto-generated secret. Preview tokens are cryptographically signed with your WordPress auth salt and expire after 5 minutes. No sensitive data is exposed through public endpoints.

= Which SEO plugins are supported? =

Yoast SEO, Rank Math, and All in One SEO (AIOSEO). The plugin reads metadata from whichever is active and normalizes it into a consistent format. If no SEO plugin is installed, it falls back to the post title, permalink, and featured image.

= Does it work with custom post types? =

Yes. All features (webhooks, preview rewriting, SEO field) apply to every public post type registered in WordPress, including custom ones.

== Changelog ==

= 1.0.0 =
* Initial release
* Webhook dispatcher with HMAC-SHA256 signing and 2-second debounce
* Preview URL rewriter with 5-minute HMAC token expiry
* Normalized astro_seo REST field (Yoast, RankMath, AIOSEO)
* Health check endpoint
* Token verification endpoint with full post data response
* Settings page (enable/disable, Astro URL, webhook URL, webhook secret)
