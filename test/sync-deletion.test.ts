/**
 * Regression tests for sync.ts deletion classification (C1 / C2).
 *
 * Behaviours under test (the deletion-probe block inside detectChanges):
 *   - probe throws NotFoundError      ⇒ marked deleted (hard 404).
 *   - probe throws a transient error
 *     (e.g. SiteConnectionError)      ⇒ NOT marked deleted (skipped) — must not
 *                                       unlink live content on a flaky network.
 *   - probe returns status 'trash'    ⇒ marked deleted.
 *   - probe returns a live status
 *     ('publish')                     ⇒ alive (not deleted).
 *
 * Reachable seam: the exported `syncHandlers.sync_check` handler invokes the
 * (unexported) `detectChanges`, which runs the real classification logic. We:
 *   - point WP_ASTRO_DB / WP_ASTRO_CONFIG at throwaway temp paths;
 *   - seed a completed export_job + export_posts rows (the "local" side) directly
 *     in the real SQLite DB so getExportedPostMap() returns them;
 *   - mock the wp-rest-client module so fetchPosts() returns NO posts (every
 *     local id becomes "missing" → probed) and fetchPost() is driven per-id to
 *     exercise each classification branch;
 *   - assert on sync_check's JSON `deleted_posts` output.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { WPPost } from '../src/types/index.js';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wpastro-sync-'));
process.env.WP_ASTRO_CONFIG = path.join(tmpRoot, 'sites.json');
process.env.WP_ASTRO_DB = path.join(tmpRoot, 'wp-astro.db');

const SITE_ID = 'sync-test';

// ---------------------------------------------------------------------------
// Mock the wp-rest-client module that sync.ts imports. We need the REAL error
// classes (NotFoundError / SiteConnectionError) for the branch logic, so we
// only stub fetchPosts / fetchPost on the wpClient object.
// ---------------------------------------------------------------------------
const fetchPosts = vi.fn();
const fetchPost = vi.fn();
vi.mock('../src/services/wp-rest-client.js', () => ({
  wpClient: {
    fetchPosts: (...a: unknown[]) => fetchPosts(...a),
    fetchPost: (...a: unknown[]) => fetchPost(...a),
  },
}));

type SyncModule = typeof import('../src/tools/sync.js');
type SitesModule = typeof import('../src/config/sites.js');
type DbModule = typeof import('../src/config/database.js');
type ErrModule = typeof import('../src/utils/errors.js');

let syncHandlers: SyncModule['syncHandlers'];
let siteManager: SitesModule['siteManager'];
let database: DbModule['database'];
let NotFoundError: ErrModule['NotFoundError'];
let SiteConnectionError: ErrModule['SiteConnectionError'];

// Parse the JSON payload a handler returns (ToolResponse.content[0].text).
function payload(res: unknown): Record<string, unknown> {
  const r = res as { content: Array<{ text: string }> };
  return JSON.parse(r.content[0].text);
}

function livePost(id: number, status: string): WPPost {
  return {
    id,
    date: '2026-01-01T00:00:00',
    date_gmt: '2026-01-01T00:00:00',
    modified: '2026-01-01T00:00:00',
    modified_gmt: '2026-01-01T00:00:00',
    slug: `post-${id}`,
    status,
    type: 'post',
    link: `https://example.test/post-${id}/`,
    title: { rendered: `Post ${id}` },
    content: { rendered: '<p>x</p>', protected: false },
    excerpt: { rendered: '', protected: false },
    author: 1,
    featured_media: 0,
  };
}

beforeAll(async () => {
  const sitesMod = await import('../src/config/sites.js');
  siteManager = sitesMod.siteManager;
  siteManager.saveConfig({
    sites: [
      {
        id: SITE_ID,
        name: 'Sync Test',
        url: 'https://example.test',
        username: 'admin',
        app_password: 'pw',
        is_active: true,
        default: true,
        // One exportable post type so getExportablePostTypes() yields work.
        post_types: [
          { slug: 'post', name: 'Posts', rest_base: 'posts', hierarchical: false, has_archive: true },
        ],
      },
    ],
  });

  const dbMod = await import('../src/config/database.js');
  database = dbMod.database;

  const errMod = await import('../src/utils/errors.js');
  NotFoundError = errMod.NotFoundError;
  SiteConnectionError = errMod.SiteConnectionError;

  const syncMod = await import('../src/tools/sync.js');
  syncHandlers = syncMod.syncHandlers;
});

// Seed a completed export job + one completed export_posts row per id.
function seedLocalPosts(ids: number[]): void {
  const db = database.getDatabase();
  db.prepare('DELETE FROM export_posts WHERE site_id = ?').run(SITE_ID);
  db.prepare('DELETE FROM export_jobs WHERE site_id = ?').run(SITE_ID);

  const jobRes = db
    .prepare(
      "INSERT INTO export_jobs (site_id, output_dir, source_type, status, completed_at) VALUES (?, ?, 'api', 'completed', datetime('now'))"
    )
    .run(SITE_ID, path.join(tmpRoot, 'site-out'));
  const jobId = Number(jobRes.lastInsertRowid);

  for (const id of ids) {
    db.prepare(
      `INSERT INTO export_posts
        (job_id, site_id, wp_post_id, post_type, slug, title, status, output_path, wp_modified_gmt)
       VALUES (?, ?, ?, 'post', ?, ?, 'completed', ?, '2026-01-01T00:00:00')`
    ).run(jobId, SITE_ID, id, `post-${id}`, `Post ${id}`, `src/content/blog/post-${id}.md`);
  }
}

beforeEach(() => {
  fetchPosts.mockReset();
  fetchPost.mockReset();
  // No posts returned on the WP side → every local id is "missing" → probed.
  fetchPosts.mockResolvedValue({
    posts: [],
    pagination: { total: 0, totalPages: 1, currentPage: 1, perPage: 100 },
  });
});

describe('C1/C2: deletion classification via sync_check → detectChanges', () => {
  it('NotFoundError (hard 404) ⇒ marked deleted', async () => {
    seedLocalPosts([1]);
    fetchPost.mockRejectedValueOnce(new NotFoundError('WP resource', 1));

    const out = payload(await syncHandlers.sync_check({ site_id: SITE_ID, include_deleted: true }));
    const deleted = out.deleted_posts as Array<{ id: number }>;
    expect(deleted.map((d) => d.id)).toEqual([1]);
    expect((out.changes as { deleted_posts: number }).deleted_posts).toBe(1);
  });

  it('SiteConnectionError (transient) ⇒ NOT marked deleted (skipped)', async () => {
    seedLocalPosts([2]);
    fetchPost.mockRejectedValueOnce(new SiteConnectionError(SITE_ID, 'ECONNRESET'));

    const out = payload(await syncHandlers.sync_check({ site_id: SITE_ID, include_deleted: true }));
    expect((out.deleted_posts as unknown[])).toHaveLength(0);
    expect((out.changes as { deleted_posts: number }).deleted_posts).toBe(0);
  });

  it("status 'trash' ⇒ marked deleted", async () => {
    seedLocalPosts([3]);
    fetchPost.mockResolvedValueOnce(livePost(3, 'trash'));

    const out = payload(await syncHandlers.sync_check({ site_id: SITE_ID, include_deleted: true }));
    const deleted = out.deleted_posts as Array<{ id: number }>;
    expect(deleted.map((d) => d.id)).toEqual([3]);
  });

  it("live status 'publish' ⇒ alive (not deleted)", async () => {
    seedLocalPosts([4]);
    fetchPost.mockResolvedValueOnce(livePost(4, 'publish'));

    const out = payload(await syncHandlers.sync_check({ site_id: SITE_ID, include_deleted: true }));
    expect((out.deleted_posts as unknown[])).toHaveLength(0);
  });

  it('mixed batch classifies each id independently', async () => {
    seedLocalPosts([10, 20, 30, 40]);
    // Probe order follows Map insertion (10,20,30,40). getExportedPostMap orders
    // rows by ep.id DESC then keeps first-seen per wp_post_id; localIds =
    // Array.from(map.keys()). Drive fetchPost by id rather than by call order.
    fetchPost.mockImplementation(async (_siteId: string, id: number) => {
      if (id === 10) throw new NotFoundError('WP resource', 10); // deleted
      if (id === 20) throw new SiteConnectionError(SITE_ID, 'timeout'); // skip
      if (id === 30) return livePost(30, 'trash'); // deleted
      if (id === 40) return livePost(40, 'publish'); // alive
      throw new Error(`unexpected id ${id}`);
    });

    const out = payload(await syncHandlers.sync_check({ site_id: SITE_ID, include_deleted: true }));
    const deletedIds = (out.deleted_posts as Array<{ id: number }>).map((d) => d.id).sort((a, b) => a - b);
    expect(deletedIds).toEqual([10, 30]);
    expect((out.changes as { deleted_posts: number }).deleted_posts).toBe(2);
  });
});
