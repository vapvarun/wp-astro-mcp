/**
 * Regression tests for wp-rest-client.ts critical audit fixes.
 *
 *  H3 — pagination fallback when `x-wp-total` header is ABSENT (proxy stripped
 *       it). fetchAllPostIds / fetchAllTerms / fetchAuthors must keep paging
 *       while pages come back full (length === per_page) and stop on a short
 *       page. With the header present, they must respect totalPages.
 *
 *  H2 — 429 retry. A 429 once-then-success must retry and ultimately succeed;
 *       exhausting retries must throw.
 *
 * Strategy: mock `axios.create` to return a fake client whose `.get` is a
 * vi.fn with sequenced behaviour. We capture the real response-interceptor
 * rejection handler that the client registers via `interceptors.response.use`
 * and run thrown axios-shaped errors through it — so the REAL 404→NotFoundError
 * and 429→RateLimitError translation in the source is exercised, not faked.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  vi,
  type Mock,
} from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Isolate config + DB to throwaway temp paths BEFORE any source import so the
// module-level singletons never touch the real config/db.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wpastro-rest-'));
process.env.WP_ASTRO_CONFIG = path.join(tmpRoot, 'sites.json');
process.env.WP_ASTRO_DB = path.join(tmpRoot, 'wp-astro.db');

// ---------------------------------------------------------------------------
// Fake axios client wiring.
//
// The source calls `axios.create(...)` once per site and registers a response
// interceptor. We hand back a fake client, record the interceptor's
// rejection handler, and let each test set `getImpl` to drive `.get`.
// ---------------------------------------------------------------------------
let getImpl: Mock;
let rejectionHandler: ((err: unknown) => unknown) | undefined;

vi.mock('axios', () => {
  const create = vi.fn(() => ({
    get: (...args: unknown[]) => getImpl(...args),
    interceptors: {
      response: {
        use: (_onFulfilled: unknown, onRejected: (err: unknown) => unknown) => {
          rejectionHandler = onRejected;
        },
      },
    },
  }));
  // `isAxiosError` is used inside the retry classifier.
  const isAxiosError = (e: unknown): boolean =>
    !!e && typeof e === 'object' && (e as { isAxiosError?: boolean }).isAxiosError === true;
  const axiosDefault = { create, isAxiosError };
  return { default: axiosDefault, isAxiosError, create };
});

// Build an axios-shaped error and route it through the captured interceptor so
// the source's real status→error-class mapping runs.
function makeAxiosError(status: number, headers: Record<string, string> = {}): unknown {
  return {
    isAxiosError: true,
    response: { status, headers },
    config: { url: '/test' },
    message: `Request failed with status code ${status}`,
  };
}
async function viaInterceptor(status: number, headers?: Record<string, string>): Promise<never> {
  if (!rejectionHandler) throw new Error('interceptor not registered yet');
  // The real interceptor is an async fn that throws a WPAstroError (or rethrows
  // the raw error). Awaiting it surfaces that thrown error as this promise's
  // rejection reason, so `client.get()` sees exactly what the source produces.
  await rejectionHandler(makeAxiosError(status, headers));
  // Unreachable: the interceptor always rejects for the statuses we pass.
  throw new Error('interceptor unexpectedly resolved');
}

type WPRestClientModule = typeof import('../src/services/wp-rest-client.js');
type SitesModule = typeof import('../src/config/sites.js');

let wpClient: WPRestClientModule['wpClient'];
let siteManager: SitesModule['siteManager'];

const SITE_ID = 'paginate-test';

beforeAll(async () => {
  const sitesMod = await import('../src/config/sites.js');
  siteManager = sitesMod.siteManager;
  // Seed a single in-memory site with a high rate_limit so the token-bucket
  // limiter never blocks (keeps tests fast and timer-free for the happy path).
  siteManager.saveConfig({
    sites: [
      {
        id: SITE_ID,
        name: 'Paginate Test',
        url: 'https://example.test',
        username: 'admin',
        app_password: 'pw',
        is_active: true,
        default: true,
        post_types: [],
        export: { rate_limit: 100000 },
      },
    ],
  });
  const restMod = await import('../src/services/wp-rest-client.js');
  wpClient = restMod.wpClient;
});

beforeEach(() => {
  getImpl = vi.fn();
  wpClient.clearClient(SITE_ID); // force a fresh axios client + interceptor each test
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// Helper: build a successful axios response with optional x-wp-* headers.
function ok<T>(data: T, headers: Record<string, string> = {}) {
  return { data, headers };
}

// 100 ids per full page (per_page used by fetchAllPostIds/Terms/Authors).
function fullPage(start: number, count: number): Array<{ id: number; name?: string; slug?: string; taxonomy?: string }> {
  return Array.from({ length: count }, (_v, i) => ({ id: start + i }));
}

describe('H3: pagination fallback when x-wp-total header is ABSENT', () => {
  it('fetchAllPostIds keeps paging on full pages and stops on a short page (2.5 pages)', async () => {
    // 100 + 100 + 50 = 250 items across 3 pages, NO x-wp-total header.
    getImpl
      .mockResolvedValueOnce(ok(fullPage(1, 100)))
      .mockResolvedValueOnce(ok(fullPage(101, 100)))
      .mockResolvedValueOnce(ok(fullPage(201, 50)));

    const ids = await wpClient.fetchAllPostIds(SITE_ID, 'posts');

    expect(ids).toHaveLength(250);
    expect(ids[0]).toBe(1);
    expect(ids[249]).toBe(250);
    // 3 requests: pages 1, 2 (full → keep going), 3 (short → stop).
    expect(getImpl).toHaveBeenCalledTimes(3);
  });

  it('fetchAllPostIds stops after one short first page', async () => {
    getImpl.mockResolvedValueOnce(ok(fullPage(1, 10))); // < per_page → stop
    const ids = await wpClient.fetchAllPostIds(SITE_ID, 'posts');
    expect(ids).toHaveLength(10);
    expect(getImpl).toHaveBeenCalledTimes(1);
  });

  it('fetchAllPostIds stops on an exactly-full single page followed by an empty page', async () => {
    // Edge: a full final page forces one more request that returns empty.
    getImpl
      .mockResolvedValueOnce(ok(fullPage(1, 100)))
      .mockResolvedValueOnce(ok([])); // empty → length 0 !== 100 → stop
    const ids = await wpClient.fetchAllPostIds(SITE_ID, 'posts');
    expect(ids).toHaveLength(100);
    expect(getImpl).toHaveBeenCalledTimes(2);
  });

  it('fetchAllTerms keeps paging on full pages without the header (2.5 pages)', async () => {
    const term = (id: number) => ({ id, name: `t${id}`, slug: `t${id}`, taxonomy: 'category' });
    getImpl
      .mockResolvedValueOnce(ok(Array.from({ length: 100 }, (_v, i) => term(i + 1))))
      .mockResolvedValueOnce(ok(Array.from({ length: 100 }, (_v, i) => term(i + 101))))
      .mockResolvedValueOnce(ok(Array.from({ length: 50 }, (_v, i) => term(i + 201))));

    const terms = await wpClient.fetchAllTerms(SITE_ID, 'categories');
    expect(terms).toHaveLength(250);
    expect(getImpl).toHaveBeenCalledTimes(3);
  });

  it('fetchAuthors keeps paging on full pages without the header (2.5 pages)', async () => {
    const author = (id: number) => ({ id, name: `a${id}`, slug: `a${id}` });
    getImpl
      .mockResolvedValueOnce(ok(Array.from({ length: 100 }, (_v, i) => author(i + 1))))
      .mockResolvedValueOnce(ok(Array.from({ length: 100 }, (_v, i) => author(i + 101))))
      .mockResolvedValueOnce(ok(Array.from({ length: 50 }, (_v, i) => author(i + 201))));

    const authors = await wpClient.fetchAuthors(SITE_ID);
    expect(authors).toHaveLength(250);
    expect(getImpl).toHaveBeenCalledTimes(3);
  });
});

describe('H3: WITH x-wp-total header, totalPages is respected', () => {
  it('fetchAllPostIds trusts totalPages=2 even though page 1 is full', async () => {
    // Header present and says only 2 pages, 150 total. Page 2 is short but the
    // loop must stop after page 2 because pagination.totalPages === 2.
    getImpl
      .mockResolvedValueOnce(
        ok(fullPage(1, 100), { 'x-wp-total': '150', 'x-wp-totalpages': '2' })
      )
      .mockResolvedValueOnce(
        ok(fullPage(101, 50), { 'x-wp-total': '150', 'x-wp-totalpages': '2' })
      );

    const ids = await wpClient.fetchAllPostIds(SITE_ID, 'posts');
    expect(ids).toHaveLength(150);
    expect(getImpl).toHaveBeenCalledTimes(2);
  });

  it('fetchAllPostIds with header totalPages=1 does NOT make a second request even on a full page', async () => {
    // Pathological-but-real: header claims 1 page while returning a full 100.
    // The header path trusts totalPages and must NOT page further.
    getImpl.mockResolvedValueOnce(
      ok(fullPage(1, 100), { 'x-wp-total': '100', 'x-wp-totalpages': '1' })
    );
    const ids = await wpClient.fetchAllPostIds(SITE_ID, 'posts');
    expect(ids).toHaveLength(100);
    expect(getImpl).toHaveBeenCalledTimes(1);
  });
});

describe('H2: 429 retry behaviour', () => {
  it('retries after a single 429 and ultimately succeeds', async () => {
    vi.useFakeTimers();
    getImpl
      // First call: axios rejects, interceptor maps 429 → RateLimitError.
      .mockImplementationOnce(() => viaInterceptor(429, { 'retry-after': '0' }))
      // Second call: success.
      .mockResolvedValueOnce(ok(fullPage(1, 5)));

    const promise = wpClient.fetchAllPostIds(SITE_ID, 'posts');
    // Drain the retry backoff timer(s).
    await vi.runAllTimersAsync();
    const ids = await promise;

    expect(ids).toHaveLength(5);
    expect(getImpl).toHaveBeenCalledTimes(2);
  });

  it('throws RateLimitError after exhausting retries (persistent 429)', async () => {
    vi.useFakeTimers();
    getImpl.mockImplementation(() => viaInterceptor(429, { 'retry-after': '0' }));

    const promise = wpClient.fetchAllPostIds(SITE_ID, 'posts').catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await promise;

    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).toBe('RATE_LIMIT');
    // get() default retries = 3 → 3 attempts then throw.
    expect(getImpl).toHaveBeenCalledTimes(3);
  });

  it('404 is mapped to NotFoundError and never retried', async () => {
    getImpl.mockImplementation(() => viaInterceptor(404));
    const err = await wpClient.fetchAllPostIds(SITE_ID, 'posts').catch((e) => e);
    expect((err as { code?: string }).code).toBe('NOT_FOUND');
    expect(getImpl).toHaveBeenCalledTimes(1); // not retried
  });
});
