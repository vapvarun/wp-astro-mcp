/**
 * Content Analyzer Service
 * Inspects WordPress content to detect shortcodes, page builders,
 * Gutenberg blocks, embeds, and other patterns that need special handling.
 */

import type { WPPost } from '../types/index.js';

export interface ContentAnalysis {
  shortcodes: ShortcodeInfo[];
  gutenbergBlocks: BlockInfo[];
  pageBuilder: PageBuilderInfo | null;
  embeds: EmbedInfo[];
  internalLinks: string[];
  mediaUrls: string[];
  hasGallery: boolean;
  hasTables: boolean;
  hasCodeBlocks: boolean;
  hasForms: boolean;
  hasIframes: boolean;
  wordCount: number;
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
}

export interface ShortcodeInfo {
  tag: string;
  count: number;
  sample: string;
}

export interface BlockInfo {
  name: string;
  count: number;
}

export interface PageBuilderInfo {
  type: 'elementor' | 'wpbakery' | 'divi' | 'beaver' | 'bricks' | 'oxygen';
  elementCount: number;
}

export interface EmbedInfo {
  type: string;
  url: string;
}

const SHORTCODE_REGEX = /\[([a-zA-Z_][a-zA-Z0-9_-]*)(?:\s[^\]]*?)?\](?:[\s\S]*?\[\/\1\])?/g;
const GUTENBERG_BLOCK_REGEX = /<!-- wp:([a-z][a-z0-9-]*\/)?([a-z][a-z0-9-]*)\s*(\{[^}]*\})?\s*\/?-->/g;
const INTERNAL_LINK_REGEX = /href=["'](?:https?:\/\/[^"']*?)?(\/[^"']*?)["']/g;
const MEDIA_URL_REGEX = /(?:src|href)=["'](https?:\/\/[^"']*?\.(?:jpg|jpeg|png|gif|webp|svg|mp4|mp3|pdf|doc|docx|zip))["']/gi;
const EMBED_REGEX = /(?:src|href)=["'](https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com|twitter\.com|x\.com|instagram\.com|soundcloud\.com|spotify\.com|codepen\.io)[^"']*)["']/gi;
const IFRAME_REGEX = /<iframe[^>]*>/gi;

/**
 * Detect page builder from content patterns
 */
function detectPageBuilder(content: string, meta?: Record<string, unknown>): PageBuilderInfo | null {
  // Elementor — check meta first, then content
  if (meta?.['_elementor_data'] || meta?.['_elementor_edit_mode'] === 'builder') {
    const elementorData = meta['_elementor_data'];
    let elementCount = 0;
    if (typeof elementorData === 'string') {
      try {
        const parsed = JSON.parse(elementorData);
        elementCount = Array.isArray(parsed) ? countElements(parsed) : 0;
      } catch {
        elementCount = (elementorData.match(/"elType"/g) || []).length;
      }
    }
    return { type: 'elementor', elementCount };
  }

  // WPBakery — [vc_row], [vc_column], etc.
  if (/\[vc_row\]/.test(content) || /\[vc_column\b/.test(content)) {
    const vcCount = (content.match(/\[vc_/g) || []).length;
    return { type: 'wpbakery', elementCount: vcCount };
  }

  // Divi — et_pb_ classes
  if (/class="[^"]*et_pb_/.test(content) || /\[et_pb_/.test(content)) {
    const diviCount = (content.match(/et_pb_/g) || []).length;
    return { type: 'divi', elementCount: diviCount };
  }

  // Beaver Builder
  if (/class="[^"]*fl-/.test(content) || meta?.['_fl_builder_data']) {
    return { type: 'beaver', elementCount: (content.match(/fl-/g) || []).length };
  }

  // Bricks
  if (meta?.['_bricks_page_content_2']) {
    return { type: 'bricks', elementCount: 0 };
  }

  // Oxygen
  if (meta?.['ct_builder_shortcodes']) {
    return { type: 'oxygen', elementCount: 0 };
  }

  return null;
}

function countElements(elements: unknown[]): number {
  let count = 0;
  for (const el of elements) {
    count++;
    if (el && typeof el === 'object' && 'elements' in el) {
      const child = (el as { elements?: unknown[] }).elements;
      if (Array.isArray(child)) {
        count += countElements(child);
      }
    }
  }
  return count;
}

/**
 * Analyze a single post's content for migration complexity
 */
export function analyzeContent(post: WPPost): ContentAnalysis {
  const content = post.content?.rendered || post.content?.raw || '';

  // Shortcodes
  const shortcodeMap = new Map<string, { count: number; sample: string }>();
  let match: RegExpExecArray | null;
  const shortcodeRegex = new RegExp(SHORTCODE_REGEX.source, 'g');
  while ((match = shortcodeRegex.exec(content)) !== null) {
    const tag = match[1];
    const existing = shortcodeMap.get(tag);
    if (existing) {
      existing.count++;
    } else {
      shortcodeMap.set(tag, { count: 1, sample: match[0].substring(0, 120) });
    }
  }
  const shortcodes = Array.from(shortcodeMap.entries()).map(([tag, info]) => ({
    tag,
    count: info.count,
    sample: info.sample,
  }));

  // Gutenberg blocks
  const blockMap = new Map<string, number>();
  const blockRegex = new RegExp(GUTENBERG_BLOCK_REGEX.source, 'g');
  while ((match = blockRegex.exec(content)) !== null) {
    const blockName = (match[1] ? match[1] : 'core/') + match[2];
    blockMap.set(blockName, (blockMap.get(blockName) || 0) + 1);
  }
  const gutenbergBlocks = Array.from(blockMap.entries()).map(([name, count]) => ({
    name,
    count,
  }));

  // Page builder detection
  const pageBuilder = detectPageBuilder(content, post.meta);

  // Embeds
  const embedSet = new Map<string, string>();
  const embedRegex = new RegExp(EMBED_REGEX.source, 'gi');
  while ((match = embedRegex.exec(content)) !== null) {
    const url = match[1];
    const type = url.includes('youtube') || url.includes('youtu.be')
      ? 'youtube'
      : url.includes('vimeo')
        ? 'vimeo'
        : url.includes('twitter') || url.includes('x.com')
          ? 'twitter'
          : url.includes('instagram')
            ? 'instagram'
            : 'other';
    embedSet.set(url, type);
  }
  const embeds = Array.from(embedSet.entries()).map(([url, type]) => ({ type, url }));

  // Internal links
  const internalLinks: string[] = [];
  const linkRegex = new RegExp(INTERNAL_LINK_REGEX.source, 'g');
  while ((match = linkRegex.exec(content)) !== null) {
    if (match[1] && !match[1].startsWith('/wp-') && !match[1].startsWith('/feed')) {
      internalLinks.push(match[1]);
    }
  }

  // Media URLs
  const mediaUrls: string[] = [];
  const mediaRegex = new RegExp(MEDIA_URL_REGEX.source, 'gi');
  while ((match = mediaRegex.exec(content)) !== null) {
    mediaUrls.push(match[1]);
  }

  // Feature detection
  const hasGallery = /class="[^"]*gallery|wp:gallery|\[gallery/.test(content);
  const hasTables = /<table[\s>]|wp:table/.test(content);
  const hasCodeBlocks = /<code[\s>]|<pre[\s>]|wp:code/.test(content);
  const hasForms = /\[(?:contact-form|gravity|wpforms|formidable|ninja)/i.test(content) || /wp:(?:jetpack\/)?contact-form/.test(content);
  const hasIframes = IFRAME_REGEX.test(content);

  // Word count
  const textContent = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = textContent ? textContent.split(' ').length : 0;

  // Complexity assessment
  let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
  if (pageBuilder || shortcodes.length > 5 || hasIframes) {
    complexity = 'complex';
  } else if (shortcodes.length > 0 || embeds.length > 2 || hasGallery || hasTables) {
    complexity = 'moderate';
  }

  return {
    shortcodes,
    gutenbergBlocks,
    pageBuilder,
    embeds,
    internalLinks,
    mediaUrls,
    hasGallery,
    hasTables,
    hasCodeBlocks,
    hasForms,
    hasIframes,
    wordCount,
    estimatedComplexity: complexity,
  };
}

/**
 * Aggregate analysis across multiple posts
 */
export function aggregateAnalysis(analyses: ContentAnalysis[]): {
  totalPosts: number;
  complexityBreakdown: Record<string, number>;
  allShortcodes: Array<{ tag: string; totalCount: number; postsUsing: number }>;
  allBlocks: Array<{ name: string; totalCount: number; postsUsing: number }>;
  pageBuilders: Record<string, number>;
  embedTypes: Record<string, number>;
  featureUsage: Record<string, number>;
  totalMediaUrls: number;
  totalInternalLinks: number;
  avgWordCount: number;
} {
  const shortcodeAgg = new Map<string, { totalCount: number; postsUsing: number }>();
  const blockAgg = new Map<string, { totalCount: number; postsUsing: number }>();
  const pageBuilders: Record<string, number> = {};
  const embedTypes: Record<string, number> = {};
  const complexity: Record<string, number> = { simple: 0, moderate: 0, complex: 0 };
  const features: Record<string, number> = {
    gallery: 0, tables: 0, codeBlocks: 0, forms: 0, iframes: 0,
  };
  let totalMedia = 0;
  let totalLinks = 0;
  let totalWords = 0;

  for (const a of analyses) {
    complexity[a.estimatedComplexity]++;
    totalMedia += a.mediaUrls.length;
    totalLinks += a.internalLinks.length;
    totalWords += a.wordCount;

    if (a.hasGallery) features.gallery++;
    if (a.hasTables) features.tables++;
    if (a.hasCodeBlocks) features.codeBlocks++;
    if (a.hasForms) features.forms++;
    if (a.hasIframes) features.iframes++;

    if (a.pageBuilder) {
      pageBuilders[a.pageBuilder.type] = (pageBuilders[a.pageBuilder.type] || 0) + 1;
    }

    for (const sc of a.shortcodes) {
      const existing = shortcodeAgg.get(sc.tag);
      if (existing) {
        existing.totalCount += sc.count;
        existing.postsUsing++;
      } else {
        shortcodeAgg.set(sc.tag, { totalCount: sc.count, postsUsing: 1 });
      }
    }

    for (const block of a.gutenbergBlocks) {
      const existing = blockAgg.get(block.name);
      if (existing) {
        existing.totalCount += block.count;
        existing.postsUsing++;
      } else {
        blockAgg.set(block.name, { totalCount: block.count, postsUsing: 1 });
      }
    }

    for (const embed of a.embeds) {
      embedTypes[embed.type] = (embedTypes[embed.type] || 0) + 1;
    }
  }

  return {
    totalPosts: analyses.length,
    complexityBreakdown: complexity,
    allShortcodes: Array.from(shortcodeAgg.entries())
      .map(([tag, info]) => ({ tag, ...info }))
      .sort((a, b) => b.totalCount - a.totalCount),
    allBlocks: Array.from(blockAgg.entries())
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => b.totalCount - a.totalCount),
    pageBuilders,
    embedTypes,
    featureUsage: features,
    totalMediaUrls: totalMedia,
    totalInternalLinks: totalLinks,
    avgWordCount: analyses.length > 0 ? Math.round(totalWords / analyses.length) : 0,
  };
}
