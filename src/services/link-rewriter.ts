/**
 * Link Rewriter Service
 * Rewrites WordPress internal URLs to Astro-friendly paths.
 * Handles media URL domain swapping for the rewrite strategy.
 */

import { database } from '../config/database.js';
import type { SiteConfig } from '../types/index.js';

/**
 * Rewrite internal content links from WordPress URLs to Astro paths
 */
export function rewriteContentLinks(
  content: string,
  site: SiteConfig
): { content: string; rewrittenCount: number } {
  const siteUrl = site.url.replace(/\/+$/, '');
  const escapedUrl = escapeRegex(siteUrl);
  let rewrittenCount = 0;

  // Build URL map from database for known posts
  const urlMap = getUrlMap(site.id);

  // 1. Rewrite known internal links using the URL map
  let result = content;
  for (const [wpPath, astroPath] of urlMap) {
    const wpUrl = siteUrl + wpPath;
    const escaped = escapeRegex(wpUrl);
    const regex = new RegExp(`(href=["'])${escaped}(["'])`, 'g');
    const before = result;
    result = result.replace(regex, `$1${astroPath}$2`);
    if (result !== before) rewrittenCount++;
  }

  // 2. Rewrite remaining internal links (strip site URL, keep path)
  const internalLinkRegex = new RegExp(
    `(href=["'])${escapedUrl}(/[^"']*?)(["'])`,
    'g'
  );
  result = result.replace(internalLinkRegex, (_match, prefix, path, suffix) => {
    rewrittenCount++;
    // Clean up WordPress-specific path patterns
    let cleanPath = path
      .replace(/\/\d{4}\/\d{2}\/\d{2}\//, '/') // Remove date-based permalink prefix
      .replace(/\/$/, '') // Remove trailing slash
      .replace(/\/feed\/?$/, '') // Remove feed suffix
      || '/';
    return `${prefix}${cleanPath}${suffix}`;
  });

  // 3. Rewrite media URLs based on strategy
  result = rewriteMediaUrls(result, site);

  return { content: result, rewrittenCount };
}

/**
 * Rewrite media URLs based on site export config
 */
export function rewriteMediaUrls(content: string, site: SiteConfig): string {
  const strategy = site.export?.media_strategy || 'keep';
  const siteUrl = site.url.replace(/\/+$/, '');

  if (strategy === 'keep') return content;

  if (strategy === 'rewrite' && site.export?.media_domain) {
    // Swap domain: example.com → app.example.com
    const mediaDomain = site.export.media_domain.replace(/\/+$/, '');
    const oldDomain = new URL(siteUrl).hostname;
    const newDomain = mediaDomain.includes('://') ? new URL(mediaDomain).hostname : mediaDomain;
    const newProtocol = mediaDomain.includes('://') ? mediaDomain.split('://')[0] : 'https';

    // Replace media URLs (images, videos, documents)
    const mediaExtensions = 'jpg|jpeg|png|gif|webp|svg|mp4|mp3|wav|ogg|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar';
    const mediaRegex = new RegExp(
      `((?:src|href|srcset|data-src|poster)=["'])https?://${escapeRegex(oldDomain)}(/wp-content/uploads/[^"'\\s,]*.(?:${mediaExtensions}))`,
      'gi'
    );
    content = content.replace(mediaRegex, `$1${newProtocol}://${newDomain}$2`);

    // Also handle srcset values (comma-separated)
    const srcsetRegex = new RegExp(
      `https?://${escapeRegex(oldDomain)}(/wp-content/uploads/[^\\s,]*.(?:${mediaExtensions}))`,
      'gi'
    );
    content = content.replace(srcsetRegex, `${newProtocol}://${newDomain}$1`);
  }

  return content;
}

/**
 * Get URL map from database
 */
function getUrlMap(siteId: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const db = database.getDatabase();
    const rows = db.prepare(
      'SELECT wp_url, astro_url FROM url_map WHERE site_id = ?'
    ).all(siteId) as Array<{ wp_url: string; astro_url: string }>;

    for (const row of rows) {
      map.set(row.wp_url, row.astro_url);
    }
  } catch (_e: unknown) {
    // Database may not be initialized
  }
  return map;
}

/**
 * Register a URL mapping (WordPress path → Astro path)
 */
export function registerUrlMapping(
  siteId: string,
  wpUrl: string,
  astroUrl: string,
  postType?: string,
  wpPostId?: number
): void {
  const db = database.getDatabase();
  db.prepare(
    `INSERT OR REPLACE INTO url_map (site_id, wp_url, astro_url, post_type, wp_post_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(siteId, wpUrl, astroUrl, postType || null, wpPostId || null);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
