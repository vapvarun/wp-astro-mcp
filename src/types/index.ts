/**
 * WP Astro MCP - Type Definitions
 */

// ============================================================
// Site Configuration
// ============================================================

export interface SiteConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  app_password: string;
  default?: boolean;
  is_active?: boolean;

  // Auto-detected on connect
  wp_version?: string;
  rest_api_url?: string;
  rest_namespaces?: string[];
  seo_plugin?: 'yoast' | 'rankmath' | 'aioseo' | 'none';
  page_builder?: 'elementor' | 'wpbakery' | 'divi' | 'beaver' | 'bricks' | 'oxygen' | 'none';
  editor?: 'block' | 'classic' | 'mixed';
  has_acf?: boolean;
  has_woocommerce?: boolean;
  has_wpml?: boolean;
  has_polylang?: boolean;
  post_types?: PostTypeInfo[];
  taxonomies?: TaxonomyInfo[];
  permalink_structure?: string;
  site_language?: string;
  timezone?: string;
  site_title?: string;
  site_tagline?: string;

  // Content stats (updated on analyze)
  content_stats?: ContentStats;

  // Export configuration (per-site)
  export?: ExportConfig;
}

export interface PostTypeInfo {
  slug: string;
  name: string;
  rest_base: string;
  hierarchical: boolean;
  has_archive: boolean;
  count?: number;
}

export interface TaxonomyInfo {
  slug: string;
  name: string;
  rest_base: string;
  hierarchical: boolean;
  post_types: string[];
  count?: number;
}

export interface ContentStats {
  posts: number;
  pages: number;
  media: number;
  categories: number;
  tags: number;
  authors: number;
  comments: number;
  custom_post_types: Record<string, number>;
}

export interface ExportConfig {
  output_dir?: string;
  content_format?: 'md' | 'mdx' | 'json';
  media_strategy?: 'rewrite' | 'download' | 'keep';
  media_domain?: string;
  include_post_types?: string[];
  exclude_post_types?: string[];
  include_statuses?: string[];
  exclude_categories?: string[];
  exclude_tags?: string[];
  exclude_authors?: string[];
  date_after?: string;
  date_before?: string;
  include_comments?: boolean;
  include_drafts?: boolean;
  year_month_dirs?: boolean;
  component_library?: 'starwind' | 'fulldev' | 'webcoreui' | 'none';
  deploy_platform?: 'vercel' | 'netlify' | 'cloudflare' | 'none';
  github_repo?: string;
  github_org?: string;
  rate_limit?: number;
  content_type_config?: Record<string, ContentTypeConfig>;
}

export interface ContentTypeConfig {
  directory: string;
  slug_prefix?: string;
  layout?: string;
  frontmatter_map?: Record<string, string>;
  include_fields?: string[];
  exclude_fields?: string[];
}

export interface Config {
  sites: SiteConfig[];
  github_token?: string;
  global_settings?: GlobalSettings;
}

export interface GlobalSettings {
  default_rate_limit: number;
  default_content_format: 'md' | 'mdx';
  default_component_library: string;
  default_deploy_platform: string;
}

// ============================================================
// WordPress API Types
// ============================================================

export interface WPPost {
  id: number;
  date: string;
  date_gmt: string;
  modified: string;
  modified_gmt: string;
  slug: string;
  status: string;
  type: string;
  link: string;
  title: { rendered: string; raw?: string };
  content: { rendered: string; raw?: string; protected: boolean };
  excerpt: { rendered: string; raw?: string; protected: boolean };
  author: number;
  featured_media: number;
  categories?: number[];
  tags?: number[];
  format?: string;
  sticky?: boolean;
  template?: string;
  password?: string;
  parent?: number;
  menu_order?: number;
  meta?: Record<string, unknown>;
  acf?: Record<string, unknown>;
  yoast_head_json?: YoastSEO;
  rank_math_seo?: RankMathSEO;
  _embedded?: WPEmbedded;
}

export interface WPEmbedded {
  author?: WPAuthor[];
  'wp:featuredmedia'?: WPMedia[];
  'wp:term'?: WPTerm[][];
}

export interface WPAuthor {
  id: number;
  name: string;
  slug: string;
  description?: string;
  link?: string;
  avatar_urls?: Record<string, string>;
}

export interface WPMedia {
  id: number;
  source_url: string;
  alt_text: string;
  caption?: { rendered: string };
  description?: { rendered: string };
  media_details?: {
    width: number;
    height: number;
    file: string;
    sizes?: Record<string, WPMediaSize>;
  };
  mime_type: string;
  title?: { rendered: string };
}

