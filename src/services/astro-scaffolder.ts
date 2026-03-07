/**
 * Astro Project Scaffolder
 * Generates Astro project structure with content collections,
 * config, layouts, and deploy platform configuration.
 */

import fs from 'fs';
import path from 'path';
import type { SiteConfig } from '../types/index.js';
import logger from '../utils/logger.js';

export interface ScaffoldResult {
  filesCreated: string[];
  filesSkipped: string[];
  outputDir: string;
}

/**
 * Scaffold a complete Astro project structure
 */
export function scaffoldProject(
  site: SiteConfig,
  outputDir: string,
  force = false
): ScaffoldResult {
  const created: string[] = [];
  const skipped: string[] = [];

  const config = site.export || {};
  const componentLib = config.component_library || 'none';
  const deployPlatform = config.deploy_platform || 'none';
  const contentFormat = config.content_format || 'md';
  const useJsonMode = contentFormat === 'json';

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Helper to write file if not exists (or if force)
  const writeFile = (relPath: string, content: string) => {
    const fullPath = path.join(outputDir, relPath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });

    if (!force && fs.existsSync(fullPath)) {
      skipped.push(relPath);
      return;
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
    created.push(relPath);
  };

  // 1. package.json
  writeFile('package.json', generatePackageJson(site, componentLib, deployPlatform));

  // 2. astro.config.mjs
  writeFile('astro.config.mjs', generateAstroConfig(site, deployPlatform));

  // 3. tsconfig.json
  writeFile('tsconfig.json', JSON.stringify({
    extends: 'astro/tsconfigs/strict',
    compilerOptions: {
      baseUrl: '.',
      paths: { '@/*': ['src/*'] },
    },
  }, null, 2));

  // 4. Content config (skip for JSON mode — no content collections)
  if (!useJsonMode) {
    writeFile('src/content.config.ts', generateContentConfig(site));
  }

  // 5. Base layout
  writeFile('src/layouts/BaseLayout.astro', generateBaseLayout(site));

  // 6. Blog post layout
  writeFile('src/layouts/PostLayout.astro', useJsonMode ? generatePostLayoutJson() : generatePostLayout());

  // 7. Index page
  writeFile('src/pages/index.astro', useJsonMode ? generateIndexPageJson(site) : generateIndexPage(site));

  // 8. Blog listing page
  writeFile('src/pages/blog/index.astro', useJsonMode ? generateBlogListPageJson() : generateBlogListPage());

  // 9. Blog post page (dynamic route)
  writeFile('src/pages/blog/[...slug].astro', useJsonMode ? generateBlogPostPageJson() : generateBlogPostPage());

  // 10. 404 page
  writeFile('src/pages/404.astro', generate404Page());

  // 11. RSS feed (optional)
  writeFile('src/pages/rss.xml.ts', generateRssFeed(site));

  // 12. Deploy platform config
  if (deployPlatform === 'vercel') {
    writeFile('vercel.json', JSON.stringify({ framework: 'astro' }, null, 2));
  } else if (deployPlatform === 'netlify') {
    writeFile('netlify.toml', `[build]\n  command = "npm run build"\n  publish = "dist"\n`);
  } else if (deployPlatform === 'cloudflare') {
    writeFile('wrangler.toml', `name = "${site.id}"\ncompatibility_date = "2024-01-01"\npages_build_output_dir = "dist"\n`);
  }

  // 13. .gitignore
  writeFile('.gitignore', `node_modules/\ndist/\n.astro/\n.env\n*.log\n`);

  // 14. Content directories (or data directory for JSON mode)
  if (useJsonMode) {
    fs.mkdirSync(path.join(outputDir, 'src', 'data'), { recursive: true });
    created.push('src/data/');
  } else {
    const postTypes = site.post_types || [
      { slug: 'post', rest_base: 'posts', name: 'Posts', hierarchical: false, has_archive: true },
      { slug: 'page', rest_base: 'pages', name: 'Pages', hierarchical: true, has_archive: false },
    ];

    for (const pt of postTypes) {
      if (['attachment', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles'].includes(pt.slug)) continue;
      const dir = getCollectionDir(pt.slug, config.content_type_config);
      fs.mkdirSync(path.join(outputDir, 'src', 'content', dir), { recursive: true });
      created.push(`src/content/${dir}/`);
    }
  }

  // 15. Public directory
  fs.mkdirSync(path.join(outputDir, 'public'), { recursive: true });

  // 16. env.d.ts
  writeFile('src/env.d.ts', '/// <reference path="../.astro/types.d.ts" />\n');

  logger.info('Project scaffolded', { outputDir, created: created.length, skipped: skipped.length });

  return { filesCreated: created, filesSkipped: skipped, outputDir };
}

function getCollectionDir(
  postType: string,
  contentTypeConfig?: Record<string, { directory: string }>
): string {
  if (contentTypeConfig?.[postType]?.directory) {
    return contentTypeConfig[postType].directory;
  }
  switch (postType) {
    case 'post': return 'blog';
    case 'page': return 'pages';
    default: return postType.replace(/_/g, '-');
  }
}

export function getCollectionDirForType(
  postType: string,
  site: SiteConfig
): string {
  return getCollectionDir(postType, site.export?.content_type_config);
}

function generatePackageJson(site: SiteConfig, componentLib: string, deployPlatform: string): string {
  const deps: Record<string, string> = {
    astro: '^5.0.0',
    '@astrojs/sitemap': '^3.2.0',
    '@astrojs/rss': '^4.0.0',
  };

  if (deployPlatform === 'vercel') deps['@astrojs/vercel'] = '^8.0.0';
  if (deployPlatform === 'netlify') deps['@astrojs/netlify'] = '^6.0.0';
  if (deployPlatform === 'cloudflare') deps['@astrojs/cloudflare'] = '^12.0.0';

  if (componentLib === 'starwind') {
    deps['@starwindui/core'] = '^0.1.0';
    deps['tailwindcss'] = '^4.0.0';
    deps['@astrojs/tailwind'] = '^6.0.0';
  }

  const pkg = {
    name: site.id,
    type: 'module',
    version: '1.0.0',
    description: `${site.name} — Migrated from WordPress to Astro`,
    scripts: {
      dev: 'astro dev',
      build: 'astro build',
      preview: 'astro preview',
      'astro': 'astro',
    },
    dependencies: deps,
  };

  return JSON.stringify(pkg, null, 2);
}

function generateAstroConfig(site: SiteConfig, deployPlatform: string): string {
  const integrations: string[] = ['sitemap()'];
  const imports: string[] = [
    "import { defineConfig } from 'astro/config';",
    "import sitemap from '@astrojs/sitemap';",
  ];

  if (deployPlatform === 'vercel') {
    imports.push("import vercel from '@astrojs/vercel';");
  } else if (deployPlatform === 'netlify') {
    imports.push("import netlify from '@astrojs/netlify';");
  } else if (deployPlatform === 'cloudflare') {
    imports.push("import cloudflare from '@astrojs/cloudflare';");
  }

  const siteUrl = site.url.replace(/\/+$/, '');

  let config = `${imports.join('\n')}

export default defineConfig({
  site: '${siteUrl}',
  integrations: [${integrations.join(', ')}],`;

  if (deployPlatform !== 'none') {
    const adapterMap: Record<string, string> = {
      vercel: 'vercel()',
      netlify: 'netlify()',
      cloudflare: 'cloudflare()',
    };
    if (adapterMap[deployPlatform]) {
      config += `\n  adapter: ${adapterMap[deployPlatform]},`;
      config += `\n  output: 'static',`;
    }
  }

  config += '\n});\n';
  return config;
}

function generateContentConfig(site: SiteConfig): string {
  const postTypes = site.post_types || [
    { slug: 'post', rest_base: 'posts', name: 'Posts', hierarchical: false, has_archive: true },
    { slug: 'page', rest_base: 'pages', name: 'Pages', hierarchical: true, has_archive: false },
  ];

  const collections: string[] = [];
  for (const pt of postTypes) {
    if (['attachment', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_global_styles'].includes(pt.slug)) continue;
    const dir = getCollectionDir(pt.slug, site.export?.content_type_config);
    const name = dir.replace(/-/g, '_');
    collections.push(`  ${name}: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "src/content/${dir}" }),
    schema: baseSchema,
  })`);
  }

  return `import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const baseSchema = z.object({
  title: z.string(),
  slug: z.string(),
  date: z.string(),
  modified: z.string().optional(),
  author: z.object({
    name: z.string(),
    id: z.number(),
    slug: z.string(),
    avatar: z.string().optional(),
  }).optional(),
  status: z.string(),
  draft: z.boolean().optional(),
  categories: z.array(z.object({
    name: z.string(),
    slug: z.string(),
  })).optional(),
  tags: z.array(z.object({
    name: z.string(),
    slug: z.string(),
  })).optional(),
  excerpt: z.string().optional(),
  featuredImage: z.object({
    url: z.string(),
    alt: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
  }).optional(),
  seo: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    canonical: z.string().optional(),
    ogImage: z.string().optional(),
    noindex: z.boolean().optional(),
    focusKeyword: z.string().optional(),
  }).optional(),
  readingTime: z.number().optional(),
  wordCount: z.number().optional(),
  wpPostId: z.number(),
  wpUrl: z.string(),
  postType: z.string(),
});

export const collections = {
${collections.join(',\n')}
};
`;
}

function generateBaseLayout(site: SiteConfig): string {
  const title = site.site_title || site.name;
  const tagline = site.site_tagline || '';
  return `---
interface Props {
  title?: string;
  description?: string;
  ogImage?: string;
}

const { title = '${title}', description = '${tagline}', ogImage } = Astro.props;
const canonicalURL = new URL(Astro.url.pathname, Astro.site);
---

<!DOCTYPE html>
<html lang="${site.site_language || 'en'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="canonical" href={canonicalURL} />
  <meta name="description" content={description} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  {ogImage && <meta property="og:image" content={ogImage} />}
  <link rel="sitemap" href="/sitemap-index.xml" />
  <link rel="alternate" type="application/rss+xml" title={title} href="/rss.xml" />
  <title>{title}</title>
</head>
<body>
  <header>
    <nav>
      <a href="/">${title}</a>
      <a href="/blog">Blog</a>
    </nav>
  </header>
  <main>
    <slot />
  </main>
  <footer>
    <p>&copy; {new Date().getFullYear()} ${title}</p>
  </footer>
</body>
</html>
`;
}

function generatePostLayout(): string {
  return `---
import BaseLayout from './BaseLayout.astro';

const { frontmatter } = Astro.props;
const { title, date, author, categories, tags, featuredImage, excerpt, seo, readingTime } = frontmatter;
const pageTitle = seo?.title || title;
const pageDescription = seo?.description || excerpt || '';
---

<BaseLayout title={pageTitle} description={pageDescription} ogImage={seo?.ogImage || featuredImage?.url}>
  <article>
    <header>
      <h1>{title}</h1>
      <div class="meta">
        {date && <time datetime={date}>{new Date(date).toLocaleDateString()}</time>}
        {author && <span>by {author.name}</span>}
        {readingTime && <span>{readingTime} min read</span>}
      </div>
      {categories && categories.length > 0 && (
        <div class="categories">
          {categories.map((cat: { name: string; slug: string }) => (
            <a href={\`/blog/category/\${cat.slug}\`}>{cat.name}</a>
          ))}
        </div>
      )}
    </header>

    {featuredImage && (
      <img
        src={featuredImage.url}
        alt={featuredImage.alt || title}
        width={featuredImage.width}
        height={featuredImage.height}
        loading="eager"
      />
    )}

    <div class="content">
      <slot />
    </div>

    {tags && tags.length > 0 && (
      <footer>
        <div class="tags">
          {tags.map((tag: { name: string; slug: string }) => (
            <a href={\`/blog/tag/\${tag.slug}\`}>{tag.name}</a>
          ))}
        </div>
      </footer>
    )}
  </article>
</BaseLayout>
`;
}

function generateIndexPage(site: SiteConfig): string {
  const title = site.site_title || site.name;
  return `---
import BaseLayout from '../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';

const posts = (await getCollection('blog'))
  .filter(post => !post.data.draft)
  .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime())
  .slice(0, 10);
---

<BaseLayout>
  <h1>${title}</h1>
  <section>
    <h2>Latest Posts</h2>
    <ul>
      {posts.map(post => (
        <li>
          <a href={\`/blog/\${post.data.slug}\`}>
            <h3>{post.data.title}</h3>
          </a>
          {post.data.excerpt && <p>{post.data.excerpt}</p>}
          <time datetime={post.data.date}>{new Date(post.data.date).toLocaleDateString()}</time>
        </li>
      ))}
    </ul>
  </section>
</BaseLayout>
`;
}

function generateBlogListPage(): string {
  return `---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';

const posts = (await getCollection('blog'))
  .filter(post => !post.data.draft)
  .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());
---

<BaseLayout title="Blog">
  <h1>Blog</h1>
  <ul>
    {posts.map(post => (
      <li>
        <a href={\`/blog/\${post.data.slug}\`}>
          <h2>{post.data.title}</h2>
        </a>
        {post.data.excerpt && <p>{post.data.excerpt}</p>}
        <div class="meta">
          <time datetime={post.data.date}>{new Date(post.data.date).toLocaleDateString()}</time>
          {post.data.author && <span>by {post.data.author.name}</span>}
          {post.data.readingTime && <span>{post.data.readingTime} min read</span>}
        </div>
      </li>
    ))}
  </ul>
</BaseLayout>
`;
}

function generateBlogPostPage(): string {
  return `---
import { getCollection, render } from 'astro:content';
import PostLayout from '../../layouts/PostLayout.astro';

export async function getStaticPaths() {
  const posts = await getCollection('blog');
  return posts.map(post => ({
    params: { slug: post.data.slug },
    props: { post },
  }));
}

const { post } = Astro.props;
const { Content } = await render(post);
---

<PostLayout frontmatter={post.data}>
  <Content />
</PostLayout>
`;
}

function generate404Page(): string {
  return `---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="Page Not Found">
  <h1>404</h1>
  <p>Page not found. <a href="/">Go home</a>.</p>
</BaseLayout>
`;
}

function generateRssFeed(site: SiteConfig): string {
  const title = site.site_title || site.name;
  const description = site.site_tagline || '';
  return `import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context: { site: URL }) {
  const posts = (await getCollection('blog'))
    .filter(post => !post.data.draft)
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());

  return rss({
    title: '${title}',
    description: '${description}',
    site: context.site,
    items: posts.map(post => ({
      title: post.data.title,
      pubDate: new Date(post.data.date),
      description: post.data.excerpt || '',
      link: \`/blog/\${post.data.slug}/\`,
    })),
  });
}
`;
}

// ============================================================
// JSON Mode Page Generators
// For large sites (500+ posts), skip content collections entirely.
// Content stays as HTML, imported from a single JSON file.
// This avoids Astro's markdown parsing pipeline which OOMs on large sites.
// ============================================================

function generatePostLayoutJson(): string {
  return `---
import BaseLayout from './BaseLayout.astro';

interface Props {
  post: {
    title: string;
    date: string;
    author?: { name: string };
    categories?: Array<{ name: string; slug: string }>;
    tags?: Array<{ name: string; slug: string }>;
    featuredImage?: { url: string; alt: string; width?: number; height?: number };
    excerpt?: string;
    content: string;
    seo?: { title?: string; description?: string; ogImage?: string };
    readingTime?: number;
  };
}

const { post } = Astro.props;
const pageTitle = post.seo?.title || post.title;
const pageDescription = post.seo?.description || post.excerpt || '';
---

<BaseLayout title={pageTitle} description={pageDescription} ogImage={post.seo?.ogImage || post.featuredImage?.url}>
  <article>
    <header>
      <h1>{post.title}</h1>
      <div class="meta">
        {post.date && <time datetime={post.date}>{new Date(post.date).toLocaleDateString()}</time>}
        {post.author && <span>by {post.author.name}</span>}
        {post.readingTime && <span>{post.readingTime} min read</span>}
      </div>
      {post.categories && post.categories.length > 0 && (
        <div class="categories">
          {post.categories.map((cat) => (
            <a href={\`/blog/category/\${cat.slug}\`}>{cat.name}</a>
          ))}
        </div>
      )}
    </header>

    {post.featuredImage && (
      <img
        src={post.featuredImage.url}
        alt={post.featuredImage.alt || post.title}
        width={post.featuredImage.width}
        height={post.featuredImage.height}
        loading="eager"
      />
    )}

    <div class="content" set:html={post.content} />

    {post.tags && post.tags.length > 0 && (
      <footer>
        <div class="tags">
          {post.tags.map((tag) => (
            <a href={\`/blog/tag/\${tag.slug}\`}>{tag.name}</a>
          ))}
        </div>
      </footer>
    )}
  </article>
</BaseLayout>
`;
}

function generateIndexPageJson(site: SiteConfig): string {
  const title = site.site_title || site.name;
  return `---
import BaseLayout from '../layouts/BaseLayout.astro';
import posts from '../data/blog.json';

const latest = posts.slice(0, 10);
---

<BaseLayout>
  <h1>${title}</h1>
  <section>
    <h2>Latest Posts</h2>
    <ul>
      {latest.map(post => (
        <li>
          <a href={\`/blog/\${post.slug}\`}>
            <h3>{post.title}</h3>
          </a>
          {post.excerpt && <p>{post.excerpt}</p>}
          <time datetime={post.date}>{new Date(post.date).toLocaleDateString()}</time>
        </li>
      ))}
    </ul>
  </section>
</BaseLayout>
`;
}

function generateBlogListPageJson(): string {
  return `---
import BaseLayout from '../../layouts/BaseLayout.astro';
import posts from '../../data/blog.json';
---

<BaseLayout title="Blog">
  <h1>Blog</h1>
  <ul>
    {posts.map(post => (
      <li>
        <a href={\`/blog/\${post.slug}\`}>
          <h2>{post.title}</h2>
        </a>
        {post.excerpt && <p>{post.excerpt}</p>}
        <div class="meta">
          <time datetime={post.date}>{new Date(post.date).toLocaleDateString()}</time>
          {post.author && <span>by {post.author.name}</span>}
          {post.readingTime && <span>{post.readingTime} min read</span>}
        </div>
      </li>
    ))}
  </ul>
</BaseLayout>
`;
}

function generateBlogPostPageJson(): string {
  return `---
import PostLayout from '../../layouts/PostLayout.astro';
import posts from '../../data/blog.json';

export function getStaticPaths() {
  return posts.map(post => ({
    params: { slug: post.slug },
    props: { post },
  }));
}

const { post } = Astro.props;
---

<PostLayout post={post} />
`;
}
