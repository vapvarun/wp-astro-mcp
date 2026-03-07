/**
 * WordPress Shortcode Resolver
 * Parses, strips, or converts WordPress shortcodes to HTML/Markdown equivalents.
 * Supports per-site shortcode configuration via the shortcode_map table.
 */

import { database } from '../config/database.js';
import logger from '../utils/logger.js';

export interface ShortcodeMatch {
  full: string;
  tag: string;
  attrs: Record<string, string>;
  content: string;
  selfClosing: boolean;
  index: number;
}

export type ShortcodeAction = 'strip' | 'keep_content' | 'remove' | 'component' | 'html';

export interface ShortcodeRule {
  action: ShortcodeAction;
  component?: string;
  config?: Record<string, unknown>;
}

// Match WordPress shortcodes: [tag attr="val"]content[/tag] or [tag /]
const SHORTCODE_REGEX = /\[([a-zA-Z_][a-zA-Z0-9_-]*)(\s[^\]]*)?\]([\s\S]*?)\[\/\1\]|\[([a-zA-Z_][a-zA-Z0-9_-]*)(\s[^\]]*)?\s*\/?\]/g;

// Parse attributes: key="value" or key='value' or key=value or just key
const ATTR_REGEX = /([a-zA-Z_][a-zA-Z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;

/**
 * Parse shortcode attributes string into key-value pairs
 */
function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!attrString) return attrs;

  let match: RegExpExecArray | null;
  const regex = new RegExp(ATTR_REGEX.source, 'g');
  while ((match = regex.exec(attrString.trim())) !== null) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? 'true';
    attrs[key] = value;
  }
  return attrs;
}

/**
 * Find all shortcodes in content
 */
