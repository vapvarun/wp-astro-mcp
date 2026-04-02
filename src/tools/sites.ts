/**
 * Site Management Tools
 * Add, test, list, update, remove, configure WordPress sites
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { siteManager } from '../config/sites.js';
import { wpClient } from '../services/wp-rest-client.js';
import { database } from '../config/database.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';
import {
  siteAddSchema,
  siteIdSchema,
  siteUpdateSchema,
  siteExportConfigSchema,
} from '../schemas/sites.js';
import logger from '../utils/logger.js';

export const siteTools: Tool[] = [
  {
    name: 'site_add',
    description:
      'Register a new WordPress site. Requires URL, username, and application password. Auto-detects WP version, SEO plugin, page builder, ACF, WooCommerce, post types, and taxonomies.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name' },
        url: { type: 'string', description: 'WordPress URL (e.g., https://example.com)' },
        username: { type: 'string', description: 'WordPress username' },
        app_password: {
          type: 'string',
          description: 'Application password (generate at /wp-admin/profile.php)',
        },
        id: { type: 'string', description: 'Custom site ID (optional)' },
      },
      required: ['name', 'url', 'username', 'app_password'],
    },
  },
  {
    name: 'site_test',
    description: 'Test connection to a site and refresh detected capabilities.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'site_list',
    description: 'List all registered WordPress sites with status and content stats.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'site_get',
    description: 'Get full details for a specific site including detected capabilities and export config.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'site_update',
    description: 'Update site credentials or settings.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID' },
        name: { type: 'string' },
        url: { type: 'string' },
        username: { type: 'string' },
        app_password: { type: 'string' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'site_remove',
    description: 'Deactivate a site (soft delete, can be reactivated).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID to remove' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'site_set_default',
    description: 'Set a site as the default (used when site_id is omitted).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID to make default' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'site_analyze',
    description:
      'Deep analysis of a WordPress site: count all content types, detect plugins, audit shortcodes, check media, and generate readiness report.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID (uses default if omitted)' },
      },
    },
  },
  {
    name: 'site_export_config',
    description:
      'Configure export settings for a site: output directory, content format, media strategy, post type filters, date filters, component library, deploy platform, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID' },
        output_dir: { type: 'string', description: 'Astro project output directory' },
        content_format: { type: 'string', enum: ['md', 'mdx'] },
        media_strategy: { type: 'string', enum: ['rewrite', 'download', 'keep'] },
        media_domain: { type: 'string', description: 'e.g., app.example.com' },
        include_post_types: { type: 'array', items: { type: 'string' } },
        exclude_post_types: { type: 'array', items: { type: 'string' } },
        include_statuses: { type: 'array', items: { type: 'string' } },
        include_comments: { type: 'boolean' },
        include_drafts: { type: 'boolean' },
        year_month_dirs: { type: 'boolean' },
        component_library: { type: 'string', enum: ['starwind', 'fulldev', 'webcoreui', 'none'] },
        deploy_platform: { type: 'string', enum: ['vercel', 'netlify', 'cloudflare', 'none'] },
        github_repo: { type: 'string' },
        github_org: { type: 'string' },
        rate_limit: { type: 'number' },
        date_after: { type: 'string' },
        date_before: { type: 'string' },
        exclude_categories: { type: 'array', items: { type: 'string' } },
        exclude_tags: { type: 'array', items: { type: 'string' } },
        exclude_authors: { type: 'array', items: { type: 'string' } },
      },
      required: ['site_id'],
    },
  },
];

export const siteHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
  site_add: async (params: unknown) => {
    try {
      const validated = siteAddSchema.parse(params);
      const site = siteManager.addSite(validated);

      // Auto-test connection and detect capabilities
      const detection = await wpClient.testConnection(site.id);

      if (detection.success) {
        // Save detected capabilities to config
        siteManager.updateSite(site.id, {
          wp_version: detection.wp_version,
          rest_namespaces: detection.namespaces,
          seo_plugin: detection.seo_plugin as SiteConfigSEO,
          page_builder: detection.page_builder as SiteConfigBuilder,
          has_acf: detection.has_acf,
          has_woocommerce: detection.has_woocommerce,
          post_types: detection.post_types?.map((t) => ({
            slug: t.slug,
            name: t.name,
            rest_base: t.rest_base,
            hierarchical: t.hierarchical,
            has_archive: false,
          })),
          taxonomies: detection.taxonomies?.map((t) => ({
            slug: t.slug,
            name: t.name,
            rest_base: t.rest_base,
            hierarchical: t.hierarchical,
            post_types: t.types,
          })),
        });

        database.audit(site.id, 'site_add', {
          name: site.name,
          url: site.url,
          wp_version: detection.wp_version,
          auth_user: detection.user?.name,
          auth_roles: detection.user?.roles,
        });

        // Check if wp-astro-bridge is installed
        let bridgeDetected = false;
        try {
          const bridgeUrl = `${site.url.replace(/\/+$/, '')}/wp-json/astro-bridge/v1/health`;
          const auth = Buffer.from(`${site.username}:${site.app_password}`).toString('base64');
          const healthResp = await axios.get(bridgeUrl, {
            headers: { Authorization: `Basic ${auth}` },
            timeout: 5000,
          });
          if (healthResp.data?.status === 'ok') {
            bridgeDetected = true;
          }
        } catch {
          // Bridge not installed — that's fine
        }

        return formatSuccessResponse({
          message: `Site "${site.name}" added successfully`,
          site: {
            id: site.id,
            name: site.name,
            url: site.url,
            is_default: site.default,
          },
          detection: {
            wp_version: detection.wp_version,
            auth: {
              user: detection.user?.name,
              roles: detection.user?.roles,
            },
            seo_plugin: detection.seo_plugin,
            page_builder: detection.page_builder,
            has_acf: detection.has_acf,
            has_woocommerce: detection.has_woocommerce,
            post_types: detection.post_types?.map((t) => `${t.name} (${t.slug})`),
            taxonomies: detection.taxonomies?.map((t) => `${t.name} (${t.slug})`),
          },
          bridge: bridgeDetected ? {
            installed: true,
            message: 'wp-astro-bridge plugin detected. Webhooks and preview available.',
          } : {
            installed: false,
            hint: 'Install wp-astro-bridge plugin for automatic content sync and draft preview.',
          },
          next_steps: [
            'Run site_analyze for content counts and site readiness',
            'Run site_export_config to set output directory and preferences',
            'Run convert_preview to see sample converted posts',
            bridgeDetected
              ? 'wp-astro-bridge detected — configure webhook URL in Settings > Astro Bridge'
              : 'Optional: Install wp-astro-bridge plugin for webhooks and draft preview',
          ],
        });
      } else {
        return formatSuccessResponse({
          message: `Site "${site.name}" added but connection test failed`,
          site: { id: site.id, name: site.name, url: site.url },
          warning: detection.error,
          hint: 'Check username and app_password. Make sure REST API is not blocked.',
        });
      }
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  site_test: async (params: unknown) => {
    try {
      const { site_id } = siteIdSchema.parse(params) as { site_id: string };
      const result = await wpClient.testConnection(site_id);

      if (result.success) {
        // Update stored capabilities
        siteManager.updateSite(site_id, {
          wp_version: result.wp_version,
          seo_plugin: result.seo_plugin as SiteConfigSEO,
          has_acf: result.has_acf,
          has_woocommerce: result.has_woocommerce,
        });
      }

      return formatSuccessResponse(result);
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  site_list: async () => {
    try {
      const sites = siteManager.getAllSites();
      const defaultSite = siteManager.getDefaultSite();

      const siteList = sites.map((site) => ({
        id: site.id,
        name: site.name,
        url: site.url,
        is_default: site.id === defaultSite?.id,
        wp_version: site.wp_version,
        seo_plugin: site.seo_plugin,
        page_builder: site.page_builder,
        post_types: site.post_types?.length || 0,
        content_stats: site.content_stats,
        has_export_config: !!site.export,
      }));

      return formatSuccessResponse({
        sites: siteList,
        total: siteList.length,
        default_site: defaultSite?.id || null,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  site_get: async (params: unknown) => {
    try {
      const { site_id } = siteIdSchema.parse(params) as { site_id: string };
      const site = siteManager.getSite(site_id);

      // Strip sensitive data from response
      const { app_password: _pw, ...safeConfig } = site;

      return formatSuccessResponse({
        ...safeConfig,
        app_password: '********',
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  site_update: async (params: unknown) => {
    try {
      const validated = siteUpdateSchema.parse(params);
      const { site_id, ...updates } = validated;
      const site = siteManager.updateSite(site_id, updates);
      wpClient.clearClient(site_id);

      database.audit(site_id, 'site_update', { fields: Object.keys(updates) });

      return formatSuccessResponse({
        message: `Site "${site.name}" updated`,
        updated_fields: Object.keys(updates),
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  site_remove: async (params: unknown) => {
    try {
      const { site_id } = siteIdSchema.parse(params) as { site_id: string };
      const site = siteManager.getSite(site_id);
      siteManager.deactivateSite(site_id);
      wpClient.clearClient(site_id);

      database.audit(site_id, 'site_remove', { name: site.name });

      return formatSuccessResponse({
        message: `Site "${site.name}" deactivated. Use site_update to reactivate.`,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  site_set_default: async (params: unknown) => {
    try {
      const { site_id } = siteIdSchema.parse(params) as { site_id: string };
      siteManager.setDefault(site_id);
      const site = siteManager.getSite(site_id);

      return formatSuccessResponse({
        message: `"${site.name}" is now the default site`,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  site_analyze: async (params: unknown) => {
    try {
      const parsed = siteIdSchema.parse(params);
      const siteId = siteManager.resolveSiteId(parsed.site_id);
      const site = siteManager.getSite(siteId);

      logger.info('Starting site analysis', { siteId });

      // Fetch content counts for each post type
      const postTypeCounts: Record<string, number> = {};
      const restBases: Record<string, string> = {};

      for (const pt of site.post_types || [{ slug: 'post', rest_base: 'posts', name: 'Posts', hierarchical: false, has_archive: true }]) {
        try {
          const { pagination } = await wpClient.fetchPosts(siteId, {
            restBase: pt.rest_base,
            perPage: 1,
          });
          postTypeCounts[pt.slug] = pagination.total;
          restBases[pt.slug] = pt.rest_base;
        } catch (_e: unknown) {
          postTypeCounts[pt.slug] = 0;
        }
      }

      // Fetch taxonomy counts
      const taxonomyCounts: Record<string, number> = {};
      for (const tax of site.taxonomies || []) {
        try {
          const { pagination } = await wpClient.fetchTerms(siteId, tax.rest_base, 1, 1);
          taxonomyCounts[tax.slug] = pagination.total;
        } catch (_e: unknown) {
          taxonomyCounts[tax.slug] = 0;
        }
      }

      // Fetch author count
      let authorCount = 0;
      try {
        const authors = await wpClient.fetchAuthors(siteId);
        authorCount = authors.length;
      } catch (_e: unknown) {
        // Author endpoint may be restricted
      }

      // Fetch media count
      let mediaCount = 0;
      try {
        const { pagination } = await wpClient.fetchPosts(siteId, {
          restBase: 'media',
          perPage: 1,
        });
        mediaCount = pagination.total;
      } catch (_e: unknown) {
        // Media endpoint may be restricted
      }

      // Save stats to config
      const stats = {
        posts: postTypeCounts['post'] || 0,
        pages: postTypeCounts['page'] || 0,
        media: mediaCount,
        categories: taxonomyCounts['category'] || 0,
        tags: taxonomyCounts['post_tag'] || 0,
        authors: authorCount,
        comments: 0,
        custom_post_types: Object.fromEntries(
          Object.entries(postTypeCounts).filter(
            ([k]) => k !== 'post' && k !== 'page'
          )
        ),
      };

      siteManager.updateSite(siteId, { content_stats: stats });
      database.audit(siteId, 'site_analyze', stats);

      // Estimate build time
      const totalContent =
        Object.values(postTypeCounts).reduce((a, b) => a + b, 0);
      const estimatedMinutes = Math.ceil(totalContent / 180); // ~3 posts/sec

      return formatSuccessResponse({
        site: { id: siteId, name: site.name, url: site.url },
        content: {
          post_types: Object.entries(postTypeCounts).map(([type, count]) => ({
            type,
            count,
            rest_base: restBases[type],
          })),
          total_content: totalContent,
        },
        taxonomies: Object.entries(taxonomyCounts).map(([tax, count]) => ({
          taxonomy: tax,
          count,
        })),
        authors: authorCount,
        media: mediaCount,
        detected: {
          wp_version: site.wp_version,
          seo_plugin: site.seo_plugin,
          page_builder: site.page_builder,
          has_acf: site.has_acf,
          has_woocommerce: site.has_woocommerce,
          editor: site.editor,
          permalink_structure: site.permalink_structure,
        },
        estimate: {
          total_items: totalContent,
          estimated_minutes: estimatedMinutes,
          recommended_source: totalContent > 1000 ? 'WXR XML export (faster for large sites)' : 'REST API',
        },
        next_steps: [
          'Run site_export_config to set output directory and preferences',
          'Run convert_preview to see sample converted posts before full export',
          'Run export_plan for full readiness report',
        ],
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },

  site_export_config: async (params: unknown) => {
    try {
      const validated = siteExportConfigSchema.parse(params);
      const { site_id, ...exportConfig } = validated;

      const site = siteManager.getSite(site_id);
      const currentExport = site.export || {};
      const mergedExport = { ...currentExport, ...exportConfig };

      siteManager.updateSite(site_id, { export: mergedExport });
      database.audit(site_id, 'site_export_config', {
        fields: Object.keys(exportConfig),
      });

      return formatSuccessResponse({
        message: `Export config updated for "${site.name}"`,
        export_config: mergedExport,
      });
    } catch (error) {
      return formatErrorResponse(error);
    }
  },
};

// Helper types for detection results
type SiteConfigSEO = 'yoast' | 'rankmath' | 'aioseo' | 'none';
type SiteConfigBuilder = 'elementor' | 'wpbakery' | 'divi' | 'beaver' | 'bricks' | 'oxygen' | 'none';
