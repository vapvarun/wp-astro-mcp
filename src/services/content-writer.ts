/**
 * Content Writer Service
 * Writes converted Markdown files to disk with proper directory structure.
 * Handles year/month organization, filename sanitization, and redirect generation.
 */

import fs from 'fs';
import path from 'path';
import sanitize from 'sanitize-filename';
import type { WPPost, SiteConfig } from '../types/index.js';
import { convertPost } from './html-to-markdown.js';
import { serializeFrontmatter } from './frontmatter-builder.js';
import { getCollectionDirForType } from './astro-scaffolder.js';
import { registerUrlMapping } from './link-rewriter.js';
import { database } from '../config/database.js';
import logger from '../utils/logger.js';

export interface WriteResult {
  postId: number;
  title: string;
  slug: string;
  outputPath: string;
  inputSize: number;
  outputSize: number;
  conversionMs: number;
  issueCount: number;
  written: boolean;
}

/**
 * Convert and write a single post to disk
 */
export function writePost(
  post: WPPost,
  site: SiteConfig,
  outputDir: string,
  options: {
    dryRun?: boolean;
    parentSlug?: string;
    fullPath?: string;
  } = {}
): WriteResult {
  const result = convertPost(post, site, {
    parentSlug: options.parentSlug,
    fullPath: options.fullPath,
  });

  const collectionDir = getCollectionDirForType(post.type, site);
  const useYearMonth = site.export?.year_month_dirs && !isHierarchical(post);
  const format = site.export?.content_format || 'md';

  // Build file path
  let relDir = path.join('src', 'content', collectionDir);
  if (useYearMonth && post.date) {
    const date = new Date(post.date);
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    relDir = path.join(relDir, year, month);
  }

  const safeSlug = sanitize(post.slug || `post-${post.id}`).toLowerCase();
  const fileName = `${safeSlug}.${format}`;
  const relPath = path.join(relDir, fileName);
  const fullPath = path.join(outputDir, relPath);

  // Build full markdown content
  const fullContent = serializeFrontmatter(result.frontmatter) + '\n' + result.body;

  if (!options.dryRun) {
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, fullContent, 'utf-8');

    // Register URL mapping for link rewriting
    const wpPath = new URL(post.link).pathname;
    const astroPath = `/${collectionDir}/${safeSlug}`;
    registerUrlMapping(site.id, wpPath, astroPath, post.type, post.id);
  }

  return {
    postId: post.id,
    title: result.frontmatter.title,
    slug: safeSlug,
    outputPath: relPath,
    inputSize: result.inputSize,
    outputSize: result.outputSize,
    conversionMs: result.conversionMs,
    issueCount: result.issues.length,
    written: !options.dryRun,
  };
}

/**
 * Write multiple posts to disk
 */
export function writeBatch(
  posts: WPPost[],
  site: SiteConfig,
  outputDir: string,
  options: {
    dryRun?: boolean;
  } = {}
): {
  results: WriteResult[];
  summary: {
    total: number;
    written: number;
    failed: number;
    totalInputSize: number;
    totalOutputSize: number;
    totalConversionMs: number;
    totalIssues: number;
  };
} {
  const results: WriteResult[] = [];
  let failed = 0;

  for (const post of posts) {
    try {
      const result = writePost(post, site, outputDir, { dryRun: options.dryRun });
      results.push(result);
    } catch (error) {
      failed++;
      logger.error('Failed to write post', {
        postId: post.id,
        error: error instanceof Error ? error.message : String(error),
      });
      results.push({
        postId: post.id,
        title: post.title?.rendered || 'Unknown',
        slug: post.slug || '',
        outputPath: '',
        inputSize: 0,
        outputSize: 0,
        conversionMs: 0,
        issueCount: 1,
        written: false,
      });
    }
  }

  return {
    results,
    summary: {
      total: posts.length,
      written: results.filter((r) => r.written).length,
      failed,
      totalInputSize: results.reduce((s, r) => s + r.inputSize, 0),
      totalOutputSize: results.reduce((s, r) => s + r.outputSize, 0),
      totalConversionMs: results.reduce((s, r) => s + r.conversionMs, 0),
      totalIssues: results.reduce((s, r) => s + r.issueCount, 0),
    },
  };
}

/**
 * Generate redirects file from URL map
 */