export function findShortcodes(content: string): ShortcodeMatch[] {
  const matches: ShortcodeMatch[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(SHORTCODE_REGEX.source, 'g');

  while ((match = regex.exec(content)) !== null) {
    if (match[1]) {
      // Enclosing shortcode: [tag]content[/tag]
      matches.push({
        full: match[0],
        tag: match[1],
        attrs: parseAttributes(match[2] || ''),
        content: match[3] || '',
        selfClosing: false,
        index: match.index,
      });
    } else if (match[4]) {
      // Self-closing shortcode: [tag /] or [tag]
      matches.push({
        full: match[0],
        tag: match[4],
        attrs: parseAttributes(match[5] || ''),
        content: '',
        selfClosing: true,
        index: match.index,
      });
    }
  }

  return matches;
}

/**
 * Get shortcode rules from database for a site
 */
function getSiteRules(siteId: string): Map<string, ShortcodeRule> {
  const rules = new Map<string, ShortcodeRule>();
  try {
    const db = database.getDatabase();
    const rows = db.prepare(
      'SELECT shortcode, action, component, config FROM shortcode_map WHERE site_id = ?'
    ).all(siteId) as Array<{ shortcode: string; action: string; component: string | null; config: string | null }>;

    for (const row of rows) {
      rules.set(row.shortcode, {
        action: row.action as ShortcodeAction,
        component: row.component || undefined,
        config: row.config ? JSON.parse(row.config) : undefined,
      });
    }
  } catch {
    // Database may not be initialized yet
  }
  return rules;
}

/**
 * Built-in shortcode handlers for common WordPress shortcodes
 */
const BUILTIN_HANDLERS: Record<string, (sc: ShortcodeMatch) => string> = {
  // WordPress core
  caption: (sc) => {
    const alt = sc.attrs.caption || '';
    // Extract img tag from content, wrap in figure
    if (sc.content.includes('<img')) {
      return `<figure>${sc.content}<figcaption>${alt}</figcaption></figure>`;
    }
    return sc.content;
  },

  gallery: (sc) => {
    const ids = sc.attrs.ids || '';
    if (!ids) return '<!-- gallery: no IDs specified -->';
    return `<!-- wp:gallery ids="${ids}" -->`;
  },

  audio: (sc) => {
    const src = sc.attrs.src || sc.attrs.mp3 || '';
    return src ? `<audio controls src="${src}"></audio>` : '';
  },

  video: (sc) => {
    const src = sc.attrs.src || sc.attrs.mp4 || '';
    const width = sc.attrs.width || '640';
    const height = sc.attrs.height || '360';
    return src ? `<video controls width="${width}" height="${height}" src="${src}"></video>` : '';
  },

  embed: (sc) => sc.content || '',

  // Common plugin shortcodes — strip wrapper, keep content
  vc_row: (sc) => sc.content,
  vc_column: (sc) => sc.content,
  vc_column_text: (sc) => sc.content,
  vc_section: (sc) => sc.content,
  vc_single_image: (sc) => {
    const src = sc.attrs.image || '';
    return src ? `<img src="${src}" alt="" />` : '';
  },

  // Divi
  et_pb_section: (sc) => sc.content,
  et_pb_row: (sc) => sc.content,
  et_pb_column: (sc) => sc.content,
  et_pb_text: (sc) => sc.content,

  // Contact Form 7
  'contact-form-7': (sc) => {
    const title = sc.attrs.title || 'Contact Form';
    return `<!-- Contact Form: ${title} (CF7 id=${sc.attrs.id || 'unknown'}) -->`;
  },

  // WPForms
  wpforms: (sc) => {
    return `<!-- WPForms (id=${sc.attrs.id || 'unknown'}) -->`;
  },

  // Gravity Forms
  gravityform: (sc) => {
    const title = sc.attrs.title === 'true' ? `title="${sc.attrs.title}"` : '';
    return `<!-- Gravity Form (id=${sc.attrs.id || 'unknown'}) ${title} -->`;
  },

  // Columns / layout
  columns: (sc) => `<div class="columns">${sc.content}</div>`,
  column: (sc) => `<div class="column">${sc.content}</div>`,

  // Accordion / tabs
  accordion: (sc) => `<details><summary>Accordion</summary>${sc.content}</details>`,
  tab: (sc) => `<div class="tab" data-title="${sc.attrs.title || ''}">${sc.content}</div>`,
  tabs: (sc) => `<div class="tabs">${sc.content}</div>`,

  // Button
  button: (sc) => {
    const url = sc.attrs.url || sc.attrs.link || '#';
    const text = sc.content || sc.attrs.text || 'Click here';
    return `<a href="${url}" class="button">${text}</a>`;
  },
};

/**
 * Resolve all shortcodes in content
 */
export function resolveShortcodes(content: string, siteId?: string): {
  content: string;
  resolved: Array<{ tag: string; action: string }>;
  unresolved: string[];
} {
  const siteRules = siteId ? getSiteRules(siteId) : new Map<string, ShortcodeRule>();
  const resolved: Array<{ tag: string; action: string }> = [];
  const unresolved: string[] = [];

  // Process shortcodes from innermost to outermost (multiple passes)
  let result = content;
  let changed = true;
  let passes = 0;
  const maxPasses = 10;

  while (changed && passes < maxPasses) {
    changed = false;
    passes++;

    const matches = findShortcodes(result);
    if (matches.length === 0) break;

    // Process in reverse order to preserve indices
    for (let i = matches.length - 1; i >= 0; i--) {
      const sc = matches[i];
      let replacement: string | null = null;
      let action = 'builtin';

      // Check site-specific rules first
      const rule = siteRules.get(sc.tag);
      if (rule) {
        switch (rule.action) {
          case 'strip':
            replacement = '';
            action = 'strip';
            break;
          case 'keep_content':
            replacement = sc.content;
            action = 'keep_content';
            break;
          case 'remove':
            replacement = '';
            action = 'remove';
            break;
          case 'component':
            replacement = `<!-- Component: ${rule.component || sc.tag} -->`;
            action = 'component';
            break;
          case 'html':
            replacement = sc.content;
            action = 'html';
            break;
        }
      }

      // Fall back to built-in handlers
      if (replacement === null && BUILTIN_HANDLERS[sc.tag]) {
        replacement = BUILTIN_HANDLERS[sc.tag](sc);
        action = 'builtin';
      }

      // Default: keep content for enclosing, strip self-closing
      if (replacement === null) {
        if (!sc.selfClosing && sc.content) {
          replacement = sc.content;
          action = 'keep_content_default';
        } else {
          replacement = `<!-- shortcode: [${sc.tag}] -->`;
          action = 'comment';
          unresolved.push(sc.tag);
        }
      }

      result = result.substring(0, sc.index) + replacement + result.substring(sc.index + sc.full.length);
      resolved.push({ tag: sc.tag, action });
      changed = true;
    }
  }

  return { content: result, resolved, unresolved: [...new Set(unresolved)] };
}

/**
 * Configure a shortcode rule for a site
 */
export function configureShortcode(
  siteId: string,
  shortcode: string,
  action: ShortcodeAction,
  component?: string,
  config?: Record<string, unknown>
): void {
  const db = database.getDatabase();
  db.prepare(
    `INSERT OR REPLACE INTO shortcode_map (site_id, shortcode, action, component, config)
     VALUES (?, ?, ?, ?, ?)`
  ).run(siteId, shortcode, action, component || null, config ? JSON.stringify(config) : null);

  logger.info('Shortcode rule configured', { siteId, shortcode, action });
}

/**
 * List all configured shortcode rules for a site
 */
export function listShortcodeRules(siteId: string): Array<{
  shortcode: string;
  action: string;
  component: string | null;
}> {
  const db = database.getDatabase();
  return db.prepare(
    'SELECT shortcode, action, component FROM shortcode_map WHERE site_id = ? ORDER BY shortcode'
  ).all(siteId) as Array<{ shortcode: string; action: string; component: string | null }>;
}
