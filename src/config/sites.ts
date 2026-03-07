/**
 * Multi-site configuration management
 * Handles site registration, credentials, and per-site export config
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Config, SiteConfig } from '../types/index.js';
import { SiteNotFoundError, ValidationError } from '../utils/errors.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

class SiteManager {
  private config: Config | null = null;
  private configPath: string;

  constructor() {
    this.configPath =
      process.env.WP_ASTRO_CONFIG ||
      path.join(PROJECT_ROOT, 'config', 'sites.json');
  }

  /**
   * Load configuration from disk (cached in memory)
   */
  loadConfig(): Config {
    if (this.config) {
      return this.config;
    }

    try {
      if (!fs.existsSync(this.configPath)) {
        const defaultConfig: Config = {
          sites: [],
          global_settings: {
            default_rate_limit: 10,
            default_content_format: 'md',
            default_component_library: 'starwind',
            default_deploy_platform: 'vercel',
          },
        };
        this.saveConfig(defaultConfig);
        this.config = defaultConfig;
        logger.info('Created default configuration', { path: this.configPath });
        return this.config;
      }

      const content = fs.readFileSync(this.configPath, 'utf-8');
      this.config = JSON.parse(content) as Config;
      logger.info('Loaded configuration', {
        path: this.configPath,
        siteCount: this.config.sites.length,
      });
      return this.config;
    } catch (error) {
      logger.error('Failed to load configuration', { error, path: this.configPath });
      throw new ValidationError(`Failed to load configuration: ${error}`);
    }
  }

  /**
   * Save configuration to disk
   */
  saveConfig(config: Config): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      this.config = config;
    } catch (error) {
      throw new ValidationError(`Failed to save configuration: ${error}`);
    }
  }

  /**
   * Clear cached config, force reload from disk
   */
  reloadConfig(): Config {
    this.config = null;
    return this.loadConfig();
  }

  /**
   * Get all active sites
   */
  getAllSites(): SiteConfig[] {
    const config = this.loadConfig();
    return config.sites.filter((site) => site.is_active !== false);
  }

  /**
   * Get a specific site by ID
   */
  getSite(siteId: string): SiteConfig {
    const config = this.loadConfig();
    const site = config.sites.find((s) => s.id === siteId);

    if (!site) {
      throw new SiteNotFoundError(siteId);
    }

    if (site.is_active === false) {
      throw new ValidationError(`Site is inactive: ${siteId}`);
    }

    return site;
  }

  /**
   * Get the default site
   */
  getDefaultSite(): SiteConfig | null {
    const config = this.loadConfig();
    return (
      config.sites.find((s) => s.default === true && s.is_active !== false) ||
      null
    );
  }

  /**
   * Resolve site ID - use provided or fall back to default
   */
  resolveSiteId(siteId?: string): string {
    if (siteId) return siteId;
    const defaultSite = this.getDefaultSite();
    if (!defaultSite) {
      throw new ValidationError(
        'No site_id provided and no default site configured. Use site_add first.'
      );
    }
    return defaultSite.id;
  }

  /**
   * Add a new site
   */
  addSite(params: {
    name: string;
    url: string;
    username: string;
    app_password: string;
    id?: string;
  }): SiteConfig {
    const config = this.loadConfig();

    // Generate ID from name if not provided
    const id =
      params.id ||
      params.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    // Check for duplicate ID or URL
    if (config.sites.find((s) => s.id === id)) {
      throw new ValidationError(`Site with ID "${id}" already exists.`);
    }
    const normalizedUrl = params.url.replace(/\/+$/, '');
    if (config.sites.find((s) => s.url.replace(/\/+$/, '') === normalizedUrl)) {
      throw new ValidationError(`Site with URL "${normalizedUrl}" already exists.`);
    }

    const newSite: SiteConfig = {
      id,
      name: params.name,
      url: normalizedUrl,
      username: params.username,
      app_password: params.app_password,
      is_active: true,
      default: config.sites.length === 0, // First site is default
    };

    config.sites.push(newSite);
    this.saveConfig(config);
    logger.info('Site added', { id, name: params.name, url: normalizedUrl });

    return newSite;
  }

  /**
   * Update site configuration (partial update)
   */
  updateSite(siteId: string, updates: Partial<SiteConfig>): SiteConfig {
    const config = this.loadConfig();
    const index = config.sites.findIndex((s) => s.id === siteId);

    if (index === -1) {
      throw new SiteNotFoundError(siteId);
    }

    // Prevent changing ID
    const { id: _id, ...safeUpdates } = updates;
    config.sites[index] = { ...config.sites[index], ...safeUpdates };
    this.saveConfig(config);

    return config.sites[index];
  }

  /**
   * Set a site as the default
   */
  setDefault(siteId: string): void {
    const config = this.loadConfig();

    if (!config.sites.find((s) => s.id === siteId)) {
      throw new SiteNotFoundError(siteId);
    }

    for (const site of config.sites) {
      site.default = site.id === siteId;
    }
    this.saveConfig(config);
  }

  /**
   * Deactivate a site (soft delete)
   */
  deactivateSite(siteId: string): void {
    this.updateSite(siteId, { is_active: false });
  }

  /**
   * Activate a site
   */
  activateSite(siteId: string): void {
    this.updateSite(siteId, { is_active: true });
  }

  /**
   * Get GitHub token
   */
  getGitHubToken(): string | undefined {
    const config = this.loadConfig();
    return config.github_token;
  }

  /**
   * Update GitHub token
   */
  setGitHubToken(token: string): void {
    const config = this.loadConfig();
    config.github_token = token;
    this.saveConfig(config);
  }
}

export const siteManager = new SiteManager();
export default siteManager;
