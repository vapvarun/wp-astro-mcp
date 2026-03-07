/**
 * SQLite database for migration state tracking
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

class DatabaseManager {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor() {
    this.dbPath =
      process.env.WP_ASTRO_DB ||
      path.join(PROJECT_ROOT, 'data', 'wp-astro.db');
  }

  /**
   * Get database instance, initializing if necessary
   */
  getDatabase(): Database.Database {
    if (this.db) {
      return this.db;
    }

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.initializeSchema();
    logger.info('Database initialized', { path: this.dbPath });

    return this.db;
  }

  /**
   * Initialize all database tables
   */
  private initializeSchema(): void {
    const db = this.db!;

    // Export jobs — tracks each migration run
    db.exec(`
      CREATE TABLE IF NOT EXISTS export_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id TEXT NOT NULL,
        output_dir TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'api',
        wxr_path TEXT,
        total_posts INTEGER DEFAULT 0,
        posts_completed INTEGER DEFAULT 0,
        posts_failed INTEGER DEFAULT 0,
        posts_skipped INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        config TEXT,
        started_at TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        error_message TEXT,
        UNIQUE(site_id, output_dir)
      )
    `);

    // Per-post export state — enables resumability and sync
    db.exec(`
      CREATE TABLE IF NOT EXISTS export_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        site_id TEXT NOT NULL,
        wp_post_id INTEGER NOT NULL,
        post_type TEXT DEFAULT 'post',
        slug TEXT,
        title TEXT,
        status TEXT DEFAULT 'pending',
        output_path TEXT,
        issues TEXT,
        input_size INTEGER,
        output_size INTEGER,
        conversion_ms INTEGER,
        content_hash TEXT,
        wp_modified_gmt TEXT,
        retry_count INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(job_id, wp_post_id),
        FOREIGN KEY (job_id) REFERENCES export_jobs(id)
      )
    `);

    // Cached taxonomy terms — fetched once, reused for all posts
    db.exec(`
      CREATE TABLE IF NOT EXISTS cached_terms (
        id INTEGER PRIMARY KEY,
        site_id TEXT NOT NULL,
        term_id INTEGER NOT NULL,
        taxonomy TEXT NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        parent INTEGER DEFAULT 0,
        count INTEGER DEFAULT 0,
        description TEXT,
        meta TEXT,
        UNIQUE(site_id, term_id, taxonomy)
      )
    `);

    // Cached authors — fetched once, reused for all posts
    db.exec(`
      CREATE TABLE IF NOT EXISTS cached_authors (
        id INTEGER PRIMARY KEY,
        site_id TEXT NOT NULL,
        author_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        description TEXT,
        avatar_url TEXT,
        meta TEXT,
        UNIQUE(site_id, author_id)
      )
    `);

    // URL mapping — old WP URL to new Astro URL
    db.exec(`
      CREATE TABLE IF NOT EXISTS url_map (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id TEXT NOT NULL,
        wp_url TEXT NOT NULL,
        astro_url TEXT NOT NULL,
        post_type TEXT,
        wp_post_id INTEGER,
        UNIQUE(site_id, wp_url)
      )
    `);

    // Shortcode mapping — custom overrides per site
    db.exec(`
      CREATE TABLE IF NOT EXISTS shortcode_map (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id TEXT NOT NULL,
        shortcode TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT 'strip',
        component TEXT,
        config TEXT,
        UNIQUE(site_id, shortcode)
      )
    `);

    // Audit log — track operations for debugging
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id TEXT,
        action TEXT NOT NULL,
        details TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Content sync history — tracks ongoing WordPress→Astro sync runs
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id TEXT NOT NULL,
        started_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        status TEXT DEFAULT 'in_progress',
        new_posts INTEGER DEFAULT 0,
        updated_posts INTEGER DEFAULT 0,
        deleted_posts INTEGER DEFAULT 0,
        unchanged_posts INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        post_types TEXT,
        details TEXT
      )
    `);

    // Indexes for performance
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_export_posts_status
        ON export_posts(job_id, status);
      CREATE INDEX IF NOT EXISTS idx_export_posts_slug
        ON export_posts(job_id, slug);
      CREATE INDEX IF NOT EXISTS idx_export_posts_wp_id
        ON export_posts(site_id, wp_post_id);
      CREATE INDEX IF NOT EXISTS idx_cached_terms_site
        ON cached_terms(site_id, taxonomy);
      CREATE INDEX IF NOT EXISTS idx_url_map_site
        ON url_map(site_id);
      CREATE INDEX IF NOT EXISTS idx_audit_site
        ON audit_log(site_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_sync_history_site
        ON sync_history(site_id, started_at);
    `);
  }

  /**
   * Log an action to the audit table
   */
  audit(siteId: string | null, action: string, details?: unknown): void {
    const db = this.getDatabase();
    db.prepare(
      'INSERT INTO audit_log (site_id, action, details) VALUES (?, ?, ?)'
    ).run(siteId, action, details ? JSON.stringify(details) : null);
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export const database = new DatabaseManager();
export default database;