export interface WPMediaSize {
  file: string;
  width: number;
  height: number;
  source_url: string;
  mime_type: string;
}

export interface WPTerm {
  id: number;
  name: string;
  slug: string;
  taxonomy: string;
  description?: string;
  parent?: number;
  count?: number;
  meta?: Record<string, unknown>;
}

export interface WPMenu {
  id: number;
  name: string;
  slug: string;
  locations: string[];
  items: WPMenuItem[];
}

export interface WPMenuItem {
  id: number;
  title: string;
  url: string;
  type: 'post_type' | 'taxonomy' | 'custom';
  object: string;
  object_id: number;
  parent: number;
  menu_order: number;
  classes: string[];
  description?: string;
  children?: WPMenuItem[];
}

export interface WPWidget {
  id: string;
  id_base: string;
  sidebar: string;
  rendered: string;
  instance?: {
    title?: string;
    [key: string]: unknown;
  };
}

// ============================================================
// SEO Plugin Types
// ============================================================

export interface YoastSEO {
  title?: string;
  description?: string;
  canonical?: string;
  og_title?: string;
  og_description?: string;
  og_image?: Array<{ url: string; width: number; height: number }>;
  twitter_title?: string;
  twitter_description?: string;
  twitter_image?: string;
  schema?: Record<string, unknown>;
  robots?: {
    index?: string;
    follow?: string;
  };
}

export interface RankMathSEO {
  title?: string;
  description?: string;
  focus_keyword?: string;
  canonical_url?: string;
  robots?: string[];
  og_title?: string;
  og_description?: string;
  og_image?: string;
}

// ============================================================
// Export Pipeline Types
// ============================================================

export interface ExportJob {
  id: number;
  site_id: string;
  output_dir: string;
  source_type: 'api' | 'wxr';
  wxr_path?: string;
  total_posts: number;
  posts_completed: number;
  posts_failed: number;
  posts_skipped: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused';
  config: string;
  started_at?: string;
  updated_at?: string;
  completed_at?: string;
  error_message?: string;
}

export interface ExportPostState {
  id: number;
  job_id: number;
  site_id: string;
  wp_post_id: number;
  post_type: string;
  slug?: string;
  title?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  output_path?: string;
  issues?: string;
  input_size?: number;
  output_size?: number;
  conversion_ms?: number;
  content_hash?: string;
  retry_count: number;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface ConversionIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  context?: string;
}

export interface ConversionResult {
  frontmatter: AstroFrontmatter;
  body: string;
  issues: ConversionIssue[];
  inputSize: number;
  outputSize: number;
  conversionMs: number;
}

// ============================================================
// Astro Output Types
// ============================================================

export interface AstroFrontmatter {
  title: string;
  slug: string;
  date: string;
  modified?: string;
  author?: {
    name: string;
    id: number;
    slug: string;
    avatar?: string;
  };
  status: string;
  categories?: Array<{ name: string; slug: string }>;
  tags?: Array<{ name: string; slug: string }>;
  excerpt?: string;
  featuredImage?: {
    url: string;
    alt: string;
    width?: number;
    height?: number;
  };
  seo?: {
    title?: string;
    description?: string;
    canonical?: string;
    ogImage?: string;
    noindex?: boolean;
    focusKeyword?: string;
  };
  format?: string;
  sticky?: boolean;
  template?: string;
  password?: string;
  draft?: boolean;
  readingTime?: number;
  wordCount?: number;
  wpPostId: number;
  wpUrl: string;
  postType: string;
  parent?: number;
  parentSlug?: string;
  fullPath?: string;
  menuOrder?: number;
  customFields?: Record<string, unknown>;
  acf?: Record<string, unknown>;
  taxonomies?: Record<string, Array<{ name: string; slug: string }>>;
  conversionIssues?: ConversionIssue[];
}

export interface AstroCollectionSchema {
  name: string;
  postType: string;
  directory: string;
  fields: SchemaField[];
}

export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: unknown;
}

// ============================================================
// Utility Types
// ============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ToolResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError: boolean;
}

export interface PaginationInfo {
  total: number;
  totalPages: number;
  currentPage: number;
  perPage: number;
}

export interface MigrationReport {
  site_id: string;
  site_url: string;
  export_date: string;
  total_posts: number;
  total_pages: number;
  total_media: number;
  content_types_exported: string[];
  issues_by_severity: Record<string, number>;
  unmigrated_features: string[];
  redirects_generated: number;
  files_generated: number;
  total_size_bytes: number;
}
