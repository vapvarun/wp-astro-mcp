/**
 * Content Writer Service
 * Writes converted Markdown files to disk with proper directory structure.
 * Handles year/month organization, filename sanitization, and redirect generation.
 */

import fs from 'fs';
import path from 'path';
import sanitize from 'sanitize-filename';
import type { WPPost, SiteConfig, ConversionIssue } from '../types/index.js';
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
  /** Real per-post conversion issues from the transform pipeline. issueCount === issues.length. */
  issues: ConversionIssue[];
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

  const baseSlug = sanitize(post.slug || `post-${post.id}`).toLowerCase();

  // Resolve a collision-safe slug. Two different posts whose slugs sanitize +
  // lowercase to the same string (e.g. `Foo` vs `foo`, accented variants, or two
  // CPTs mapped to the same collection dir) would otherwise overwrite each
  // other's file — and clobber each other's URL mapping. We check the target
  // path: if a file already exists there and belongs to a DIFFERENT wpPostId
  // (or its owner can't be confirmed), the current post is the colliding
  // newcomer and gets a deterministic `-{id}` suffix. The post that owns the
  // clean slug keeps it; re-exporting the same post stays stable/idempotent.
  const baseFileName = `${baseSlug}.${format}`;
  const baseFullPath = path.join(outputDir, relDir, baseFileName);

  let safeSlug = baseSlug;
  if (!options.dryRun && isSlugTakenByDifferentPost(baseFullPath, post.id)) {
    safeSlug = `${baseSlug}-${post.id}`;
  }

  const fileName = `${safeSlug}.${format}`;
  const relPath = path.join(relDir, fileName);
  const fullPath = path.join(outputDir, relPath);

  // Build full markdown content
  const fullContent = serializeFrontmatter(result.frontmatter) + '\n' + result.body;

  if (!options.dryRun) {
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, fullContent, 'utf-8');

    // Register URL mapping for link rewriting — keyed off the disambiguated
    // slug so the file path and the registered Astro/URL path stay consistent.
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
    issues: result.issues,
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
        issues: [{
          severity: 'error',
          code: 'WRITE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        }],
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

// ============================================================
// JSON Data Mode — single file per collection for large sites
// ============================================================

export interface JsonPostEntry {
  id: number;
  title: string;
  slug: string;
  date: string;
  modified?: string;
  author?: { name: string; id: number; slug: string; avatar?: string };
  status: string;
  categories?: Array<{ name: string; slug: string }>;
  tags?: Array<{ name: string; slug: string }>;
  excerpt?: string;
  content: string;
  featuredImage?: { url: string; alt: string; width?: number; height?: number };
  seo?: { title?: string; description?: string; canonical?: string; ogImage?: string; noindex?: boolean };
  readingTime?: number;
  wordCount?: number;
  wpPostId: number;
  wpUrl: string;
  postType: string;
  acf?: Record<string, unknown>;
  taxonomies?: Record<string, Array<{ name: string; slug: string }>>;
}

// Module-level counter to guarantee unique temp/backup filenames even within
// the same millisecond / same process.
let atomicWriteCounter = 0;

/**
 * Atomically write `data` to `filePath`.
 *
 * Writes to a sibling temp file first, then renames it over the target. Rename
 * is atomic on the same filesystem, so any concurrent reader sees either the
 * old complete file or the new complete file — never a half-written truncation.
 */
function writeFileAtomic(filePath: string, data: string): void {
  const tmpPath = `${filePath}.tmp-${process.pid}-${atomicWriteCounter++}`;
  try {
    fs.writeFileSync(tmpPath, data, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e: unknown) {
    // Best-effort cleanup of the temp file if the rename failed.
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore cleanup failure */
    }
    throw e;
  }
}

/**
 * Read and parse an existing JSON collection file.
 *
 * On a parse failure we never silently discard the data: the corrupt file is
 * renamed to a `.corrupt-<ts>` sibling so the original bytes are preserved, and
 * an empty array is returned so the caller can proceed without overwriting the
 * live collection with `[]`.
 */
function readJsonCollection(jsonPath: string): JsonPostEntry[] {
  if (!fs.existsSync(jsonPath)) return [];
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  try {
    return JSON.parse(raw) as JsonPostEntry[];
  } catch (e: unknown) {
    const backupPath = `${jsonPath}.corrupt-${Date.now()}-${process.pid}-${atomicWriteCounter++}`;
    try {
      fs.renameSync(jsonPath, backupPath);
      logger.error(
        `Failed to parse JSON collection ${jsonPath}; backed up corrupt file to ${backupPath} to avoid data loss`,
        e instanceof Error ? e : undefined
      );
    } catch (backupErr: unknown) {
      // If even the backup rename fails, do NOT proceed — re-throw so the
      // caller aborts rather than overwriting the live file with an empty array.
      logger.error(
        `Failed to parse JSON collection ${jsonPath} and could not back it up; aborting to avoid data loss`,
        backupErr instanceof Error ? backupErr : undefined
      );
      throw e;
    }
    return [];
  }
}

/**
 * Write or update a JSON collection file for a post type.
 * Reads existing file, upserts the post entry, writes back.
 * This avoids Astro's markdown pipeline — critical for sites with 500+ posts.
 */
export function writePostToJson(
  post: WPPost,
  site: SiteConfig,
  outputDir: string,
  options: { dryRun?: boolean } = {}
): WriteResult {
  const result = convertPost(post, site);
  const collectionDir = getCollectionDirForType(post.type, site);
  const jsonDir = path.join(outputDir, 'src', 'data');
  const jsonFile = `${collectionDir}.json`;
  const jsonPath = path.join(jsonDir, jsonFile);
  const relPath = path.join('src', 'data', jsonFile);

  // Build JSON entry from frontmatter + body
  const entry: JsonPostEntry = {
    id: post.id,
    title: result.frontmatter.title,
    slug: result.frontmatter.slug,
    date: result.frontmatter.date,
    modified: result.frontmatter.modified,
    author: result.frontmatter.author,
    status: result.frontmatter.status,
    categories: result.frontmatter.categories,
    tags: result.frontmatter.tags,
    excerpt: result.frontmatter.excerpt,
    content: post.content?.rendered || '',
    featuredImage: result.frontmatter.featuredImage,
    seo: result.frontmatter.seo,
    readingTime: result.frontmatter.readingTime,
    wordCount: result.frontmatter.wordCount,
    wpPostId: result.frontmatter.wpPostId,
    wpUrl: result.frontmatter.wpUrl,
    postType: result.frontmatter.postType,
    acf: result.frontmatter.acf,
    taxonomies: result.frontmatter.taxonomies,
  };

  if (!options.dryRun) {
    fs.mkdirSync(jsonDir, { recursive: true });

    // Read existing JSON array (a parse failure backs up the corrupt file and
    // returns [] rather than silently destroying the live collection).
    const posts: JsonPostEntry[] = readJsonCollection(jsonPath);

    // Replace existing entry or append
    const existingIdx = posts.findIndex(p => p.wpPostId === post.id);
    if (existingIdx >= 0) {
      posts[existingIdx] = entry;
    } else {
      posts.push(entry);
    }

    // Sort by date descending
    posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    writeFileAtomic(jsonPath, JSON.stringify(posts, null, 2));

    // Register URL mapping
    const safeSlug = sanitize(post.slug || `post-${post.id}`).toLowerCase();
    const wpPath = new URL(post.link).pathname;
    const astroPath = `/${collectionDir}/${safeSlug}`;
    registerUrlMapping(site.id, wpPath, astroPath, post.type, post.id);
  }

  const safeSlug = sanitize(post.slug || `post-${post.id}`).toLowerCase();

  return {
    postId: post.id,
    title: result.frontmatter.title,
    slug: safeSlug,
    outputPath: relPath,
    inputSize: result.inputSize,
    outputSize: JSON.stringify(entry).length,
    conversionMs: result.conversionMs,
    issueCount: result.issues.length,
    issues: result.issues,
    written: !options.dryRun,
  };
}

/**
 * Remove a post from a JSON collection file
 */
export function removePostFromJson(
  wpPostId: number,
  postType: string,
  site: SiteConfig,
  outputDir: string,
): boolean {
  const collectionDir = getCollectionDirForType(postType, site);
  const jsonPath = path.join(outputDir, 'src', 'data', `${collectionDir}.json`);

  if (!fs.existsSync(jsonPath)) return false;

  // On parse failure readJsonCollection backs up the corrupt file and returns
  // []; we must NOT overwrite the live file with [] in that case, so bail out.
  let posts: JsonPostEntry[];
  try {
    posts = readJsonCollection(jsonPath);
  } catch {
    return false;
  }

  // The file existed but could not be parsed: it has already been moved to a
  // `.corrupt-*` backup, so there is nothing left to filter. Do not write [].
  if (!fs.existsSync(jsonPath)) return false;

  try {
    const filtered = posts.filter(p => p.wpPostId !== wpPostId);

    if (filtered.length === posts.length) return false; // Not found

    writeFileAtomic(jsonPath, JSON.stringify(filtered, null, 2));
    return true;
  } catch (_e: unknown) {
    return false;
  }
}

/**
 * Decide whether the Markdown file at `targetPath` is already owned by a
 * DIFFERENT WordPress post than `currentPostId`.
 *
 * Used to detect the slug-collision case in `writePost`, where two distinct
 * posts sanitize + lowercase to the same filename and would silently overwrite
 * each other. We read the existing file's frontmatter `wpPostId:` line:
 *
 *  - No file at the path      → not taken (false): the current post may write it.
 *  - File owned by same id     → not taken (false): a normal update/overwrite.
 *  - File owned by a different
 *    id, OR owner unconfirmable
 *    (unreadable / no `wpPostId`
 *    in the frontmatter)       → taken (true): caller must disambiguate. We treat
 *                                the unconfirmable case as a collision rather than
 *                                silently overwriting a file we don't own.
 *
 * The check is self-contained (no DB), reads only the first ~40 lines, and is
 * deterministic so re-running an export yields the same decision.
 */
function isSlugTakenByDifferentPost(targetPath: string, currentPostId: number): boolean {
  let existing: number | null;
  try {
    if (!fs.existsSync(targetPath)) return false;
    existing = readWpPostIdFromFile(targetPath);
  } catch {
    // Cannot even stat/read the path: be safe and treat as a collision so we
    // never clobber a file whose owner we can't confirm.
    return true;
  }

  // Owner could not be confirmed from the frontmatter → treat as collision.
  if (existing === null) return true;

  // Same post → normal overwrite (not a collision). Different post → collision.
  return existing !== currentPostId;
}

/**
 * Parse the frontmatter `wpPostId:` value from the first lines of a Markdown
 * file. Returns the numeric id, or null if it can't be confirmed (unreadable
 * file, no frontmatter, or no/!numeric `wpPostId`). Reads at most ~40 lines so
 * it stays cheap even on large files.
 */
function readWpPostIdFromFile(filePath: string): number | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const lines = raw.split('\n', 41);

  // A valid frontmatter block opens with `---` on the first line; if it doesn't,
  // we can't trust the file's ownership, so report "unconfirmed".
  if (lines.length === 0 || lines[0].trim() !== '---') return null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Closing fence ends the frontmatter block — stop before scanning the body.
    if (line.trim() === '---') break;
    // Top-level `wpPostId:` is emitted at indent 0 by serializeFrontmatter.
    const match = /^wpPostId:\s*(-?\d+)\s*$/.exec(line);
    if (match) {
      const id = Number(match[1]);
      return Number.isFinite(id) ? id : null;
    }
  }

  return null;
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
