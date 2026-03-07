/**
 * WordPress REST API client (read-only)
 * Handles authentication, rate limiting, retries, and auto-discovery
 */

import axios, { type AxiosInstance, type AxiosError } from 'axios';
import http from 'http';
import https from 'https';
import type {
  SiteConfig,
  WPPost,
  WPAuthor,
  WPMedia,
  WPTerm,
  PaginationInfo,
} from '../types/index.js';
import { siteManager } from '../config/sites.js';
import {
  AuthenticationError,
  SiteConnectionError,
  RateLimitError,
} from '../utils/errors.js';
import logger from '../utils/logger.js';

// Connection pooling agents
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

/**
 * Simple token-bucket rate limiter
 */
class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number,
    private refillRate: number
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    const waitMs = (1000 / this.refillRate) * 1.1;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens--;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  halveRate(): void {
    this.refillRate = Math.max(1, Math.floor(this.refillRate / 2));
    logger.warn('Rate limit halved', { newRate: this.refillRate });
  }
}

class WPRestClient {
  private clients: Map<string, AxiosInstance> = new Map();
  private rateLimiters: Map<string, RateLimiter> = new Map();

  /**
   * Get or create an axios client for a site
   */
  private getClient(site: SiteConfig): AxiosInstance {
    if (this.clients.has(site.id)) {
      return this.clients.get(site.id)!;
    }

    const baseURL = site.url.replace(/\/+$/, '') + '/wp-json';
    const auth = Buffer.from(`${site.username}:${site.app_password}`).toString('base64');

    const client = axios.create({
      baseURL,
      timeout: 30000,
      httpAgent,
      httpsAgent,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });

    // Response interceptor for error handling
    client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401 || error.response?.status === 403) {
          throw new AuthenticationError(site.id);
        }
        if (error.response?.status === 429) {
          const retryAfter = parseInt(
            error.response.headers['retry-after'] as string,
            10
          );
          this.getRateLimiter(site).halveRate();
          throw new RateLimitError(site.id, retryAfter || undefined);
        }
        throw error;
      }
    );

    this.clients.set(site.id, client);
    return client;
  }

  /**
   * Get rate limiter for a site
   */
  private getRateLimiter(site: SiteConfig): RateLimiter {
    if (!this.rateLimiters.has(site.id)) {
      const rate = site.export?.rate_limit || 10;
      this.rateLimiters.set(site.id, new RateLimiter(rate, rate));
    }
    return this.rateLimiters.get(site.id)!;
  }

  /**
   * Make a rate-limited GET request with retry
   */
  private async get<T>(
    site: SiteConfig,
    endpoint: string,
    params?: Record<string, unknown>,
    retries = 3
  ): Promise<{ data: T; pagination?: PaginationInfo }> {
    const client = this.getClient(site);
    const limiter = this.getRateLimiter(site);

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await limiter.acquire();
        const response = await client.get<T>(endpoint, { params });

        const pagination: PaginationInfo | undefined =
          response.headers['x-wp-total']
            ? {
                total: parseInt(response.headers['x-wp-total'] as string, 10),
                totalPages: parseInt(
                  response.headers['x-wp-totalpages'] as string,
                  10
                ),
                currentPage: (params?.page as number) || 1,
                perPage: (params?.per_page as number) || 10,
              }
            : undefined;

        return { data: response.data, pagination };
      } catch (error) {
        if (
          error instanceof AuthenticationError ||
          error instanceof RateLimitError
        ) {
          throw error;
        }

        const isRetryable =
          error instanceof Error &&
          (axios.isAxiosError(error)
            ? !error.response || error.response.status >= 500
            : true);

        if (isRetryable && attempt < retries - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          logger.warn('Request failed, retrying', {
            endpoint,
            attempt: attempt + 1,
            delay,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw new SiteConnectionError(
          site.id,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    throw new SiteConnectionError(site.id, 'Max retries exceeded');
  }

  /**
   * Clear cached client (after config change)
   */
  clearClient(siteId: string): void {
    this.clients.delete(siteId);
    this.rateLimiters.delete(siteId);
  }

  // ============================================================
  // Discovery & Connection Testing
  // ============================================================

  /**
   * Test connection and auto-detect site capabilities
   */
  async testConnection(siteId: string): Promise<{
    success: boolean;
    wp_version?: string;
    namespaces?: string[];
    user?: { id: number; name: string; roles: string[] };
    post_types?: Array<{ slug: string; name: string; rest_base: string; hierarchical: boolean }>;
    taxonomies?: Array<{ slug: string; name: string; rest_base: string; hierarchical: boolean; types: string[] }>;
    seo_plugin?: string;
    page_builder?: string;
    has_acf?: boolean;
    has_woocommerce?: boolean;
    error?: string;
  }> {
    const site = siteManager.getSite(siteId);

    try {
      // 1. Root discovery
      const { data: root } = await this.get<{
        name: string;
        description: string;
        namespaces: string[];
        authentication: Record<string, unknown>;
      }>(site, '/');

      const namespaces = root.namespaces || [];

      // 2. Verify auth by fetching current user
      const { data: me } = await this.get<{
        id: number;
        name: string;
        roles: string[];
      }>(site, '/wp/v2/users/me', { context: 'edit' });

      // 3. Fetch post types
      const { data: typesRaw } = await this.get<
        Record<string, { slug: string; name: string; rest_base: string; hierarchical: boolean }>
      >(site, '/wp/v2/types');

      const postTypes = Object.values(typesRaw)
        .filter((t) => !['attachment', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles'].includes(t.slug))
        .map((t) => ({
          slug: t.slug,
          name: t.name,
          rest_base: t.rest_base,
          hierarchical: t.hierarchical,
        }));

      // 4. Fetch taxonomies
      const { data: taxRaw } = await this.get<
        Record<string, { slug: string; name: string; rest_base: string; hierarchical: boolean; types: string[] }>
      >(site, '/wp/v2/taxonomies');

      const taxonomies = Object.values(taxRaw).map((t) => ({
        slug: t.slug,
        name: t.name,
        rest_base: t.rest_base,
        hierarchical: t.hierarchical,
        types: t.types,
      }));

      // 5. Detect plugins from namespaces
      const seoPlugin = namespaces.includes('yoast/v1')
        ? 'yoast'
        : namespaces.includes('rankmath/v1')
          ? 'rankmath'
          : namespaces.find((n) => n.startsWith('aioseo'))
            ? 'aioseo'
            : 'none';

      const hasAcf =
        namespaces.includes('acf/v3') ||
        namespaces.some((n) => n.startsWith('acf'));
      const hasWoocommerce = namespaces.includes('wc/v3');

      // 6. Detect page builder (check for known plugin REST namespaces or post meta)
      let pageBuilder = 'none';
      if (namespaces.some((n) => n.startsWith('elementor'))) pageBuilder = 'elementor';
      // WPBakery/Divi/Beaver don't always register REST namespaces,
      // detection happens during content analysis

      // 7. Try to get WP version from head
      let wpVersion: string | undefined;
      try {
        const { data: settings } = await this.get<{ wp_version?: string }>(
          site,
          '/wp/v2/settings'
        );
        wpVersion = settings.wp_version;
      } catch (_e: unknown) {
        // Settings endpoint may require admin access
      }

      return {
        success: true,
        wp_version: wpVersion,
        namespaces,
        user: { id: me.id, name: me.name, roles: me.roles },
        post_types: postTypes,
        taxonomies,
        seo_plugin: seoPlugin,
        page_builder: pageBuilder,
        has_acf: hasAcf,
        has_woocommerce: hasWoocommerce,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ============================================================
  // Content Fetching
  // ============================================================

  /**
   * Fetch posts with pagination (any post type)
   */
  async fetchPosts(
    siteId: string,
    options: {
      postType?: string;
      restBase?: string;
      page?: number;
      perPage?: number;
      status?: string;
      after?: string;
      before?: string;
      embed?: boolean;
      fields?: string;
      orderby?: string;
      order?: string;
    } = {}
  ): Promise<{ posts: WPPost[]; pagination: PaginationInfo }> {
    const site = siteManager.getSite(siteId);
    const restBase = options.restBase || options.postType || 'posts';
    const endpoint = `/wp/v2/${restBase}`;

    const params: Record<string, unknown> = {
      page: options.page || 1,
      per_page: options.perPage || 100,
      _embed: options.embed !== false,
      orderby: options.orderby || 'date',
      order: options.order || 'desc',
    };

    if (options.status) params.status = options.status;
    if (options.after) params.after = options.after;
    if (options.before) params.before = options.before;
    if (options.fields) params._fields = options.fields;

    const { data, pagination } = await this.get<WPPost[]>(site, endpoint, params);
    return {
      posts: data,
      pagination: pagination || {
        total: data.length,
        totalPages: 1,
        currentPage: options.page || 1,
        perPage: options.perPage || 100,
      },
    };
  }

  /**
   * Fetch all post IDs for a post type (lightweight, for two-phase fetch)
   */
  async fetchAllPostIds(
    siteId: string,
    restBase: string,
    status = 'any'
  ): Promise<number[]> {
    const site = siteManager.getSite(siteId);
    const allIds: number[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const { data, pagination } = await this.get<Array<{ id: number }>>(
        site,
        `/wp/v2/${restBase}`,
        { page, per_page: 100, _fields: 'id', status }
      );
      allIds.push(...data.map((p) => p.id));
      if (pagination) totalPages = pagination.totalPages;
      page++;
    }

    return allIds;
  }

  /**
   * Fetch a single post by ID
   */
  async fetchPost(
    siteId: string,
    postId: number,
    restBase = 'posts'
  ): Promise<WPPost> {
    const site = siteManager.getSite(siteId);
    const { data } = await this.get<WPPost>(
      site,
      `/wp/v2/${restBase}/${postId}`,
      { _embed: true, context: 'edit' }
    );
    return data;
  }

  /**
   * Fetch taxonomy terms
   */
  async fetchTerms(
    siteId: string,
    restBase: string,
    page = 1,
    perPage = 100
  ): Promise<{ terms: WPTerm[]; pagination: PaginationInfo }> {
    const site = siteManager.getSite(siteId);
    const { data, pagination } = await this.get<WPTerm[]>(
      site,
      `/wp/v2/${restBase}`,
      { page, per_page: perPage }
    );
    return {
      terms: data,
      pagination: pagination || {
        total: data.length,
        totalPages: 1,
        currentPage: page,
        perPage,
      },
    };
  }

  /**
   * Fetch all terms for a taxonomy (handles pagination)
   */
  async fetchAllTerms(siteId: string, restBase: string): Promise<WPTerm[]> {
    const allTerms: WPTerm[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const { terms, pagination } = await this.fetchTerms(
        siteId,
        restBase,
        page
      );
      allTerms.push(...terms);
      totalPages = pagination.totalPages;
      page++;
    }

    return allTerms;
  }

  /**
   * Fetch authors
   */
  async fetchAuthors(siteId: string): Promise<WPAuthor[]> {
    const site = siteManager.getSite(siteId);
    const allAuthors: WPAuthor[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const { data, pagination } = await this.get<WPAuthor[]>(
        site,
        '/wp/v2/users',
        { page, per_page: 100, context: 'edit' }
      );
      allAuthors.push(...data);
      if (pagination) totalPages = pagination.totalPages;
      page++;
    }

    return allAuthors;
  }

  /**
   * Fetch media item by ID
   */
  async fetchMedia(siteId: string, mediaId: number): Promise<WPMedia> {
    const site = siteManager.getSite(siteId);
    const { data } = await this.get<WPMedia>(site, `/wp/v2/media/${mediaId}`);
    return data;
  }

  /**
   * Fetch navigation menus (WP 5.9+ with nav block, or classic menus via plugin)
   */
  async fetchMenus(siteId: string): Promise<unknown[]> {
    const site = siteManager.getSite(siteId);
    try {
      // Try WP 5.9+ navigation endpoint
      const { data } = await this.get<unknown[]>(site, '/wp/v2/navigation');
      return data;
    } catch (_e: unknown) {
      // Try menus endpoint (requires WP REST API Menus plugin or similar)
      try {
        const { data } = await this.get<unknown[]>(site, '/wp/v2/menus');
        return data;
      } catch (_e: unknown) {
        logger.warn('Menu endpoints not available', { siteId });
        return [];
      }
    }
  }

  /**
   * Fetch widgets/sidebars (WP 5.8+)
   */
  async fetchWidgets(siteId: string): Promise<unknown[]> {
    const site = siteManager.getSite(siteId);
    try {
      const { data } = await this.get<unknown[]>(site, '/wp/v2/sidebars');
      return data;
    } catch (_e: unknown) {
      logger.warn('Sidebars endpoint not available', { siteId });
      return [];
    }
  }

  /**
   * Fetch site settings/options
   */
  async fetchSettings(siteId: string): Promise<Record<string, unknown>> {
    const site = siteManager.getSite(siteId);
    try {
      const { data } = await this.get<Record<string, unknown>>(
        site,
        '/wp/v2/settings'
      );
      return data;
    } catch (_e: unknown) {
      logger.warn('Settings endpoint not available (may need admin role)', {
        siteId,
      });
      return {};
    }
  }

  /**
   * Fetch reusable block content by ID
   */
  async fetchReusableBlock(siteId: string, blockId: number): Promise<WPPost> {
    const site = siteManager.getSite(siteId);
    const { data } = await this.get<WPPost>(
      site,
      `/wp/v2/blocks/${blockId}`,
      { context: 'edit' }
    );
    return data;
  }

  /**
   * Fetch comments for a post
   */
  async fetchComments(
    siteId: string,
    postId?: number,
    page = 1,
    perPage = 100
  ): Promise<{ comments: unknown[]; pagination: PaginationInfo }> {
    const site = siteManager.getSite(siteId);
    const params: Record<string, unknown> = { page, per_page: perPage, status: 'approve' };
    if (postId) params.post = postId;

    const { data, pagination } = await this.get<unknown[]>(
      site,
      '/wp/v2/comments',
      params
    );
    return {
      comments: data,
      pagination: pagination || {
        total: data.length,
        totalPages: 1,
        currentPage: page,
        perPage,
      },
    };
  }
}

export const wpClient = new WPRestClient();
export default wpClient;