export function generateRedirects(
  siteId: string,
  outputDir: string,
  format: 'netlify' | 'vercel' | 'cloudflare' | 'apache' | 'nginx' = 'netlify'
): { filePath: string; redirectCount: number } {
  const db = database.getDatabase();
  const rows = db.prepare(
    'SELECT wp_url, astro_url FROM url_map WHERE site_id = ? ORDER BY wp_url'
  ).all(siteId) as Array<{ wp_url: string; astro_url: string }>;

  if (rows.length === 0) {
    return { filePath: '', redirectCount: 0 };
  }

  let content = '';
  let filePath = '';

  switch (format) {
    case 'netlify':
      content = rows.map((r) => `${r.wp_url}  ${r.astro_url}  301`).join('\n') + '\n';
      filePath = path.join(outputDir, 'public', '_redirects');
      break;

    case 'vercel': {
      const vercelRedirects = rows.map((r) => ({
        source: r.wp_url,
        destination: r.astro_url,
        permanent: true,
      }));
      // Read existing vercel.json and merge
      const vercelPath = path.join(outputDir, 'vercel.json');
      let vercelConfig: Record<string, unknown> = {};
      if (fs.existsSync(vercelPath)) {
        vercelConfig = JSON.parse(fs.readFileSync(vercelPath, 'utf-8'));
      }
      vercelConfig.redirects = vercelRedirects;
      content = JSON.stringify(vercelConfig, null, 2);
      filePath = vercelPath;
      break;
    }

    case 'cloudflare':
      content = rows.map((r) => `${r.wp_url} ${r.astro_url} 301`).join('\n') + '\n';
      filePath = path.join(outputDir, 'public', '_redirects');
      break;

    case 'apache':
      content = 'RewriteEngine On\n' +
        rows.map((r) => `RewriteRule ^${escapeApachePath(r.wp_url)}$ ${r.astro_url} [R=301,L]`).join('\n') + '\n';
      filePath = path.join(outputDir, 'public', '.htaccess');
      break;

    case 'nginx':
      content = rows.map((r) => `rewrite ^${r.wp_url}$ ${r.astro_url} permanent;`).join('\n') + '\n';
      filePath = path.join(outputDir, 'nginx-redirects.conf');
      break;
  }

  if (filePath && content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  return { filePath: path.relative(outputDir, filePath), redirectCount: rows.length };
}

/**
 * Audit media URLs in exported content
 */
export function auditMedia(
  outputDir: string,
  _siteUrl: string
): {
  totalFiles: number;
  totalMediaRefs: number;
  domains: Record<string, number>;
  brokenRefs: string[];
  sampleUrls: string[];
} {
  const contentDir = path.join(outputDir, 'src', 'content');
  if (!fs.existsSync(contentDir)) {
    return { totalFiles: 0, totalMediaRefs: 0, domains: {}, brokenRefs: [], sampleUrls: [] };
  }

  const mediaRegex = /(?:!\[[^\]]*\]\(|src=["'])(https?:\/\/[^)"'\s]+)/g;
  const domains: Record<string, number> = {};
  const brokenRefs: string[] = [];
  const sampleUrls: string[] = [];
  let totalFiles = 0;
  let totalMediaRefs = 0;

  walkFiles(contentDir, (filePath) => {
    if (!filePath.endsWith('.md') && !filePath.endsWith('.mdx')) return;
    totalFiles++;

    const content = fs.readFileSync(filePath, 'utf-8');
    let match: RegExpExecArray | null;
    const regex = new RegExp(mediaRegex.source, 'g');

    while ((match = regex.exec(content)) !== null) {
      const url = match[1];
      totalMediaRefs++;

      try {
        const domain = new URL(url).hostname;
        domains[domain] = (domains[domain] || 0) + 1;
      } catch (_e: unknown) {
        brokenRefs.push(url);
      }

      if (sampleUrls.length < 10) sampleUrls.push(url);
    }
  });

  return { totalFiles, totalMediaRefs, domains, brokenRefs, sampleUrls };
}

/**
 * Rewrite media domains in all exported content files
 */
export function rewriteMediaInFiles(
  outputDir: string,
  oldDomain: string,
  newDomain: string
): { filesModified: number; replacements: number } {
  const contentDir = path.join(outputDir, 'src', 'content');
  if (!fs.existsSync(contentDir)) {
    return { filesModified: 0, replacements: 0 };
  }

  const escapedOld = oldDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(https?://)${escapedOld}`, 'g');
  let filesModified = 0;
  let totalReplacements = 0;

  walkFiles(contentDir, (filePath) => {
    if (!filePath.endsWith('.md') && !filePath.endsWith('.mdx')) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    const matches = content.match(regex);
    if (!matches) return;

    const newContent = content.replace(regex, `$1${newDomain}`);
    fs.writeFileSync(filePath, newContent, 'utf-8');
    filesModified++;
    totalReplacements += matches.length;
  });

  return { filesModified, replacements: totalReplacements };
}

function isHierarchical(post: WPPost): boolean {
  return post.type === 'page' || !!post.parent;
}

function escapeApachePath(p: string): string {
  return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walkFiles(dir: string, callback: (filePath: string) => void): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, callback);
    } else {
      callback(fullPath);
    }
  }
}
